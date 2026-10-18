import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { startApp } from "../server/app";
import { clientAddress, matchesAny } from "../server/net";
import { DailyCap, RateLimiter } from "../server/rate-limit";
import { parseMessage } from "../src/shared/protocol";

let server: ReturnType<typeof startApp>;
let grants = 0;

beforeAll(() => {
  server = startApp({
    host: "127.0.0.1",
    port: 0,
    createGrant: async (resumeHandle) => {
      grants++;
      return { token: `auth_tokens/fake-${resumeHandle ?? "new"}`, model: "m", voice: "v", expiresAt: "later" };
    },
    locate: async (_image, target) => (target === "nowhere" ? null : [10, 20, 30, 40]),
    sessionLimit: 3,
    sessionWindowMs: 60_000,
    exposeNetwork: true,
  });
});

afterAll(() => server.stop(true));

const http = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

describe("http api", () => {
  test("health", async () => {
    expect(await (await http("/api/health")).json()).toEqual({ ok: true });
  });

  test("sessions mint a grant and pass the resume handle", async () => {
    const res = await http("/api/sessions", { method: "POST", body: JSON.stringify({ resumeHandle: "abc" }) });
    expect(res.status).toBe(201);
    expect((await res.json()).token).toBe("auth_tokens/fake-abc");
  });

  test("cross-site posts are refused", async () => {
    const res = await http("/api/sessions", { method: "POST", headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });

  test("bad json is a 400", async () => {
    const res = await http("/api/sessions", { method: "POST", body: "{nope" });
    expect(res.status).toBe(400);
  });

  test("rate limited after the limit", async () => {
    const before = grants;
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await http("/api/sessions", { method: "POST" })).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(grants - before).toBeLessThanOrEqual(3);
  });

  test("notebook locate returns a box and validates input", async () => {
    const post = (body: unknown) =>
      http("/api/notebook/locate", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
    expect(await (await post({ image: "AAAA", target: "P = 5/36" })).json()).toEqual({ box: [10, 20, 30, 40] });
    expect(await (await post({ image: "AAAA", target: "nowhere" })).json()).toEqual({ box: null });
    expect((await post({ image: "AAAA" })).status).toBe(400);
    expect((await post("{bad")).status).toBe(400);
  });

  test("unknown routes are 404", async () => {
    expect((await http("/nope")).status).toBe(404);
  });

  test("network lists addresses", async () => {
    const body = await (await http("/api/network")).json();
    expect(Array.isArray(body.addresses)).toBe(true);
  });
});

describe("public deploy", () => {
  const dir = mkdtempSync(join(tmpdir(), "mochi-static-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<h1>board</h1>");
  writeFileSync(join(dir, "assets", "app-abc.js"), "1");
  writeFileSync(join(dir, "assets", "big.js"), "x".repeat(5000));
  writeFileSync(join(dir, "assets", "big.js.br"), brotliCompressSync("x".repeat(5000)));
  writeFileSync(join(dir, "..", "mochi-secret.txt"), "nope");
  let s: ReturnType<typeof startApp>;
  let grants = 0;

  beforeAll(() => {
    s = startApp({
      host: "127.0.0.1",
      port: 0,
      createGrant: async () => {
        grants++;
        return { token: "auth_tokens/x", model: "m", voice: "v", expiresAt: "later" };
      },
      locate: null,
      sessionLimit: 100,
      sessionWindowMs: 60_000,
      dailySessionLimit: 2,
      staticDir: dir,
    });
  });
  afterAll(() => s.stop(true));
  const get = (path: string, init?: RequestInit) => fetch(new URL(path, s.url), init);

  test("the daily cap stops sessions for everyone", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await get("/api/sessions", { method: "POST" })).status);
    expect(statuses).toEqual([201, 201, 429]);
    expect(grants).toBe(2);
    const res = await get("/api/sessions", { method: "POST" });
    expect((await res.json()).error).toContain("tomorrow");
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  test("LAN addresses stay private", async () => {
    expect((await get("/api/network")).status).toBe(404);
  });

  test("static files are served with the right caching and nothing outside the folder", async () => {
    const index = await get("/");
    expect(await index.text()).toBe("<h1>board</h1>");
    expect(index.headers.get("cache-control")).toBe("no-cache");
    expect((await get("/assets/app-abc.js")).headers.get("cache-control")).toContain("immutable");
    expect((await get("/assets")).status).toBe(404);
    expect((await get("/%2e%2e/mochi-secret.txt")).status).toBe(404);
    expect((await get("/%E0%A4%A")).status).toBe(404);
  });

  test("brotli copies are sent to browsers that accept them", async () => {
    const br = await get("/assets/big.js", { headers: { "accept-encoding": "gzip, br" } });
    expect(br.headers.get("content-encoding")).toBe("br");
    expect(br.headers.get("content-type")).toContain("javascript");
    expect(await br.text()).toBe("x".repeat(5000));
    const plain = await get("/assets/big.js", { headers: { "accept-encoding": "gzip" } });
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect((await plain.text()).length).toBe(5000);
  });

  test("cross-site WebSockets are refused", async () => {
    const res = await get("/ws/rooms/abcdef12?role=board", { headers: { origin: "https://evil.example" } });
    expect(res.status).toBe(403);
  });
});

describe("client address", () => {
  const trusted = ["127.0.0.1", "10.89.0.0/24"];

  test("forwarded addresses are only believed from trusted proxies", () => {
    expect(clientAddress("10.89.0.7", "203.0.113.9", trusted)).toBe("203.0.113.9");
    expect(clientAddress("::ffff:10.89.0.7", "203.0.113.9", trusted)).toBe("203.0.113.9");
    expect(clientAddress("198.51.100.4", "203.0.113.9", trusted)).toBe("198.51.100.4");
    expect(clientAddress("10.89.1.7", "203.0.113.9", trusted)).toBe("10.89.1.7");
    expect(clientAddress("10.89.0.7", null, trusted)).toBe("10.89.0.7");
  });

  test("a spoofed first entry is ignored", () => {
    expect(clientAddress("127.0.0.1", "1.1.1.1, 203.0.113.9", trusted)).toBe("203.0.113.9");
  });

  test("cidr matching", () => {
    expect(matchesAny("10.0.0.255", ["10.0.0.0/24"])).toBe(true);
    expect(matchesAny("10.0.1.0", ["10.0.0.0/24"])).toBe(false);
    expect(matchesAny("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
    expect(matchesAny("::1", ["::1"])).toBe(true);
    expect(matchesAny("not-an-ip", ["10.0.0.0/8"])).toBe(false);
  });
});

describe("without an api key", () => {
  test("sessions explain what's missing", async () => {
    const s = startApp({
      host: "127.0.0.1",
      port: 0,
      createGrant: null,
      locate: null,
      sessionLimit: 1,
      sessionWindowMs: 1000,
    });
    const res = await fetch(new URL("/api/sessions", s.url), { method: "POST" });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("GEMINI_API_KEY");
    s.stop(true);
  });
});

function socket(path: string): Promise<{ ws: WebSocket; messages: unknown[] }> {
  const url = new URL(path, server.url);
  url.protocol = "ws:";
  const ws = new WebSocket(url);
  const messages: unknown[] = [];
  ws.onmessage = (e) => messages.push(JSON.parse(String(e.data)));
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ ws, messages });
    ws.onerror = reject;
  });
}

