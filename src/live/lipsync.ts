import type { Visemes } from "../shared/protocol";

// Mouth shapes from audio alone, so it works the same for Hindi and English.
// Loudness opens the mouth; where the energy sits in the spectrum picks the
// vowel shape (open "aa", rounded "oh"/"ou", spread "ee", teeth "ih").

const BANDS: Array<[number, number]> = [
  [150, 500],
  [500, 1100],
  [1100, 2200],
  [2200, 4000],
  [4000, 8000],
];

export const SILENT: Visemes = [0, 0, 0, 0, 0];

/**
 * @param db magnitudes in decibels, as from AnalyserNode.getFloatFrequencyData
 * @param binHz width of one frequency bin
 */
export function visemesFromSpectrum(db: Float32Array, binHz: number, floorDb = -78, rangeDb = 40): Visemes {
  const energy = BANDS.map(([lo, hi]) => {
    let e = 0;
    const a = Math.max(1, Math.floor(lo / binHz));
    const b = Math.min(db.length - 1, Math.ceil(hi / binHz));
    for (let i = a; i <= b; i++) e += 10 ** (db[i] / 10);
    return e / Math.max(1, b - a + 1);
  });
  const total = energy.reduce((s, e) => s + e, 0);
  if (total <= 0) return [...SILENT];
  const loudDb = 10 * Math.log10(total / energy.length);
  const open = Math.min(1, Math.max(0, (loudDb - floorDb) / rangeDb));
  if (open < 0.04) return [...SILENT];

  const [r1, r2, r3, r4, r5] = energy.map((e) => e / total);
  const score = {
    aa: 1.5 * r2 + 0.5 * r3 + 0.2,
    ih: 1.4 * r5 + 0.4 * r3,
    ou: 1.6 * r1 - 0.8 * (r3 + r4),
    ee: 1.8 * r4 + 0.4 * r3 - 0.6 * r2,
    oh: 1.0 * (r1 + r2) - 1.0 * r4 - 0.3 * r5,
  };
  const vals = [score.aa, score.ih, score.ou, score.ee, score.oh].map((v) => Math.max(0, v) ** 2);
  const sum = vals.reduce((s, v) => s + v, 0) || 1;
  return vals.map((v) => Math.min(1, (v / sum) * open * 1.15)) as Visemes;
}

/** Frame-rate independent smoothing: open fast, close a bit slower. */
export function smoothVisemes(prev: Visemes, next: Visemes, dtSec: number): Visemes {
  return prev.map((p, i) => {
    const target = next[i];
    const rate = target > p ? 28 : 16;
    const k = 1 - Math.exp(-rate * dtSec);
    return p + (target - p) * k;
  }) as Visemes;
}

/** Samples an AnalyserNode each animation frame. */
export class LipSync {
  private readonly spectrum: Float32Array<ArrayBuffer>;
  private current: Visemes = [...SILENT];

  constructor(private readonly analyser: AnalyserNode) {
    this.spectrum = new Float32Array(analyser.frequencyBinCount);
  }

  sample(dtSec: number, active: boolean): Visemes {
    let target: Visemes = SILENT;
    if (active) {
      this.analyser.getFloatFrequencyData(this.spectrum);
      target = visemesFromSpectrum(this.spectrum, this.analyser.context.sampleRate / this.analyser.fftSize);
    }
    this.current = smoothVisemes(this.current, target, dtSec);
    return this.current;
  }
}
