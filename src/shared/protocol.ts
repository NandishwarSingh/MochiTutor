// Messages between the board (laptop) and the viewer (phone), relayed by the
// server inside a room. The board owns the voice, so it streams everything the
// phone needs to animate Mochi: mouth shapes, feelings, gestures, gaze.

export const EMOTIONS = ["happy", "excited", "thinking", "surprised", "proud", "oops", "calm"] as const;
export const GESTURES = ["none", "wave", "nod", "point_board", "cheer", "shrug", "think"] as const;

export type Emotion = (typeof EMOTIONS)[number];
export type Gesture = (typeof GESTURES)[number];
export type Role = "board" | "viewer";

/** Mouth shape weights in VRM order: aa, ih, ou, ee, oh. */
export type Visemes = [number, number, number, number, number];

/** An ArUco marker drawn on the board, in CSS pixels from the board's top-left corner. */
export interface MarkerLayout {
  id: number;
  x: number;
  y: number;
  size: number;
}

export type BoardMessage =
  | { t: "layout"; w: number; h: number; markers: MarkerLayout[] }
  | { t: "mouth"; v: Visemes }
  | { t: "emote"; emotion: Emotion }
  | { t: "gesture"; gesture: Gesture }
  | { t: "look"; at: "student" | "board" }
  | { t: "status"; live: boolean; speaking: boolean }
  | { t: "ping"; id: number };

export type ViewerMessage = { t: "pong"; id: number };

export type ServerMessage = { t: "presence"; boards: number; viewers: number };

export const ROOM_CODE = /^[a-z0-9]{6,32}$/;
export const MAX_MESSAGE_BYTES = 4096;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isBoardMessage(m: Record<string, unknown>): boolean {
  switch (m.t) {
    case "layout":
      return (
        isNum(m.w) &&
        isNum(m.h) &&
        Array.isArray(m.markers) &&
        m.markers.length <= 8 &&
        m.markers.every((k) => k && isNum(k.id) && isNum(k.x) && isNum(k.y) && isNum(k.size))
      );
    case "mouth":
      return Array.isArray(m.v) && m.v.length === 5 && m.v.every((x) => isNum(x) && x >= 0 && x <= 1);
    case "emote":
      return (EMOTIONS as readonly unknown[]).includes(m.emotion);
    case "gesture":
      return (GESTURES as readonly unknown[]).includes(m.gesture);
    case "look":
      return m.at === "student" || m.at === "board";
    case "status":
      return typeof m.live === "boolean" && typeof m.speaking === "boolean";
    case "ping":
      return isNum(m.id);
    default:
      return false;
  }
}

/** Parse a raw socket message and check it is allowed for the sender's role. */
export function parseMessage(role: Role, raw: string): BoardMessage | ViewerMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const msg = m as Record<string, unknown>;
  if (role === "board") return isBoardMessage(msg) ? (msg as BoardMessage) : null;
  return msg.t === "pong" && isNum(msg.id) ? (msg as ViewerMessage) : null;
}
