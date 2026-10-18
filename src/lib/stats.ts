// Probability helpers used by the calculator and the board widgets. Everything
// here is pure so it can be tested against known values.

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const z = x - 1;
  let a = 0.99999999999980993;
  const t = z + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

export function gamma(x: number): number {
  if (Number.isInteger(x) && x <= 0) return Number.NaN;
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  return Math.exp(lnGamma(x));
}

export function factorial(n: number): number {
  if (n < 0) return Number.NaN;
  if (!Number.isInteger(n)) return gamma(n + 1);
  if (n > 170) return Number.POSITIVE_INFINITY;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

export function combinations(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k)) {
    return Math.exp(lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1));
  }
  if (k < 0 || k > n) return 0;
  const m = Math.min(k, n - k);
  let r = 1;
  for (let i = 1; i <= m; i++) {
    r = (r * (n - m + i)) / i;
  }
  return r < 2 ** 53 ? Math.round(r) : r;
}

export function permutations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r *= n - i;
  return r;
}

export function binomialPmf(n: number, p: number, k: number): number {
  if (!Number.isInteger(k) || k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  const lnC = lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1);
  if (n <= 60) return combinations(n, k) * p ** k * (1 - p) ** (n - k);
  return Math.exp(lnC + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

export function binomialCdf(n: number, p: number, k: number): number {
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let i = 0; i <= Math.floor(k); i++) s += binomialPmf(n, p, i);
  return Math.min(1, s);
}

export function poissonPmf(lambda: number, k: number): number {
  if (!Number.isInteger(k) || k < 0) return 0;
  if (lambda === 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - lnGamma(k + 1));
}

export function poissonCdf(lambda: number, k: number): number {
  if (k < 0) return 0;
  let s = 0;
  for (let i = 0; i <= Math.floor(k); i++) s += poissonPmf(lambda, i);
  return Math.min(1, s);
}

/** Trials up to and including the first success, k >= 1. */
export function geometricPmf(p: number, k: number): number {
  if (!Number.isInteger(k) || k < 1) return 0;
  return (1 - p) ** (k - 1) * p;
}

export function geometricCdf(p: number, k: number): number {
  if (k < 1) return 0;
  return 1 - (1 - p) ** Math.floor(k);
}

export function normalPdf(x: number, mean = 0, sd = 1): number {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** Standard normal CDF, Hart's algorithm as given by West (2005); about 1e-14 absolute error. */
function phi(x: number): number {
  const z = Math.abs(x);
  let c = 0;
  if (z <= 37) {
    const e = Math.exp((-z * z) / 2);
    if (z < 7.07106781186547) {
      let n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165;
      n = n * z + 33.912866078383;
      n = n * z + 112.079291497871;
      n = n * z + 221.213596169931;
      n = n * z + 220.206867912376;
      let d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207;
      d = d * z + 86.7807322029461;
      d = d * z + 296.564248779674;
      d = d * z + 637.333633378831;
      d = d * z + 793.826512519948;
      d = d * z + 440.413735824752;
      c = (e * n) / d;
    } else {
      let f = z + 0.65;
      f = z + 4 / f;
      f = z + 3 / f;
      f = z + 2 / f;
      f = z + 1 / f;
      c = e / f / 2.506628274631;
    }
  }
  return x <= 0 ? c : 1 - c;
}

export function normalCdf(x: number, mean = 0, sd = 1): number {
  return phi((x - mean) / sd);
}

/** Inverse standard normal (Acklam) with one Halley refinement step. */
export function inverseNormal(p: number, mean = 0, sd = 1): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x =
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5;
    const r = q * q;
    x =
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x =
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const e = phi(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return mean + sd * x;
}

export type DistributionFamily = "binomial" | "poisson" | "geometric" | "normal" | "uniform" | "exponential";

export interface DistributionParams {
  n?: number;
  p?: number;
  lambda?: number;
  mean?: number;
  sd?: number;
  min?: number;
  max?: number;
  rate?: number;
}

export interface Distribution {
  family: DistributionFamily;
  discrete: boolean;
  label: string;
  /** pmf for discrete families, pdf for continuous ones */
  density: (x: number) => number;
  cdf: (x: number) => number;
  mean: number;
  variance: number;
  /** a sensible x range to draw */
  range: [number, number];
}

function need(value: number | undefined, name: string, check: (v: number) => boolean, rule: string): number {
  if (value === undefined || !Number.isFinite(value) || !check(value)) {
    throw new Error(`${name} ${rule}`);
  }
  return value;
}

export function makeDistribution(family: DistributionFamily, params: DistributionParams): Distribution {
  switch (family) {
    case "binomial": {
      const n = need(
        params.n,
        "n",
        (v) => Number.isInteger(v) && v >= 1 && v <= 1000,
        "must be a whole number from 1 to 1000",
      );
      const p = need(params.p, "p", (v) => v >= 0 && v <= 1, "must be between 0 and 1");
      return {
        family,
        discrete: true,
        label: `Binomial(n = ${n}, p = ${p})`,
        density: (k) => binomialPmf(n, p, k),
        cdf: (k) => binomialCdf(n, p, k),
        mean: n * p,
        variance: n * p * (1 - p),
        range: [0, n],
      };
    }
    case "poisson": {
      const lambda = need(params.lambda, "lambda", (v) => v > 0 && v <= 500, "must be above 0 and at most 500");
      const hi = Math.ceil(lambda + 4 * Math.sqrt(lambda) + 3);
      return {
        family,
        discrete: true,
        label: `Poisson(λ = ${lambda})`,
        density: (k) => poissonPmf(lambda, k),
        cdf: (k) => poissonCdf(lambda, k),
        mean: lambda,
        variance: lambda,
        range: [0, hi],
      };
    }
    case "geometric": {
      const p = need(params.p, "p", (v) => v > 0 && v <= 1, "must be above 0 and at most 1");
      const hi = Math.max(5, Math.ceil(Math.log(0.002) / Math.log(1 - p || 0.5)));
      return {
        family,
        discrete: true,
        label: `Geometric(p = ${p})`,
        density: (k) => geometricPmf(p, k),
        cdf: (k) => geometricCdf(p, k),
        mean: 1 / p,
        variance: (1 - p) / (p * p),
        range: [1, Math.min(hi, 200)],
      };
    }
    case "normal": {
      const mean = need(params.mean ?? 0, "mean", () => true, "must be a number");
      const sd = need(params.sd ?? 1, "sd", (v) => v > 0, "must be above 0");
      return {
        family,
        discrete: false,
        label: `Normal(μ = ${mean}, σ = ${sd})`,
        density: (x) => normalPdf(x, mean, sd),
        cdf: (x) => normalCdf(x, mean, sd),
        mean,
        variance: sd * sd,
        range: [mean - 4 * sd, mean + 4 * sd],
      };
    }
    case "uniform": {
      const min = need(params.min ?? 0, "min", () => true, "must be a number");
      const max = need(params.max ?? 1, "max", (v) => v > min, "must be greater than min");
      const w = max - min;
      return {
        family,
        discrete: false,
        label: `Uniform(${min}, ${max})`,
        density: (x) => (x >= min && x <= max ? 1 / w : 0),
        cdf: (x) => (x <= min ? 0 : x >= max ? 1 : (x - min) / w),
        mean: (min + max) / 2,
        variance: (w * w) / 12,
        range: [min - 0.15 * w, max + 0.15 * w],
      };
    }
    case "exponential": {
      const rate = need(params.rate ?? params.lambda, "rate", (v) => v > 0, "must be above 0");
      return {
        family,
        discrete: false,
        label: `Exponential(λ = ${rate})`,
        density: (x) => (x < 0 ? 0 : rate * Math.exp(-rate * x)),
        cdf: (x) => (x <= 0 ? 0 : 1 - Math.exp(-rate * x)),
        mean: 1 / rate,
        variance: 1 / (rate * rate),
        range: [0, 5 / rate],
      };
    }
  }
}

/** P(from <= X <= to). Open ends default to the whole support. */
export function probabilityBetween(dist: Distribution, from?: number, to?: number): number {
  const lo = from ?? Number.NEGATIVE_INFINITY;
  const hi = to ?? Number.POSITIVE_INFINITY;
  if (hi < lo) return 0;
  if (dist.discrete) {
    const upper = Number.isFinite(hi) ? dist.cdf(Math.floor(hi)) : 1;
    const lower = Number.isFinite(lo) ? dist.cdf(Math.ceil(lo) - 1) : 0;
    return Math.max(0, upper - lower);
  }
  const upper = Number.isFinite(hi) ? dist.cdf(hi) : 1;
  const lower = Number.isFinite(lo) ? dist.cdf(lo) : 0;
  return Math.max(0, upper - lower);
}
