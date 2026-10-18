import { describe, expect, test } from "bun:test";
import { smoothVisemes, visemesFromSpectrum } from "../src/live/lipsync";
import type { Visemes } from "../src/shared/protocol";

const BIN = 24000 / 1024;

/** A spectrum at -110 dB with a loud bump around the given frequencies. */
function spectrum(peaks: Array<[number, number]>, loudDb = -45): Float32Array {
  const s = new Float32Array(512).fill(-110);
  for (const [hz, width] of peaks) {
    for (let i = 0; i < s.length; i++) {
      if (Math.abs(i * BIN - hz) < width) s[i] = loudDb;
    }
  }
  return s;
}

const argmax = (v: Visemes) => v.indexOf(Math.max(...v));
const [AA, , OU, EE] = [0, 1, 2, 3, 4];

describe("visemesFromSpectrum", () => {
  test("silence keeps the mouth closed", () => {
    expect(visemesFromSpectrum(new Float32Array(512).fill(-120), BIN)).toEqual([0, 0, 0, 0, 0]);
  });

  test("energy around 700-1000 Hz opens to aa", () => {
    expect(argmax(visemesFromSpectrum(spectrum([[800, 250]]), BIN))).toBe(AA);
  });

  test("energy high in the spectrum spreads to ee", () => {
    expect(
      argmax(
        visemesFromSpectrum(
          spectrum([
            [300, 120],
            [2900, 600],
          ]),
          BIN,
        ),
      ),
    ).toBe(EE);
  });

  test("only low energy rounds to ou", () => {
    expect(argmax(visemesFromSpectrum(spectrum([[300, 140]]), BIN))).toBe(OU);
  });

  test("louder opens wider", () => {
    const quiet = visemesFromSpectrum(spectrum([[800, 250]], -62), BIN);
    const loud = visemesFromSpectrum(spectrum([[800, 250]], -42), BIN);
    expect(loud.reduce((a, b) => a + b)).toBeGreaterThan(quiet.reduce((a, b) => a + b));
    for (const v of loud) expect(v).toBeLessThanOrEqual(1);
  });
});

describe("smoothVisemes", () => {
  test("moves toward the target without overshooting", () => {
    const a = smoothVisemes([0, 0, 0, 0, 0], [1, 0, 0, 0, 0], 1 / 60);
    expect(a[0]).toBeGreaterThan(0.2);
    expect(a[0]).toBeLessThan(1);
    const b = smoothVisemes([1, 0, 0, 0, 0], [0, 0, 0, 0, 0], 10);
    expect(b[0]).toBeCloseTo(0, 6);
  });
});
