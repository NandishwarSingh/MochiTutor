/// <reference path="./worklet-env.d.ts" />
// Audio thread: play Mochi's voice from a ring buffer. Gemini sends audio faster
// than real time, so chunks queue here; "clear" drops everything instantly when
// the student interrupts.

type Command = { type: "push"; samples: Float32Array } | { type: "clear" };

class PlayerProcessor extends AudioWorkletProcessor {
  private readonly ring = new Float32Array(sampleRate * 90);
  private read = 0;
  private write = 0;
  private playing = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Command>) => {
      const cmd = e.data;
      if (cmd.type === "clear") {
        this.read = this.write;
        return;
      }
      const { samples } = cmd;
      const size = this.ring.length;
      for (let i = 0; i < samples.length; i++) {
        this.ring[this.write] = samples[i];
        this.write = (this.write + 1) % size;
        if (this.write === this.read) this.read = (this.read + 1) % size;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]?.[0];
    if (!out) return true;
    const size = this.ring.length;
    let wrote = false;
    for (let i = 0; i < out.length; i++) {
      if (this.read !== this.write) {
        out[i] = this.ring[this.read];
        this.read = (this.read + 1) % size;
        wrote = true;
      } else {
        out[i] = 0;
      }
    }
    if (wrote !== this.playing) {
      this.playing = wrote;
      this.port.postMessage({ playing: wrote });
    }
    return true;
  }
}

registerProcessor("player-processor", PlayerProcessor);
