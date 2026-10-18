import type { FunctionCall } from "@google/genai";
import type { MochiAvatar } from "../avatar/mochi";
import { Mic } from "../live/audio/mic";
import { Player } from "../live/audio/player";
import { LipSync, SILENT } from "../live/lipsync";
import { type LiveStatus, LiveTutor } from "../live/session";
import type { BoardMessage, Emotion, Gesture, MarkerLayout, Visemes } from "../shared/protocol";
import { StageSocket } from "../shared/stage-socket";
import { stripEmoji } from "../shared/text";
import { Camera } from "./camera";
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
}

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
  private pings = new Map<number, number>();
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private frameTimer: ReturnType<typeof setInterval> | undefined;
  private captionTimer: ReturnType<typeof setTimeout> | undefined;
  private turnOpen = false;
  private userTalkingSince = 0;
  private userQuietSince = 0;
  private pending = new Map<string, AbortController>();
  private readonly mood = new MoodTracker((emotion, gesture) => this.react(emotion, gesture));

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
        }
      } else if (m.t === "pong") {
        const sent = this.pings.get(m.id);
        this.pings.delete(m.id);
        if (sent !== undefined) this.onRoundTrip(performance.now() - sent);
      }
    });
    this.pingTimer = setInterval(() => this.ping(), 2000);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private set(patch: Partial<LessonState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  attachAvatar(avatar: MochiAvatar): void {
    this.avatar = avatar;
  }

  setLayout(w: number, h: number, markers: MarkerLayout[]): void {
    this.layout = { t: "layout", w, h, markers };
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
        audio: (b64) => this.player?.push(b64),
        interrupted: () => {
          this.player?.clear();
          this.closeTurn();
        },
        turnComplete: () => this.closeTurn(),
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
    if (loud) {
      if (!this.userTalkingSince) this.userTalkingSince = now;
      this.userQuietSince = 0;
      if (now - this.userTalkingSince > 250 && !this.state.speaking) this.avatar?.look("student");
    } else if (this.userTalkingSince) {
      if (!this.userQuietSince) this.userQuietSince = now;
      // The student paused after talking for a bit: look thoughtful while Gemini answers.
      if (now - this.userQuietSince > 350) {
        if (now - this.userTalkingSince > 900 && !this.state.speaking) this.react("thinking", "none");
        this.userTalkingSince = 0;
        this.userQuietSince = 0;
      }
    }
  }

  private onUserText(text: string): void {
    clearTimeout(this.captionTimer);
    if (this.turnOpen) {
      this.turnOpen = false;
      this.set({ mochiSays: "" });
    }
    this.set({ youSaid: (this.state.youSaid + text).slice(-220) });
  }

  private onMochiText(text: string): void {
    clearTimeout(this.captionTimer);
    const clean = stripEmoji(text);
    this.mood.push(clean);
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

  /** Called every animation frame by the board's avatar stage. */
  tick(dt: number): void {
    const v = this.lipsync?.sample(dt, this.state.speaking) ?? SILENT;
    const now = performance.now();
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
    const ctx = {
      board: this.board,
      takeNotebookPhoto: (signal: AbortSignal) => this.takeNotebookPhoto(signal),
      react: (e: Emotion, g: Gesture) => this.react(e, g),
      onBoardChange: () => this.pointAtBoard(),
      locate: locateOnPhoto,
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
  }

  react(emotion: Emotion, gesture: Gesture): void {
    this.avatar?.emote(emotion);
    this.avatar?.playGesture(gesture);
    this.socket.send({ t: "emote", emotion });
    if (gesture !== "none") this.socket.send({ t: "gesture", gesture });
  }

  private pointAtBoard(): void {
    const now = performance.now();
    if (now - this.lastPoint < 5000) {
      this.avatar?.look("board", 1.2);
      this.socket.send({ t: "look", at: "board" });
      return;
    }
    this.lastPoint = now;
    this.avatar?.playGesture("point_board");
    this.socket.send({ t: "gesture", gesture: "point_board" });
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
