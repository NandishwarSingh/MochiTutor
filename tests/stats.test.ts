import { describe, expect, test } from "bun:test";
import {
  binomialCdf,
  binomialPmf,
  combinations,
  factorial,
  gamma,
  inverseNormal,
  lnGamma,
  makeDistribution,
  normalCdf,
  poissonPmf,
  probabilityBetween,
} from "../src/lib/stats";

describe("special functions", () => {
  test("gamma and factorial", () => {
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(gamma(5)).toBeCloseTo(24, 9);
    expect(factorial(10)).toBe(3628800);
    expect(factorial(171)).toBe(Number.POSITIVE_INFINITY);
    expect(factorial(0.5)).toBeCloseTo(Math.sqrt(Math.PI) / 2, 10);
  });

  test("combinations stay exact", () => {
    expect(combinations(52, 5)).toBe(2598960);
    expect(combinations(40, 20)).toBe(137846528820);
    expect(combinations(5, 7)).toBe(0);
  });
});

describe("normal distribution", () => {
  test("cdf matches reference values", () => {
    expect(normalCdf(0)).toBe(0.5);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021048517795, 12);
    expect(normalCdf(-3)).toBeCloseTo(0.0013498980316301, 13);
    expect(normalCdf(110, 100, 15)).toBeCloseTo(0.7475074624530771, 12);
  });

  test("inverse is the inverse", () => {
    for (const p of [0.001, 0.025, 0.3, 0.5, 0.9, 0.999]) {
      expect(normalCdf(inverseNormal(p))).toBeCloseTo(p, 12);
    }
    expect(inverseNormal(0.5)).toBeCloseTo(0, 12);
  });
});

describe("discrete distributions", () => {
  test("binomial pmf sums to one, including large n", () => {
    let s = 0;
    for (let k = 0; k <= 500; k++) s += binomialPmf(500, 0.3, k);
    expect(s).toBeCloseTo(1, 10);
    expect(binomialCdf(10, 0.5, 5)).toBeCloseTo(0.623046875, 14);
  });

  test("poisson", () => {
    expect(poissonPmf(3, 2)).toBeCloseTo(0.22404180765538775, 12);
    expect(poissonPmf(0, 0)).toBe(1);
  });
});

describe("probabilityBetween", () => {
  test("discrete ranges are inclusive at both ends", () => {
    const d = makeDistribution("binomial", { n: 10, p: 0.5 });
    expect(probabilityBetween(d, 3, 3)).toBeCloseTo(0.1171875, 14);
    expect(probabilityBetween(d, 0, 10)).toBeCloseTo(1, 14);
    expect(probabilityBetween(d, 4)).toBeCloseTo(1 - binomialCdf(10, 0.5, 3), 14);
  });

  test("continuous ranges", () => {
    const d = makeDistribution("normal", { mean: 0, sd: 1 });
    expect(probabilityBetween(d, -1.96, 1.96)).toBeCloseTo(0.9500042097035593, 10);
    const e = makeDistribution("exponential", { rate: 2 });
    expect(probabilityBetween(e, undefined, 1)).toBeCloseTo(1 - Math.exp(-2), 14);
  });

  test("reports invalid parameters", () => {
    expect(() => makeDistribution("binomial", { n: 0, p: 0.5 })).toThrow("n must be");
    expect(() => makeDistribution("binomial", { n: 10, p: 2 })).toThrow("p must be");
    expect(() => makeDistribution("normal", { sd: -1 })).toThrow("sd must be");
    expect(() => makeDistribution("uniform", { min: 2, max: 1 })).toThrow("max must be");
  });

  test("summary moments", () => {
    const b = makeDistribution("binomial", { n: 20, p: 0.25 });
    expect(b.mean).toBe(5);
    expect(b.variance).toBe(3.75);
    const g = makeDistribution("geometric", { p: 0.2 });
    expect(g.mean).toBe(5);
  });
});
