import { statSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, normalize, resolve } from "node:path";
import type { Server, ServerWebSocket } from "bun";
import { ROOM_CODE, type Role } from "../src/shared/protocol";
import type { Box, SessionGrant } from "./gemini";
import type { ImageSearch } from "./images";
import { clientAddress, matchesAny } from "./net";
import { DailyCap, RateLimiter } from "./rate-limit";
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
  /** Live sessions everyone together may start per UTC day; 0 means no cap. */
  dailySessionLimit?: number;
  /** Notebook lookups everyone together may make per UTC day; 0 means no cap. */
  dailyLocateLimit?: number;
  /** Finds free pictures for the board; null turns pictures off. */
  images?: ImageSearch | null;
  /** Picture searches everyone together may make per UTC day; 0 means no cap. */
  dailyImageLimit?: number;
  /** Proxies allowed to set X-Forwarded-For and X-Forwarded-Host: addresses or IPv4 CIDRs. */
  trustedProxies?: string[];
  /** Serve /api/network so the board can put the laptop's LAN address in the QR code. Dev only. */
  exposeNetwork?: boolean;
  /** Open WebSockets across all rooms. */
  maxSockets?: number;
  staticDir?: string;
  tls?: { cert: string; key: string };
}

interface SocketData {
  code: string;
  role: Role;
  /** bytes relayed in the current window, so one peer can't flood its room */
  bytes: number;
  windowAt: number;
}

/** What one socket may relay per window: plenty for board snapshots and a few notebook photos. */
const SOCKET_BYTES = 4_000_000;
const SOCKET_WINDOW_MS = 10_000;

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

const LOOPBACK = ["127.0.0.1", "::1"];

const tooMany = (error: string, waitMs: number) =>
  new Response(JSON.stringify({ error }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(Math.ceil(waitMs / 1000)) },
  });

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function serveStatic(dir: string, pathname: string, acceptEncoding: string): Response | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel === "/viewer" || rel === "/viewer/") rel = "/viewer/index.html";
  const root = resolve(dir);
  const file = resolve(join(root, normalize(rel)));
  if (!file.startsWith(`${root}/`) || !isFile(file)) return null;
  // Hashed build assets never change; the avatar is big, so let browsers keep it for a day.
  const cache = rel.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : rel.startsWith("/avatars/")
      ? "public, max-age=86400"
      : "no-cache";
  const original = Bun.file(file);
  const headers: Record<string, string> = { "cache-control": cache, vary: "accept-encoding" };
  // `bun run build` leaves a brotli copy next to big text and model files.
  if (/\bbr\b/.test(acceptEncoding) && isFile(`${file}.br`)) {
    return new Response(Bun.file(`${file}.br`), {
      headers: { ...headers, "content-encoding": "br", "content-type": original.type },
    });
  }
  return new Response(original, { headers });
}

