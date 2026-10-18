import workletUrl from "./mic-worklet.ts?worker&url";

export type MicChunk = (pcm: Int16Array, level: number) => void;

/** Captures the microphone as 16 kHz PCM16 with the browser's echo cancellation on. */
export class Mic {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  muted = false;

  constructor(private readonly onChunk: MicChunk) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await this.ctx.audioWorklet.addModule(workletUrl);
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "mic-processor");
    this.node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      if (!this.muted) this.onChunk(new Int16Array(e.data.pcm), e.data.level);
      else this.onChunk(new Int16Array(e.data.pcm.byteLength / 2), 0);
    };
    source.connect(this.node);
    // The worklet must be pulled by the graph to run; route it to a silent sink.
    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    this.node.connect(sink).connect(this.ctx.destination);
    await this.ctx.resume();
  }

  stop(): void {
    this.node?.disconnect();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.stream = null;
    this.node = null;
  }
}
