import { DEFAULT_MODEL, DEFAULT_VOICE } from "../src/live/config";

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
  return n;
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
};
