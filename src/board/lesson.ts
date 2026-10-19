import type { FunctionCall } from "@google/genai";
import type { MochiAvatar } from "../avatar/mochi";
import type { AvatarStage } from "../avatar/stage";
import { Mic } from "../live/audio/mic";
import { Player } from "../live/audio/player";
import { logEvent } from "../live/debug";
import { LipSync, SILENT } from "../live/lipsync";
import { type LiveStatus, LiveTutor } from "../live/session";
import type { BoardMessage, Emotion, Gesture, MarkerLayout, Visemes } from "../shared/protocol";
import { StageSocket } from "../shared/stage-socket";
import { stripEmoji, stripMarkup } from "../shared/text";
import { Camera } from "./camera";
import { SpeechFollower } from "./follow";
import { MoodTracker } from "./mood";
import { BoardStore } from "./store";
import { type Photo, runTool } from "./tools";

export interface LessonState {
  status: LiveStatus;
  error: string | null;
  mochiSays: string;
  youSaid: string;
  speaking: boolean;
  micLevel: number;
  viewers: number;
  linkMs: number | null;
  seeMe: boolean;
  countdown: number | null;
  /** Phone mode: the phone draws the board and the laptop shows only markers. */
  phoneBoard: boolean;
}

/** After the student stops, how long Mochi may stay silent before the board steps in. */
const END_TURN_AFTER_MS = 1500;
const NUDGE_AFTER_MS = 4500;
const TOOL_NUDGE_AFTER_MS = 4000;

const INITIAL: LessonState = {
  status: "idle",
  error: null,
  mochiSays: "",
  youSaid: "",
  speaking: false,
  micLevel: 0,
  viewers: 0,
  linkMs: null,
  seeMe: false,
  countdown: null,
  phoneBoard: false,
};

async function locateOnPhoto(image: string, target: string): Promise<[number, number, number, number] | null> {
  const res = await fetch("/api/notebook/locate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ image, target }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { box?: [number, number, number, number] | null };
  return body.box ?? null;
}

/** A notebook photo shrunk for the phone: long side at most `side` px, as a JPEG data URL. */
async function shrinkPhoto(dataUrl: string, side: number): Promise<string | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * k);
    canvas.height = Math.round(img.naturalHeight * k);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

