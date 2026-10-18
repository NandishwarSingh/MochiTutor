import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, normalize, resolve } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { ROOM_CODE, type Role } from "../src/shared/protocol";
import type { Box, SessionGrant } from "./gemini";
import { RateLimiter } from "./rate-limit";
import { Rooms } from "./rooms";

export interface AppOptions {
  host: string;
  port: number;
  /** Mints a Live session token; injected so tests don't call Google. */
  createGrant: ((resumeHandle?: string) => Promise<SessionGrant>) | null;
  /** Finds a piece of writing on a notebook photo; injected so tests don't call Google. */
  locate: ((imageBase64: string, target: string) => Promise<Box | null>) | null;
  sessionLimit: number;
  sessionWindowMs: number;
  staticDir?: string;
  tls?: { cert: string; key: string };
}

interface SocketData {
  code: string;
  role: Role;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** LAN IPv4 addresses, so the board can show a QR code the phone can reach. */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function clientAddress(req: Request, server: Server<SocketData>): string {
  const direct = server.requestIP(req)?.address ?? "unknown";
  // The Vite dev server proxies from loopback and sets X-Forwarded-For.
  const isLoopback = direct === "127.0.0.1" || direct === "::1" || direct === "::ffff:127.0.0.1";
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return isLoopback && forwarded ? forwarded : direct;
}

/** Reject cross-site POSTs: a page on another origin must not start sessions. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function serveStatic(dir: string, pathname: string): Response | null {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel === "/viewer" || rel === "/viewer/") rel = "/viewer/index.html";
  const root = resolve(dir);
  const file = resolve(join(root, normalize(rel)));
  if (!file.startsWith(root) || !existsSync(file)) return null;
  const f = Bun.file(file);
  const immutable = rel.startsWith("/assets/");
  return new Response(f, {
    headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
  });
}

export function startApp(opts: AppOptions): Server<SocketData> {
  const rooms = new Rooms<ServerWebSocket<SocketData>>();
  const limiter = new RateLimiter(opts.sessionLimit, opts.sessionWindowMs);
  const locateLimiter = new RateLimiter(40, 10 * 60_000);

  return Bun.serve<SocketData>({
    hostname: opts.host,
    port: opts.port,
    tls: opts.tls ? { cert: Bun.file(opts.tls.cert), key: Bun.file(opts.tls.key) } : undefined,
    routes: {
      "/api/health": { GET: () => json({ ok: true }) },
      "/api/network": { GET: () => json({ addresses: lanAddresses() }) },
      "/api/sessions": {
        POST: async (req: Request, server: Server<SocketData>) => {
          if (!sameOrigin(req)) return json({ error: "Cross-site requests are not allowed." }, 403);
          if (!opts.createGrant) {
            return json({ error: "The server has no GEMINI_API_KEY. Add it to .env and restart." }, 503);
          }
          const wait = limiter.take(clientAddress(req, server));
          if (wait > 0) {
            return new Response(JSON.stringify({ error: "Too many sessions. Try again in a bit." }), {
              status: 429,
              headers: { "content-type": "application/json", "retry-after": String(Math.ceil(wait / 1000)) },
            });
          }
          let resumeHandle: string | undefined;
          const text = await req.text();
          if (text.length > 2048) return json({ error: "Request body too large." }, 413);
          if (text) {
            try {
              const body = JSON.parse(text) as { resumeHandle?: unknown };
              if (typeof body.resumeHandle === "string" && body.resumeHandle.length < 1024) {
                resumeHandle = body.resumeHandle;
              }
            } catch {
              return json({ error: "The request body must be JSON." }, 400);
            }
          }
          try {
            return json(await opts.createGrant(resumeHandle), 201);
          } catch (err) {
            console.error("session token failed:", err instanceof Error ? err.message : err);
            return json({ error: "Couldn't start a Live session with Gemini. Check the server log." }, 502);
          }
        },
      },
      "/api/notebook/locate": {
        POST: async (req: Request, server: Server<SocketData>) => {
          if (!sameOrigin(req)) return json({ error: "Cross-site requests are not allowed." }, 403);
          if (!opts.locate) return json({ error: "The server has no GEMINI_API_KEY." }, 503);
          if (locateLimiter.take(clientAddress(req, server)) > 0) return json({ error: "Too many requests." }, 429);
          const text = await req.text();
          if (text.length > 4_000_000) return json({ error: "The photo is too large." }, 413);
          let body: { image?: unknown; target?: unknown };
          try {
            body = JSON.parse(text);
          } catch {
            return json({ error: "The request body must be JSON." }, 400);
          }
          if (typeof body.image !== "string" || typeof body.target !== "string" || !body.target.trim()) {
            return json({ error: "Send image (base64 JPEG) and target (text)." }, 400);
          }
          try {
            return json({ box: await opts.locate(body.image, body.target.slice(0, 300)) });
          } catch (err) {
            console.error("locate failed:", err instanceof Error ? err.message : err);
            return json({ error: "Couldn't locate that on the photo." }, 502);
          }
        },
      },
    },
    fetch(req, server) {
      const url = new URL(req.url);
      const room = /^\/ws\/rooms\/([^/]+)$/.exec(url.pathname);
      if (room) {
        const code = room[1];
        const role = url.searchParams.get("role");
        if (!ROOM_CODE.test(code) || (role !== "board" && role !== "viewer")) {
          return json({ error: "Bad room code or role." }, 400);
        }
        if (server.upgrade(req, { data: { code, role } })) return undefined;
        return json({ error: "Expected a WebSocket upgrade." }, 426);
      }
      if (opts.staticDir && req.method === "GET") {
        const res = serveStatic(opts.staticDir, url.pathname);
        if (res) return res;
      }
      return json({ error: "Not found." }, 404);
    },
    websocket: {
      maxPayloadLength: 4096,
      idleTimeout: 120,
      open(ws) {
        if (!rooms.join(ws.data.code, ws.data.role, ws)) ws.close(1008, "Room is full");
      },
      message(ws, message) {
        if (typeof message === "string") rooms.relay(ws.data.code, ws.data.role, message);
      },
      close(ws) {
        rooms.leave(ws.data.code, ws.data.role, ws);
      },
    },
  });
}
