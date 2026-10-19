// Messages between the board (laptop) and the viewer (phone), relayed by the
// server inside a room. The board owns the voice, so it streams everything the
// phone needs to animate Mochi: mouth shapes, feelings, gestures, gaze.

export const EMOTIONS = [
  "happy",
  "excited",
  "thinking",
  "surprised",
  "proud",
  "oops",
  "calm",
  "teasing",
  "pout",
  "shy",
] as const;
export const GESTURES = [
  "none",
  "wave",
  "nod",
  "point_board",
  "cheer",
  "shrug",
  "think",
  "hop",
  "peace",
  "cheeks",
  "tilt",
  "clap",
  "giggle",
  "ack",
] as const;

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

import type { BoardItem } from "../board/store";

export type BoardMessage =
  /** Where the markers are. `full` means the whole screen is markers and the phone draws the board. */
  | { t: "layout"; w: number; h: number; markers: MarkerLayout[]; full?: boolean }
  | { t: "mouth"; v: Visemes }
  | { t: "emote"; emotion: Emotion }
  | { t: "gesture"; gesture: Gesture }
  | { t: "look"; at: "student" | "board" }
  /** Point at a spot on the board: fractions of its width and height from the top-left. */
  | { t: "point"; x: number; y: number }
  /** The student is talking, so she leans in and listens. */
  | { t: "listen"; on: boolean }
  /** Phone mode: everything on the board, for the phone to draw. Notebook photos come separately. */
  | { t: "board"; items: BoardItem[]; focus: number | null }
  /** A notebook photo for the phone's board, as a JPEG data URL. */
  | { t: "photo"; id: number; data: string }
  /** Phone mode: the captions, since the laptop screen is showing markers. */
  | { t: "caption"; mochi: string; you: string }
  /** Phone mode: point at a board item; the phone knows where it drew it. */
  | { t: "point-item"; id: number }
  | { t: "status"; live: boolean; speaking: boolean }
  | { t: "ping"; id: number };

export type ViewerMessage =
  | { t: "pong"; id: number }
  /** The phone wants to draw the board itself, with the laptop showing only markers. */
  | { t: "board-mode"; on: boolean };

export type ServerMessage = { t: "presence"; boards: number; viewers: number };

export const ROOM_CODE = /^[a-z0-9]{6,32}$/;
export const MAX_MESSAGE_BYTES = 4096;
/** Board snapshots hold every item on every page, so they get more room. */
export const MAX_BOARD_BYTES = 160_000;
export const MAX_PHOTO_BYTES = 400_000;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function isBoardMessage(m: Record<string, unknown>): boolean {
  switch (m.t) {
    case "layout":
      return (
        isNum(m.w) &&
        isNum(m.h) &&
        Array.isArray(m.markers) &&
        m.markers.length <= 16 &&
        m.markers.every((k) => k && isNum(k.id) && isNum(k.x) && isNum(k.y) && isNum(k.size)) &&
        (m.full === undefined || typeof m.full === "boolean")
      );
    case "board":
      return Array.isArray(m.items) && m.items.length <= 200 && (m.focus === null || isNum(m.focus));
    case "photo":
      return isNum(m.id) && typeof m.data === "string" && m.data.startsWith("data:image/jpeg;base64,");
    case "caption":
      return typeof m.mochi === "string" && typeof m.you === "string" && m.mochi.length + m.you.length <= 1200;
    case "point-item":
      return isNum(m.id);
    case "mouth":
      return Array.isArray(m.v) && m.v.length === 5 && m.v.every((x) => isNum(x) && x >= 0 && x <= 1);
    case "emote":
      return (EMOTIONS as readonly unknown[]).includes(m.emotion);
    case "gesture":
      return (GESTURES as readonly unknown[]).includes(m.gesture);
    case "look":
      return m.at === "student" || m.at === "board";
    case "point":
      return isNum(m.x) && isNum(m.y) && m.x >= 0 && m.x <= 1 && m.y >= 0 && m.y <= 1;
    case "listen":
      return typeof m.on === "boolean";
    case "status":
      return typeof m.live === "boolean" && typeof m.speaking === "boolean";
    case "ping":
      return isNum(m.id);
    default:
      return false;
  }
}

const SIZE_LIMIT: Record<string, number> = { board: MAX_BOARD_BYTES, photo: MAX_PHOTO_BYTES };

/** Parse a raw socket message and check it is allowed for the sender's role. */
export function parseMessage(role: Role, raw: string): BoardMessage | ViewerMessage | null {
  if (raw.length > MAX_PHOTO_BYTES) return null;
  let m: unknown;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const msg = m as Record<string, unknown>;
  if (raw.length > (SIZE_LIMIT[String(msg.t)] ?? MAX_MESSAGE_BYTES)) return null;
  if (role === "board") return isBoardMessage(msg) ? (msg as BoardMessage) : null;
  if (msg.t === "pong") return isNum(msg.id) ? (msg as ViewerMessage) : null;
  if (msg.t === "board-mode") return typeof msg.on === "boolean" ? (msg as ViewerMessage) : null;
  return null;
}
