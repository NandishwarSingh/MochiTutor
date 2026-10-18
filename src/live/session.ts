import {
  type FunctionCall,
  type FunctionResponse,
  GoogleGenAI,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { buildLiveConfig, OPENING_CUE } from "./config";

export type LiveStatus = "idle" | "connecting" | "live" | "reconnecting" | "ended" | "error";

export interface LiveHandlers {
  status(status: LiveStatus, detail?: string): void;
  audio(b64: string): void;
  interrupted(): void;
  turnComplete(): void;
  userText(text: string): void;
  mochiText(text: string): void;
  toolCalls(calls: FunctionCall[]): void;
  toolCancel(ids: string[]): void;
}

interface Grant {
  token: string;
  model: string;
  voice: string;
}

async function requestGrant(resumeHandle?: string): Promise<Grant> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(resumeHandle ? { resumeHandle } : {}),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<Grant> & { error?: string };
  if (!res.ok || !body.token || !body.model || !body.voice) {
    throw new Error(body.error ?? `The server answered ${res.status}`);
  }
  return body as Grant;
}

function int16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** One tutoring call with Gemini Live, from the browser, on a short-lived token. */
export class LiveTutor {
  private session: Session | null = null;
  private resumeHandle: string | undefined;
  private stopped = false;
  private greeted = false;
  private reconnects = 0;

  constructor(private readonly on: LiveHandlers) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.on.status("connecting");
    await this.connect();
  }

  private async connect(): Promise<void> {
    const grant = await requestGrant(this.resumeHandle);
    const ai = new GoogleGenAI({ apiKey: grant.token, httpOptions: { apiVersion: "v1alpha" } });
    let ready!: () => void;
    let failed!: (e: Error) => void;
    const setup = new Promise<void>((resolve, reject) => {
      ready = resolve;
      failed = reject;
    });
    const session = await ai.live.connect({
      model: grant.model,
      config: buildLiveConfig({ voice: grant.voice, resumeHandle: this.resumeHandle }),
      callbacks: {
        onmessage: (m) => {
          if (m.setupComplete) ready();
          this.handle(m);
        },
        onerror: (e) => {
          failed(new Error(e.message || "Connection error"));
        },
        onclose: (e) => {
          failed(new Error(e.reason || `Connection closed (${e.code})`));
          if (this.session === session) this.session = null;
          if (!this.stopped) void this.recover(e.reason || `closed with code ${e.code}`);
        },
      },
    });
    this.session = session;
    await setup;
    this.reconnects = 0;
    this.on.status("live");
    if (!this.greeted) {
      this.greeted = true;
      session.sendClientContent({ turns: [{ role: "user", parts: [{ text: OPENING_CUE }] }], turnComplete: true });
    }
  }

  private async recover(reason: string): Promise<void> {
    if (this.stopped) return;
    if (!this.resumeHandle || this.reconnects >= 3) {
      this.on.status("error", `The call dropped: ${reason}`);
      return;
    }
    this.reconnects++;
    this.on.status("reconnecting");
    try {
      await this.connect();
    } catch (err) {
      this.on.status("error", err instanceof Error ? err.message : String(err));
    }
  }

  private handle(m: LiveServerMessage): void {
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = m.sessionResumptionUpdate.newHandle;
    }
    if (m.goAway && this.session) {
      // The server is about to close this connection; move to a fresh one now.
      const old = this.session;
      this.session = null;
      old.close();
    }
    if (m.toolCall?.functionCalls?.length) this.on.toolCalls(m.toolCall.functionCalls);
    if (m.toolCallCancellation?.ids?.length) this.on.toolCancel(m.toolCallCancellation.ids);
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) this.on.interrupted();
    for (const part of sc.modelTurn?.parts ?? []) {
      if (part.inlineData?.data && part.inlineData.mimeType?.startsWith("audio/")) this.on.audio(part.inlineData.data);
    }
    if (sc.inputTranscription?.text) this.on.userText(sc.inputTranscription.text);
    if (sc.outputTranscription?.text) this.on.mochiText(sc.outputTranscription.text);
    if (sc.turnComplete) this.on.turnComplete();
  }

  sendAudio(pcm: Int16Array): void {
    this.session?.sendRealtimeInput({ audio: { data: int16ToBase64(pcm), mimeType: "audio/pcm;rate=16000" } });
  }

  sendFrame(jpegBase64: string): void {
    this.session?.sendRealtimeInput({ video: { data: jpegBase64, mimeType: "image/jpeg" } });
  }

  respond(responses: FunctionResponse[]): void {
    if (responses.length) this.session?.sendToolResponse({ functionResponses: responses });
  }

  get connected(): boolean {
    return this.session !== null;
  }

  stop(): void {
    this.stopped = true;
    const s = this.session;
    this.session = null;
    s?.close();
    this.on.status("ended");
  }
}
