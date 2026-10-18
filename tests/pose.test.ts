import { describe, expect, test } from "bun:test";
import { MARKER_DICTIONARY, MARKER_SVG_CELLS, markerLayout, registerMarkerDictionary } from "../src/shared/markers";
import { AR } from "../src/vendor/aruco/aruco.js";
import { type BoardLayout, markerCorners, poseFromDetections } from "../src/viewer/board-pose";
import {
  applyH,
  decomposePose,
  estimateFocal,
  invert3,
  type Mat3,
  mul3,
  type Pose,
  project,
  solveHomography,
  type Vec2,
} from "../src/viewer/pose";

registerMarkerDictionary(AR);

function rotation(yaw: number, pitch: number, roll: number): Mat3 {
  const [cy, sy, cp, sp, cr, sr] = [
    Math.cos(yaw),
    Math.sin(yaw),
    Math.cos(pitch),
    Math.sin(pitch),
    Math.cos(roll),
    Math.sin(roll),
  ];
  const Ry: Mat3 = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rx: Mat3 = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  const Rz: Mat3 = [cr, -sr, 0, sr, cr, 0, 0, 0, 1];
  return mul3(mul3(Rz, Rx), Ry);
}

function homographyFor(pose: Pose, f: number, cx: number, cy: number): Mat3 {
  const { R, t } = pose;
  const K: Mat3 = [f, 0, cx, 0, f, cy, 0, 0, 1];
  return mul3(K, [R[0], R[1], t[0], R[3], R[4], t[1], R[6], R[7], t[2]]);
}

function angleBetween(a: Mat3, b: Mat3): number {
  // angle of a^T b
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) tr += a[k * 3 + i] * b[k * 3 + i];
  return Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2)));
}

// A phone frame analysed at 1280x720 with a 66 degree lens, looking at a 30 cm
// wide screen from about 50 cm, turned and tilted.
const W = 1280;
const H = 720;
const F = W / 2 / Math.tan((66 * Math.PI) / 360);
const truth: Pose = { R: rotation(0.45, -0.3, 0.06), t: [0.08, 0.05, 1.67] };

describe("pose maths", () => {
  test("homography from exact correspondences", () => {
    const Htrue = homographyFor(truth, F, W / 2, H / 2);
    const src: Vec2[] = [
      [-0.5, -0.3],
      [0.5, -0.3],
      [0.5, 0.3],
      [-0.5, 0.3],
      [0.1, 0.05],
    ];
    const dst = src.map((p) => applyH(Htrue, p));
    const Hest = solveHomography(src, dst);
    expect(Hest).not.toBeNull();
    for (const p of [
      [0.2, -0.1],
      [-0.4, 0.25],
    ] as Vec2[]) {
      const a = applyH(Hest as Mat3, p);
      const b = applyH(Htrue, p);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);
    }
  });

  test("focal length and pose are recovered", () => {
    const Hm = homographyFor(truth, F, W / 2, H / 2);
    expect(estimateFocal(Hm, W / 2, H / 2)).toBeCloseTo(F, 3);
    const pose = decomposePose(Hm, F, W / 2, H / 2);
    expect(angleBetween(pose.R, truth.R)).toBeLessThan(1e-6);
    for (let i = 0; i < 3; i++) expect(pose.t[i]).toBeCloseTo(truth.t[i], 6);
    expect(project(pose, F, W / 2, H / 2, [0.3, 0.2])).toEqual(
      expect.arrayContaining([expect.any(Number), expect.any(Number)]),
    );
  });

  test("head-on views don't produce a focal estimate", () => {
    const Hm = homographyFor({ R: rotation(0, 0, 0), t: [0, 0, 1.2] }, F, W / 2, H / 2);
    expect(estimateFocal(Hm, W / 2, H / 2)).toBeNull();
  });

  test("invert3 round trips", () => {
    const m: Mat3 = [2, 1, 0, 0, 3, 1, 1, 0, 1];
    const i = invert3(m) as Mat3;
    const id = mul3(m, i);
    for (const [k, v] of [1, 0, 0, 0, 1, 0, 0, 0, 1].entries()) expect(id[k]).toBeCloseTo(v, 12);
  });
});

/** Render what a camera would see of the board with its four markers. */
function renderBoard(layout: BoardLayout, pose: Pose, f: number): Uint8ClampedArray {
  const dict = new AR.Dictionary(MARKER_DICTIONARY);
  const n = MARKER_SVG_CELLS;
  const outer = markerLayout(layout.w, layout.h);
  const Hinv = invert3(homographyFor(pose, f, W / 2, H / 2)) as Mat3;
  const data = new Uint8ClampedArray(W * H * 4);
  const sample = (x: number, y: number): number => {
    const [u, v] = applyH(Hinv, [x, y]);
    const px = u * layout.w + layout.w / 2;
    const py = v * layout.w + layout.h / 2;
    if (px < 0 || py < 0 || px > layout.w || py > layout.h) return 120;
    for (const m of outer) {
      if (px >= m.left && px < m.left + m.outer && py >= m.top && py < m.top + m.outer) {
        const cxCell = Math.floor(((px - m.left) / m.outer) * n);
        const cyCell = Math.floor(((py - m.top) / m.outer) * n);
        if (cxCell === 0 || cyCell === 0 || cxCell === n - 1 || cyCell === n - 1) return 240;
        if (cxCell === 1 || cyCell === 1 || cxCell === n - 2 || cyCell === n - 2) return 20;
        return dict.codeList[m.id][(cyCell - 2) * (n - 4) + (cxCell - 2)] === "1" ? 240 : 20;
      }
    }
    return 32;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const g =
        (sample(x + 0.25, y + 0.25) +
          sample(x + 0.75, y + 0.25) +
          sample(x + 0.25, y + 0.75) +
          sample(x + 0.75, y + 0.75)) /
        4;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = g;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("tracking a rendered board", () => {
  const board = { w: 1440, h: 900 };
  const layout: BoardLayout = {
    ...board,
    markers: markerLayout(board.w, board.h).map(({ id, x, y, size }) => ({ id, x, y, size })),
  };

  test("markers sit inside the board", () => {
    for (const m of layout.markers) {
      for (const [u, v] of markerCorners(m, layout)) {
        expect(Math.abs(u)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(v)).toBeLessThanOrEqual(board.h / board.w / 2);
      }
    }
  });

  test("all four markers are found and the pose matches", () => {
    const image = renderBoard(layout, truth, F);
    const detections = new AR.Detector({ dictionaryName: MARKER_DICTIONARY, maxHammingDistance: 1 })
      .detect({ width: W, height: H, data: image })
      .filter((d) => d.id <= 3);
    expect([...new Set(detections.map((d) => d.id))].sort()).toEqual([0, 1, 2, 3]);

    const out = poseFromDetections(detections, layout, W, H, 900);
    expect(out).not.toBeNull();
    const focal = out!.focalEstimate;
    expect(focal).not.toBeNull();
    expect(Math.abs((focal as number) - F) / F).toBeLessThan(0.06);

    // With the estimated focal length the pose should be close to the truth.
    const again = poseFromDetections(detections, layout, W, H, focal as number)!;
    expect(again.result.errorPx).toBeLessThan(1.5);
    expect(angleBetween(again.result.pose.R, truth.R)).toBeLessThan((2 * Math.PI) / 180);
    const dist = Math.hypot(...again.result.pose.t);
    expect(Math.abs(dist - Math.hypot(...truth.t)) / Math.hypot(...truth.t)).toBeLessThan(0.05);
  });
});