export function startApp(opts: AppOptions): Server<SocketData> {
  const rooms = new Rooms<ServerWebSocket<SocketData>>();
  const limiter = new RateLimiter(opts.sessionLimit, opts.sessionWindowMs);
  const locateLimiter = new RateLimiter(40, 10 * 60_000);
  const dailySessions = new DailyCap(opts.dailySessionLimit ?? 0);
  const dailyLocates = new DailyCap(opts.dailyLocateLimit ?? 0);
  const imageLimiter = new RateLimiter(60, 10 * 60_000);
  const imageFileLimiter = new RateLimiter(300, 10 * 60_000);
  const dailyImages = new DailyCap(opts.dailyImageLimit ?? 0);
  const trusted = opts.trustedProxies ?? LOOPBACK;
  const maxSockets = opts.maxSockets ?? 200;
  let sockets = 0;

  const peer = (req: Request, server: Server<SocketData>) => server.requestIP(req)?.address ?? "unknown";
  const caller = (req: Request, server: Server<SocketData>) =>
    clientAddress(peer(req, server), req.headers.get("x-forwarded-for"), trusted);

  /** Reject cross-site requests: a page on another origin must not start sessions or join rooms. */
  const sameOrigin = (req: Request, server: Server<SocketData>) => {
    const origin = req.headers.get("origin");
    if (!origin) return true;
    const forwarded = matchesAny(peer(req, server), trusted) ? req.headers.get("x-forwarded-host") : null;
    const host = forwarded ?? req.headers.get("host");
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  };

  return Bun.serve<SocketData>({
    hostname: opts.host,
    port: opts.port,
    tls: opts.tls ? { cert: Bun.file(opts.tls.cert), key: Bun.file(opts.tls.key) } : undefined,
    routes: {
      "/api/health": { GET: () => json({ ok: true }) },
      "/api/network": {
        GET: () => (opts.exposeNetwork ? json({ addresses: lanAddresses() }) : json({ error: "Not found." }, 404)),
      },
      "/api/sessions": {
        POST: async (req: Request, server: Server<SocketData>) => {
          if (!sameOrigin(req, server)) return json({ error: "Cross-site requests are not allowed." }, 403);
          if (!opts.createGrant) {
            return json({ error: "The server has no GEMINI_API_KEY. Add it to .env and restart." }, 503);
          }
          const wait = limiter.take(caller(req, server));
          if (wait > 0) return tooMany("Too many sessions. Try again in a bit.", wait);
          const tomorrow = dailySessions.take();
          if (tomorrow > 0) {
            return tooMany(
              "Mochi has taught all the lessons this demo allows today. Try again tomorrow, or run your own copy from GitHub.",
              tomorrow,
            );
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
      "/api/images/search": {
        GET: async (req: Request, server: Server<SocketData>) => {
          if (!sameOrigin(req, server)) return json({ error: "Cross-site requests are not allowed." }, 403);
          if (!opts.images) return json({ error: "Pictures are turned off on this server." }, 503);
          const wait = imageLimiter.take(caller(req, server));
          if (wait > 0) return tooMany("Too many picture searches.", wait);
          const query = new URL(req.url).searchParams.get("q")?.trim() ?? "";
          if (!query || query.length > 120) return json({ error: "Send a short search as q." }, 400);
          const tomorrow = dailyImages.take();
          if (tomorrow > 0) return tooMany("The demo's picture searches are used up for today.", tomorrow);
          try {
            return json({ image: await opts.images.search(query, AbortSignal.timeout(6000)) });
          } catch (err) {
            console.error("image search failed:", err instanceof Error ? err.message : err);
            return json({ error: "Couldn't search for a picture." }, 502);
          }
        },
      },
      "/api/images/:id": {
        GET: async (req: Bun.BunRequest<"/api/images/:id">, server: Server<SocketData>) => {
          if (!opts.images) return json({ error: "Pictures are turned off on this server." }, 503);
          if (!/^[0-9a-f]{20}$/.test(req.params.id)) return json({ error: "Not found." }, 404);
          const wait = imageFileLimiter.take(caller(req, server));
          if (wait > 0) return tooMany("Too many pictures.", wait);
          try {
            return (await opts.images.file(req.params.id)) ?? json({ error: "Not found." }, 404);
          } catch (err) {
            console.error("image fetch failed:", err instanceof Error ? err.message : err);
            return json({ error: "That picture couldn't be loaded." }, 502);
          }
        },
      },
      "/api/notebook/locate": {
        POST: async (req: Request, server: Server<SocketData>) => {
          if (!sameOrigin(req, server)) return json({ error: "Cross-site requests are not allowed." }, 403);
          if (!opts.locate) return json({ error: "The server has no GEMINI_API_KEY." }, 503);
          const wait = locateLimiter.take(caller(req, server));
          if (wait > 0) return tooMany("Too many requests.", wait);
          const tomorrow = dailyLocates.take();
          if (tomorrow > 0) return tooMany("The demo's notebook checks are used up for today.", tomorrow);
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
        if (!sameOrigin(req, server)) return json({ error: "Cross-site requests are not allowed." }, 403);
        if (sockets >= maxSockets) return json({ error: "The server is busy. Try again in a minute." }, 503);
        if (server.upgrade(req, { data: { code, role, bytes: 0, windowAt: Date.now() } })) return undefined;
        return json({ error: "Expected a WebSocket upgrade." }, 426);
      }
      if (opts.staticDir && (req.method === "GET" || req.method === "HEAD")) {
        const res = serveStatic(opts.staticDir, url.pathname, req.headers.get("accept-encoding") ?? "");
        if (res) return res;
      }
      return json({ error: "Not found." }, 404);
    },
    websocket: {
      // Board snapshots and notebook photos for phone mode; everything else is far smaller.
      maxPayloadLength: 512 * 1024,
      idleTimeout: 120,
      open(ws) {
        sockets++;
        if (!rooms.join(ws.data.code, ws.data.role, ws)) ws.close(1008, "Room is full");
      },
      message(ws, message) {
        if (typeof message !== "string") return;
        const now = Date.now();
        if (now - ws.data.windowAt > SOCKET_WINDOW_MS) {
          ws.data.windowAt = now;
          ws.data.bytes = 0;
        }
        ws.data.bytes += message.length;
        if (ws.data.bytes > SOCKET_BYTES) return;
        rooms.relay(ws.data.code, ws.data.role, message);
      },
      close(ws) {
        sockets--;
        rooms.leave(ws.data.code, ws.data.role, ws);
      },
    },
  });
}
