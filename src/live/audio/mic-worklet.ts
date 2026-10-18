/// <reference path="./worklet-env.d.ts" />
// Audio thread: turn mic input into 16 kHz mono PCM16 and post it in 40 ms chunks,
// which is what the Live API expects. Box-filter decimation is plenty for speech.

const TARGET_RATE = 16000;
const CHUNK = 640;

class MicProcessor extends AudioWorkletProcessor {
  private readonly ratio = sampleRate / TARGET_RATE;
  private boundary = this.ratio;
  private index = 0;
  private sum = 0;
  private count = 0;
  private out = new Int16Array(CHUNK);
  private filled = 0;
  private energy = 0;

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.sum += input[i];
      this.count++;
      this.index++;
      if (this.index >= this.boundary) {
        const s = Math.max(-1, Math.min(1, this.sum / this.count));
        this.energy += s * s;
        this.out[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        this.sum = 0;
        this.count = 0;
        this.boundary += this.ratio;
        if (this.filled === CHUNK) {
          const level = Math.sqrt(this.energy / CHUNK);
          this.port.postMessage({ pcm: this.out.buffer, level }, [this.out.buffer]);
          this.out = new Int16Array(CHUNK);
          this.filled = 0;
          this.energy = 0;
        }
      }
    }
    // Keep the counters small so floating point error never builds up.
    if (this.index > 1e7) {
      this.index -= 1e7;
      this.boundary -= 1e7;
    }
    return true;
  }
}

registerProcessor("mic-processor", MicProcessor);
