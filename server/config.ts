import { DEFAULT_MODEL, DEFAULT_VOICE } from "../src/live/config";

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: int("PORT", 8787),
  apiKey: process.env.GEMINI_API_KEY ?? "",
  model: process.env.MOCHI_MODEL ?? DEFAULT_MODEL,
  voice: process.env.MOCHI_VOICE ?? DEFAULT_VOICE,
  visionModel: process.env.MOCHI_VISION_MODEL ?? "gemini-3.5-flash-lite",
  tlsCert: process.env.TLS_CERT,
  tlsKey: process.env.TLS_KEY,
  /** Live sessions a single address may start per window */
  sessionLimit: int("SESSION_LIMIT", 12),
  sessionWindowMs: int("SESSION_WINDOW_MS", 10 * 60_000),
  /** Live sessions everyone together may start per UTC day (0 = no cap), for a public demo */
  dailySessionLimit: int("DAILY_SESSION_LIMIT", 0),
  dailyLocateLimit: int("DAILY_LOCATE_LIMIT", 0),
  /** Picture searches everyone together may make per UTC day; 0 means no cap */
  dailyImageLimit: int("DAILY_IMAGE_LIMIT", 0),
  /** Proxies whose X-Forwarded-For is believed, as addresses or IPv4 CIDRs */
  trustedProxies: list("TRUSTED_PROXIES", ["127.0.0.1", "::1"]),
  /** Built files to serve in production; defaults to ./dist next to the server */
  staticDir: process.env.STATIC_DIR,
  // Bun.env, not process.env: `bun build` bakes process.env.NODE_ENV in at compile time.
  production: Bun.env.NODE_ENV === "production",
};
