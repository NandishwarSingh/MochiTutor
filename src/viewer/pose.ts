// Camera pose from the board markers. The board is a plane with known marker
// positions, so the image of those points is a homography H = K [r1 r2 t].
// From H we estimate the phone camera's focal length (the principal point is
// assumed at the image centre) and then the rotation and translation.
//
// Board coordinates: u to the right, v down, both in units of the board width,
// origin at the board centre. Camera coordinates follow OpenCV: x right, y down,
// z forward.

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
/** Row-major 3x3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export interface Pose {
  /** Row-major rotation from board to camera coordinates. */
  R: Mat3;
  t: Vec3;
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** Similarity transform that moves points to the origin with mean distance sqrt(2). */
function normalizer(pts: Vec2[]): Mat3 {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const d = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / pts.length || 1;
  const s = Math.SQRT2 / d;
  return [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
}

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return o;
}

export function invert3(m: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-15) return null;
  const k = 1 / det;
  return [
    A * k,
    -(b * i - c * h) * k,
    (b * f - c * e) * k,
    B * k,
    (a * i - c * g) * k,
    -(a * f - c * d) * k,
    C * k,
    -(a * h - b * g) * k,
    (a * e - b * d) * k,
  ];
}

export function applyH(H: Mat3, [x, y]: Vec2): Vec2 {
  const w = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
}

/** Least-squares homography from at least four point pairs (normalised DLT). */
export function solveHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  if (src.length < 4 || src.length !== dst.length) return null;
  const Ts = normalizer(src);
  const Td = normalizer(dst);
  const s = src.map((p) => applyH(Ts, p));
  const d = dst.map((p) => applyH(Td, p));
  const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0));
  const Atb = new Array(8).fill(0);
  const add = (row: number[], rhs: number) => {
    for (let i = 0; i < 8; i++) {
      Atb[i] += row[i] * rhs;
      for (let j = 0; j < 8; j++) AtA[i][j] += row[i] * row[j];
    }
  };
  for (let i = 0; i < s.length; i++) {
    const [x, y] = s[i];
    const [u, v] = d[i];
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  const h = solveLinear(AtA, Atb);
  if (!h) return null;
  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  const TdInv = invert3(Td);
  if (!TdInv) return null;
  return mul3(mul3(TdInv, Hn), Ts);
}

/**
 * Focal length in pixels from one homography, assuming square pixels and the
 * principal point at (cx, cy). Returns null when the view is too close to
 * head-on for the estimate to mean anything.
 */
export function estimateFocal(H: Mat3, cx: number, cy: number): number | null {
  const T: Mat3 = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const G = mul3(T, H);
  const [h11, h12, , h21, h22, , h31, h32] = G;
  const a1 = h11 * h12 + h21 * h22;
  const b1 = h31 * h32;
  const a2 = h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22;
  const b2 = h31 * h31 - h32 * h32;
  const denom = a1 * a1 + a2 * a2;
  if (denom === 0) return null;
  const w = -(a1 * b1 + a2 * b2) / denom;
  if (!(w > 0)) return null;
  // How much perspective there is, relative to the in-plane scale. Head-on views give ~0.
  const persp = (Math.hypot(h31, h32) * Math.sqrt(1 / w)) / Math.hypot(h11, h21, h12, h22);
  if (persp < 0.05) return null;
  return 1 / Math.sqrt(w);
}

const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => scale(v, 1 / (norm(v) || 1));

/** Rotation and translation of the board in camera coordinates. */
export function decomposePose(H: Mat3, f: number, cx: number, cy: number): Pose {
  const Kinv: Mat3 = [1 / f, 0, -cx / f, 0, 1 / f, -cy / f, 0, 0, 1];
  const M = mul3(Kinv, H);
  let m1: Vec3 = [M[0], M[3], M[6]];
  let m2: Vec3 = [M[1], M[4], M[7]];
  let t: Vec3 = [M[2], M[5], M[8]];
  const lambda = 2 / (norm(m1) + norm(m2));
  m1 = scale(m1, lambda);
  m2 = scale(m2, lambda);
  t = scale(t, lambda);
  if (t[2] < 0) {
    m1 = scale(m1, -1);
    m2 = scale(m2, -1);
    t = scale(t, -1);
  }
  // Symmetric orthonormalisation of r1 and r2, so neither axis is favoured.
  const c = unit(add(m1, m2));
  let d = sub(m1, m2);
  d = unit(sub(d, scale(c, dot(d, c))));
  const r1 = scale(add(c, d), Math.SQRT1_2);
  const r2 = scale(sub(c, d), Math.SQRT1_2);
  const r3 = cross(r1, r2);
  return { R: [r1[0], r2[0], r3[0], r1[1], r2[1], r3[1], r1[2], r2[2], r3[2]], t };
}

export function project(pose: Pose, f: number, cx: number, cy: number, [u, v]: Vec2): Vec2 {
  const { R, t } = pose;
  const x = R[0] * u + R[1] * v + t[0];
  const y = R[3] * u + R[4] * v + t[1];
  const z = R[6] * u + R[7] * v + t[2];
  return [cx + (f * x) / z, cy + (f * y) / z];
}

/**
 * The board's pose as a column-major 4x4 for three.js, where the board's own
 * frame is x right, y up, z out of the screen and the camera looks down -z.
 */
export function poseToGl({ R, t }: Pose): number[] {
  // F = S = diag(1, -1, -1); the matrix is F R S with translation F t.
  return [R[0], -R[3], -R[6], 0, -R[1], R[4], R[7], 0, -R[2], R[5], R[8], 0, t[0], -t[1], -t[2], 1];
}

/** Column-major projection matrix from pinhole intrinsics, for three.js. */
export function projectionFromIntrinsics(w: number, h: number, f: number, near = 0.01, far = 100): number[] {
  return [
    (2 * f) / w,
    0,
    0,
    0,
    0,
    (2 * f) / h,
    0,
    0,
    0,
    0,
    -(far + near) / (far - near),
    -1,
    0,
    0,
    (-2 * far * near) / (far - near),
    0,
  ];
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