const settle = () => new Promise((r) => setTimeout(r, 60));

describe("rooms", () => {
  test("board messages reach the viewer and bad ones are dropped", async () => {
    const board = await socket("/ws/rooms/abc123xyz?role=board");
    const viewer = await socket("/ws/rooms/abc123xyz?role=viewer");
    await settle();
    expect(board.messages.at(-1)).toEqual({ t: "presence", boards: 1, viewers: 1 });

    board.ws.send(JSON.stringify({ t: "mouth", v: [0.5, 0, 0, 0, 0.1] }));
    board.ws.send(JSON.stringify({ t: "mouth", v: [9, 0, 0, 0, 0] }));
    board.ws.send("not json");
    board.ws.send(JSON.stringify({ t: "gesture", gesture: "cheer" }));
    viewer.ws.send(JSON.stringify({ t: "pong", id: 4 }));
    viewer.ws.send(JSON.stringify({ t: "mouth", v: [0, 0, 0, 0, 0] }));
    await settle();

    const fromBoard = viewer.messages.filter((m) => (m as { t: string }).t !== "presence");
    expect(fromBoard).toEqual([
      { t: "mouth", v: [0.5, 0, 0, 0, 0.1] },
      { t: "gesture", gesture: "cheer" },
    ]);
    expect(board.messages).toContainEqual({ t: "pong", id: 4 });

    viewer.ws.close();
    await settle();
    expect(board.messages.at(-1)).toEqual({ t: "presence", boards: 1, viewers: 0 });
    board.ws.close();
  });

  test("rooms are isolated", async () => {
    const a = await socket("/ws/rooms/rooma1?role=board");
    const b = await socket("/ws/rooms/roomb2?role=viewer");
    a.ws.send(JSON.stringify({ t: "look", at: "board" }));
    await settle();
    expect(b.messages.filter((m) => (m as { t: string }).t === "look")).toHaveLength(0);
    a.ws.close();
    b.ws.close();
  });

  test("bad room codes are refused", async () => {
    expect((await http("/ws/rooms/AB?role=board")).status).toBe(400);
    expect((await http("/ws/rooms/abcdef12?role=admin")).status).toBe(400);
  });
});

describe("protocol", () => {
  test("only known message types pass", () => {
    expect(parseMessage("board", JSON.stringify({ t: "emote", emotion: "happy" }))).not.toBeNull();
    expect(parseMessage("board", JSON.stringify({ t: "emote", emotion: "evil" }))).toBeNull();
    expect(parseMessage("board", JSON.stringify({ t: "pong", id: 1 }))).toBeNull();
    expect(parseMessage("viewer", JSON.stringify({ t: "gesture", gesture: "wave" }))).toBeNull();
    expect(parseMessage("board", "[]")).toBeNull();
    expect(parseMessage("board", "x".repeat(5000))).toBeNull();
    expect(
      parseMessage("board", JSON.stringify({ t: "layout", w: 100, h: 50, markers: [{ id: 0, x: 1, y: 2, size: 3 }] })),
    ).not.toBeNull();
  });
});

describe("rate limiter", () => {
  test("windows reset", () => {
    const r = new RateLimiter(2, 1000);
    expect(r.take("a", 0)).toBe(0);
    expect(r.take("a", 10)).toBe(0);
    expect(r.take("a", 20)).toBe(980);
    expect(r.take("b", 20)).toBe(0);
    expect(r.take("a", 1000)).toBe(0);
  });

  test("daily cap resets at UTC midnight", () => {
    const day = Date.parse("2026-10-18T00:00:00Z");
    const cap = new DailyCap(2);
    expect(cap.take(day + 1000)).toBe(0);
    expect(cap.take(day + 2000)).toBe(0);
    expect(cap.take(day + 3_600_000)).toBe(86_400_000 - 3_600_000);
    expect(cap.take(day + 86_400_000)).toBe(0);
    expect(new DailyCap(0).take(day)).toBe(0);
  });
});
