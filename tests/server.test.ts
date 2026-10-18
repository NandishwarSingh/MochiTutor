import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { startApp } from "../server/app";
import { RateLimiter } from "../server/rate-limit";
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
});
