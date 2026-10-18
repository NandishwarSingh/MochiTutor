import workletUrl from "./player-worklet.ts?worker&url";

const OUTPUT_RATE = 24000;

export function base64ToFloat32(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v / 0x8000;
  }
  return out;
}

/**
 * Plays Mochi's 24 kHz voice. The analyser sits before a short delay so lip
 * sync can be computed a little ahead of what the speakers play; that head
 * start covers the network hop to the phone.
 */
export class Player {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private delay: DelayNode | null = null;
  analyser: AnalyserNode | null = null;
  playing = false;

  constructor(private readonly onPlaying: (playing: boolean) => void) {}

  async start(): Promise<void> {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_RATE, latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.node = new AudioWorkletNode(this.ctx, "player-processor", { outputChannelCount: [1] });
    this.node.port.onmessage = (e: MessageEvent<{ playing: boolean }>) => {
      this.playing = e.data.playing;
      this.onPlaying(e.data.playing);
    };
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.2;
    this.delay = this.ctx.createDelay(0.5);
    this.node.connect(this.analyser);
    this.analyser.connect(this.delay).connect(this.ctx.destination);
    await this.ctx.resume();
  }

  push(b64: string): void {
    const samples = base64ToFloat32(b64);
    this.node?.port.postMessage({ type: "push", samples }, [samples.buffer]);
  }

  clear(): void {
    this.node?.port.postMessage({ type: "clear" });
  }

  /** How far the speakers lag the analyser, in milliseconds. */
  setLead(ms: number): void {
    if (this.delay && this.ctx) this.delay.delayTime.setTargetAtTime(ms / 1000, this.ctx.currentTime, 0.05);
  }

  get leadMs(): number {
    return (this.delay?.delayTime.value ?? 0) * 1000;
  }

  stop(): void {
    this.node?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.node = null;
    this.analyser = null;
  }
}