async function findImage(
  query: string,
  signal: AbortSignal,
): Promise<{ id: string; title: string; credit: string } | null> {
  const res = await fetch(`/api/images/search?q=${encodeURIComponent(query)}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
  });
  const body = (await res.json().catch(() => ({}))) as {
    image?: { id: string; title: string; credit: string } | null;
    error?: string;
  };
  if (!res.ok) throw new Error(body.error ?? "Picture search failed.");
  return body.image ?? null;
}

/** Runs one lesson on the laptop: voice in and out, tools, captions, Mochi's body and the phone link. */
export class Lesson {
  readonly board = new BoardStore();
  readonly camera = new Camera();
  readonly socket: StageSocket;
  private state: LessonState = INITIAL;
  private readonly listeners = new Set<() => void>();
  private tutor: LiveTutor | null = null;
  private mic: Mic | null = null;
  private player: Player | null = null;
  private lipsync: LipSync | null = null;
  private avatar: MochiAvatar | null = null;
  private layout: BoardMessage | null = null;
  private mouthHistory: Array<{ at: number; v: Visemes }> = [];
  private lastMouthSent = 0;
  private lastPoint = 0;
  private stage: AvatarStage | null = null;
  /** The newest board item already pointed at or written before, so a write can point at what's new. */
  private seenItemId = 0;
  private lastFocus: number | null = null;
  private listening = false;
  private lastAckAt = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  private captionTimer2: ReturnType<typeof setTimeout> | undefined;
  private lastCaption = "";
  private readonly sentPhotos = new Set<number>();
  private pings = new Map<number, number>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private frameTimer: ReturnType<typeof setInterval> | undefined;
  private captionTimer: ReturnType<typeof setTimeout> | undefined;
  private turnOpen = false;
  private userTalkingSince = 0;
  private userQuietSince = 0;
  private pending = new Map<string, AbortController>();
  private readonly mood = new MoodTracker((emotion, gesture) => this.react(emotion, gesture));
  /** Highlights the board line Mochi is talking about. */
  private readonly follower = new SpeechFollower(
    () =>
      this.board
        .snapshot()
        .filter((it) => it.kind === "line")
        .slice(-24)
        .map((it) => ({ id: it.id, content: it.content })),
    (id) => this.board.focus(id),
  );
  // Watchdog clocks, all performance.now() ms.
  private lastUserTextAt = 0;
  private lastModelAt = 0;
  private lastLoudAt = 0;
  private toolRespondedAt = 0;
  private endedTurnFor = 0;
  private nudgedFor = 0;

  constructor(readonly roomCode: string) {
    this.socket = new StageSocket(roomCode, "board", (m) => {
      if (m.t === "presence") {
        const joined = m.viewers > this.state.viewers;
        this.set({ viewers: m.viewers });
        if (joined) {
          if (this.layout) this.socket.send(this.layout);
          this.socket.send({ t: "status", live: this.state.status === "live", speaking: this.state.speaking });
        }
        if (m.viewers === 0) {
          this.player?.setLead(0);
          this.set({ linkMs: null });
          this.setPhoneBoard(false);
        }
      } else if (m.t === "board-mode") {
        this.setPhoneBoard(m.on);
      } else if (m.t === "pong") {
        const sent = this.pings.get(m.id);
        this.pings.delete(m.id);
        if (sent !== undefined) this.onRoundTrip(performance.now() - sent);
      }
    });
    this.pingTimer = setInterval(() => this.ping(), 2000);
    // Whenever the board highlights a line (following her speech, or an annotate), she points at it.
    this.board.subscribe(() => {
      if (this.state.phoneBoard) this.scheduleSnapshot();
      const focus = this.board.focusSnapshot();
      if (focus === this.lastFocus) return;
      this.lastFocus = focus;
      if (focus !== null) this.pointAtItem(focus);
    });
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private set(patch: Partial<LessonState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
    if (this.state.phoneBoard && ("mochiSays" in patch || "youSaid" in patch)) this.scheduleCaption();
  }

  // --- phone mode --------------------------------------------------------

  /** Hand the board to the phone, or take it back. */
  setPhoneBoard(on: boolean): void {
    if (on === this.state.phoneBoard) return;
    this.sentPhotos.clear();
    this.set({ phoneBoard: on });
    if (on) {
      this.sendSnapshot();
      this.scheduleCaption();
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = undefined;
      this.sendSnapshot();
    }, 80);
  }

  /** Everything on the board, with notebook photos sent once, shrunk, on their own. */
  private sendSnapshot(): void {
    const items = this.board.snapshot().map((it) => (it.kind === "notebook" ? { ...it, image: "" } : it));
    this.socket.send({ t: "board", items, focus: this.board.focusSnapshot() });
    for (const it of this.board.snapshot()) {
      if (it.kind !== "notebook" || this.sentPhotos.has(it.id)) continue;
      this.sentPhotos.add(it.id);
      void shrinkPhoto(it.image, 900).then((data) => {
        if (data) this.socket.send({ t: "photo", id: it.id, data });
      });
    }
  }

  private scheduleCaption(): void {
    if (this.captionTimer2) return;
    this.captionTimer2 = setTimeout(() => {
      this.captionTimer2 = undefined;
      const mochi = this.state.mochiSays.slice(-400);
      const you = this.state.youSaid.slice(-200);
      const key = `${mochi}|${you}`;
      if (key === this.lastCaption) return;
      this.lastCaption = key;
      this.socket.send({ t: "caption", mochi, you });
    }, 150);
  }

  attachAvatar(avatar: MochiAvatar): void {
    this.avatar = avatar;
  }

  /** The stage drawing Mochi beside the board, so she can point across at it. */
  attachStage(stage: AvatarStage | null): void {
    this.stage = stage;
  }

  setLayout(w: number, h: number, markers: MarkerLayout[], full = false): void {
    this.layout = { t: "layout", w, h, markers, full };
    this.socket.send(this.layout);
  }

  async start(): Promise<void> {
    if (this.tutor) return;
    this.set({ status: "connecting", error: null, mochiSays: "", youSaid: "" });
    try {
      this.player = new Player((playing) => {
        this.set({ speaking: playing });
        this.socket.send({ t: "status", live: true, speaking: playing });
      });
      await this.player.start();
      this.lipsync = this.player.analyser ? new LipSync(this.player.analyser) : null;
      this.mic = new Mic((pcm, level) => this.onMic(pcm, level));
      await this.mic.start();
      this.tutor = new LiveTutor({
        status: (status, detail) => {
          this.set({ status, error: status === "error" ? (detail ?? "Something went wrong") : null });
          this.socket.send({ t: "status", live: status === "live", speaking: false });
          if (status === "error") this.teardown();
        },
        audio: (b64) => {
          this.lastModelAt = performance.now();
          this.player?.push(b64);
        },
        interrupted: () => {
          this.player?.clear();
          this.follower.reset();
          this.closeTurn();
        },
        turnComplete: (spoke) => {
          // A turn she ended by talking means she's waiting for the student, not stuck.
          if (spoke) this.lastModelAt = performance.now();
          this.closeTurn();
        },
        userText: (text) => this.onUserText(text),
        mochiText: (text) => this.onMochiText(text),
        toolCalls: (calls) => void this.onToolCalls(calls),
        toolCancel: (ids) => {
          for (const id of ids) this.pending.get(id)?.abort();
        },
      });
      await this.tutor.start();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const friendly = /Permission|NotAllowed/i.test(message)
        ? "Mochi needs the microphone. Allow it in the browser and try again."
        : message;
      this.set({ status: "error", error: friendly });
      this.teardown();
    }
  }

  stop(): void {
    this.tutor?.stop();
    this.teardown();
    this.set({ status: "ended", speaking: false, micLevel: 0 });
  }

  private teardown(): void {
    for (const c of this.pending.values()) c.abort();
    this.pending.clear();
    this.follower.reset();
    this.tutor = null;
    this.mic?.stop();
    this.mic = null;
    this.player?.stop();
    this.player = null;
    this.lipsync = null;
    this.setSeeMe(false);
  }

  dispose(): void {
    this.stop();
    clearInterval(this.pingTimer);
    this.socket.close();
  }

  // --- voice -------------------------------------------------------------

  private onMic(pcm: Int16Array, level: number): void {
    this.tutor?.sendAudio(pcm);
    this.set({ micLevel: level });
    const now = performance.now();
    const loud = level > 0.035;
    if (loud) this.lastLoudAt = now;
    if (loud) {
      if (!this.userTalkingSince) this.userTalkingSince = now;
      this.userQuietSince = 0;
      if (now - this.userTalkingSince > 250 && !this.state.speaking) this.avatar?.look("student");
      // Listening: lean in after a second of talking, and a small nod every few seconds.
      if (now - this.userTalkingSince > 1000 && !this.state.speaking) {
        this.setListening(true);
        if (now - this.lastAckAt > 2800) {
          this.lastAckAt = now;
          this.avatar?.playGesture("ack");
          this.socket.send({ t: "gesture", gesture: "ack" });
        }
      }
    } else if (this.userTalkingSince) {
      if (!this.userQuietSince) this.userQuietSince = now;
      // The student paused after talking for a bit: look thoughtful while Gemini answers.
      if (now - this.userQuietSince > 350) {
        if (now - this.userTalkingSince > 900 && !this.state.speaking) this.react("thinking", "none");
        this.userTalkingSince = 0;
        this.userQuietSince = 0;
        this.setListening(false);
      }
    }
  }

  private setListening(on: boolean): void {
    if (on === this.listening) return;
    this.listening = on;
    this.avatar?.setAttentive(on);
    this.socket.send({ t: "listen", on });
  }

  private onUserText(text: string): void {
    const now = performance.now();
    if (now - this.lastUserTextAt > 2000) logEvent("heard", text);
    this.lastUserTextAt = now;
    clearTimeout(this.captionTimer);
    if (this.turnOpen) {
      this.turnOpen = false;
      this.set({ mochiSays: "" });
    }
    this.set({ youSaid: (this.state.youSaid + text).slice(-220) });
  }

  private onMochiText(text: string): void {
    this.lastModelAt = performance.now();
    clearTimeout(this.captionTimer);
    const clean = stripMarkup(stripEmoji(text));
    this.mood.push(clean);
    this.follower.push(clean);
    if (!this.turnOpen) {
      this.turnOpen = true;
      this.set({ mochiSays: clean.trimStart() });
    } else {
      this.set({ mochiSays: (this.state.mochiSays + clean).slice(-320) });
    }
  }

  private closeTurn(): void {
    this.turnOpen = false;
    this.mood.reset();
    clearTimeout(this.captionTimer);
    this.captionTimer = setTimeout(() => this.set({ mochiSays: "", youSaid: "" }), 6000);
    this.set({ youSaid: "" });
  }

  /**
   * Mochi sometimes stays silent after the student finishes: room noise can
   * keep Gemini waiting for silence, or a turn ends right after a tool result
   * with nothing said. First tell Gemini the student is done, then nudge it.
   */
  private watchdog(now: number): void {
    if (!this.tutor?.connected || this.state.countdown !== null) return;
    const quiet = now - this.lastLoudAt > 600;
    const waitingForReply = this.lastUserTextAt > this.lastModelAt && quiet && !this.state.speaking;
    if (waitingForReply) {
      const since = now - this.lastUserTextAt;
      if (since > END_TURN_AFTER_MS && this.endedTurnFor !== this.lastUserTextAt) {
        this.endedTurnFor = this.lastUserTextAt;
        this.tutor.endUserTurn();
      } else if (since > NUDGE_AFTER_MS && this.nudgedFor !== this.lastUserTextAt) {
        this.nudgedFor = this.lastUserTextAt;
        this.tutor.nudge("(The student finished talking a few seconds ago and is waiting for you. Reply now.)");
      }
    }
    const afterTool = this.toolRespondedAt > this.lastModelAt && !this.state.speaking && this.pending.size === 0;
    if (afterTool && now - this.toolRespondedAt > TOOL_NUDGE_AFTER_MS && this.nudgedFor !== this.toolRespondedAt) {
      this.nudgedFor = this.toolRespondedAt;
      this.tutor.nudge("(The board is done. Carry on teaching from where you were.)");
    }
  }

  /** Called every animation frame by the board's avatar stage. */
  tick(dt: number): void {
    const v = this.lipsync?.sample(dt, this.state.speaking) ?? SILENT;
    const now = performance.now();
    this.follower.tick(now);
    this.watchdog(now);
    this.mouthHistory.push({ at: now, v });
    const lead = this.player?.leadMs ?? 0;
    while (this.mouthHistory.length > 2 && this.mouthHistory[1].at <= now - lead) this.mouthHistory.shift();
    this.avatar?.setVisemes(this.mouthHistory[0].v);
    if (this.state.viewers > 0 && now - this.lastMouthSent > 33) {
      this.lastMouthSent = now;
      this.socket.send({ t: "mouth", v: v.map((x) => Math.round(x * 100) / 100) as Visemes });
    }
  }

  // --- tools ---------------------------------------------------------------

  private async onToolCalls(calls: FunctionCall[]): Promise<void> {
    this.lastModelAt = performance.now();
    const ctx = {
      board: this.board,
      takeNotebookPhoto: (signal: AbortSignal) => this.takeNotebookPhoto(signal),
      react: (e: Emotion, g: Gesture) => this.react(e, g),
      onBoardChange: () => this.pointAtBoard(),
      locate: locateOnPhoto,
      findImage,
    };
    const responses = await Promise.all(
      calls.map(async (call) => {
        const ctl = new AbortController();
        if (call.id) this.pending.set(call.id, ctl);
        try {
          return await runTool(call, ctx, ctl.signal);
        } finally {
          if (call.id) this.pending.delete(call.id);
        }
      }),
    );
    this.tutor?.respond(responses);
    this.toolRespondedAt = performance.now();
  }

  react(emotion: Emotion, gesture: Gesture): void {
    this.avatar?.emote(emotion);
    this.avatar?.playGesture(gesture);
    this.socket.send({ t: "emote", emotion });
    if (gesture !== "none") this.socket.send({ t: "gesture", gesture });
  }

  /** Something new went on the board: point at the first new item once it's on screen. */
  private pointAtBoard(): void {
    const fresh = this.board.snapshot().find((it) => it.id > this.seenItemId);
    const newest = this.board.snapshot().at(-1);
    if (newest) this.seenItemId = Math.max(this.seenItemId, newest.id);
    if (!fresh) return;
    // Give React a moment to put the new item on the page.
    setTimeout(() => this.pointAtItem(fresh.id), 150);
  }

  /**
   * Point at a board item: her arm on the laptop, and the same spot on the
   * phone as fractions of the marker board. Pointing again within a few
   * seconds would look twitchy, so she only glances instead.
   */
  private pointAtItem(id: number): void {
    const now = performance.now();
    if (this.state.phoneBoard) {
      // The laptop is showing markers; the phone knows where it drew this item.
      if (now - this.lastPoint < 3500) return;
      this.lastPoint = now;
      logEvent("point", String(id));
      this.socket.send({ t: "point-item", id });
      return;
    }
    const el =
      document.querySelector(`.board-item[data-id="${id}"] .line-ink`) ??
      document.querySelector(`.board-item[data-id="${id}"] > *`);
    const r = el?.getBoundingClientRect();
    if (!r?.width || now - this.lastPoint < 3500) {
      this.avatar?.look("board", 1.2);
      this.socket.send({ t: "look", at: "board" });
      return;
    }
    this.lastPoint = now;
    logEvent("point", String(id));
    // Near the start of the line, where a teacher's finger would go.
    const x = r.left + Math.min(48, r.width * 0.2);
    const y = r.top + Math.min(r.height / 2, 40);
    if (this.stage) this.stage.pointAtScreen(x, y);
    else this.avatar?.playGesture("point_board");
    const layout = this.layout?.t === "layout" ? this.layout : null;
    if (layout) {
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      this.socket.send({ t: "point", x: clamp(x / layout.w), y: clamp(y / layout.h) });
    }
  }

  // --- camera --------------------------------------------------------------

  private async takeNotebookPhoto(signal: AbortSignal): Promise<Photo | null> {
    const wasOn = this.camera.active;
    try {
      await this.camera.start();
    } catch {
      return null;
    }
    try {
      for (let s = 3; s > 0; s--) {
        if (signal.aborted) return null;
        this.set({ countdown: s });
        await new Promise((r) => setTimeout(r, 1000));
      }
      this.set({ countdown: 0 });
      const photo = this.camera.capture(1600, 0.85);
      await new Promise((r) => setTimeout(r, 250));
      return photo;
    } finally {
      this.set({ countdown: null });
      if (!wasOn && !this.state.seeMe) this.camera.stop();
    }
  }

  /** Let Mochi see the student: one small frame every few seconds. */
  async setSeeMe(on: boolean): Promise<void> {
    clearInterval(this.frameTimer);
    if (!on) {
      if (this.state.countdown === null) this.camera.stop();
      this.set({ seeMe: false });
      return;
    }
    try {
      await this.camera.start();
    } catch {
      this.set({ seeMe: false, error: "Couldn't open the camera." });
      return;
    }
    this.set({ seeMe: true });
    this.frameTimer = setInterval(() => {
      if (!this.tutor?.connected || this.state.countdown !== null) return;
      const frame = this.camera.capture(640, 0.6);
      if (frame) this.tutor.sendFrame(frame.base64);
    }, 3000);
  }

  // --- phone link ------------------------------------------------------------

  private ping(): void {
    if (this.state.viewers === 0) return;
    const id = Math.floor(Math.random() * 1e9);
    this.pings.set(id, performance.now());
    if (this.pings.size > 20) this.pings.delete(this.pings.keys().next().value as number);
    this.socket.send({ t: "ping", id });
  }

  private onRoundTrip(ms: number): void {
    const prev = this.state.linkMs ?? ms;
    const smoothed = prev * 0.7 + ms * 0.3;
    this.set({ linkMs: Math.round(smoothed) });
    // Delay the laptop speakers by about one network hop so the phone's lips line up.
    this.player?.setLead(Math.min(150, Math.max(0, smoothed / 2 + 15)));
  }
}
