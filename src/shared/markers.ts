// The markers the phone tracks. A tiny 4x4 dictionary with only the codes we
// use: big cells for their size, and far apart from each other, so they
// decode from across a desk. The first four are the first four of OpenCV's
// DICT_4X4_1000 (BSD-3-Clause, OpenCV Foundation) and sit in the board's
// corners. The other twelve were picked by a greedy search so that every pair
// differs in at least 5 of the 16 cells in every rotation, and no code looks
// like itself turned; they fill the screen in phone mode.

export const MARKER_DICTIONARY = "MOCHI_4X4";
export const CODES = [
  [181, 50],
  [15, 154],
  [51, 45],
  [153, 70],
  [6, 110],
  [9, 183],
  [11, 205],
  [17, 235],
  [21, 157],
  [26, 188],
  [88, 93],
  [32, 242],
  [95, 75],
  [121, 59],
  [23, 166],
  [30, 101],
];

/** Cells across the generated SVG: 1 quiet + 1 border + 4 data + 1 border + 1 quiet. */
export const MARKER_SVG_CELLS = 8;
/** Share of the board width each marker (with its white border) takes. */
export const MARKER_WIDTH_SHARE = 0.12;

/** Marker ids by corner: top-left, top-right, bottom-right, bottom-left. */
export const CORNER_IDS = [0, 1, 2, 3] as const;
const INSET = 14;

export interface PlacedMarker {
  id: number;
  /** the black marker square, which is what the detector reports */
  x: number;
  y: number;
  size: number;
  /** the whole SVG including its white border */
  left: number;
  top: number;
  outer: number;
}

/** Where the four markers sit on a board of w x h CSS pixels. */
export function markerLayout(w: number, h: number): PlacedMarker[] {
  const outer = Math.round(Math.min(240, Math.max(110, w * MARKER_WIDTH_SHARE)));
  const cell = outer / MARKER_SVG_CELLS;
  const spots = [
    [INSET, INSET],
    [w - INSET - outer, INSET],
    [w - INSET - outer, h - INSET - outer],
    [INSET, h - INSET - outer],
  ];
  return spots.map(([left, top], i) => ({
    id: CORNER_IDS[i],
    left,
    top,
    outer,
    x: left + cell,
    y: top + cell,
    size: outer - 2 * cell,
  }));
}

/**
 * Phone mode: the whole screen becomes a grid of markers, so the phone sees
 * many of them from far away and at steep angles, and the pose averages over
 * dozens of corners instead of sixteen. `reserve` keeps a strip clear at the
 * bottom for controls.
 */
export function fullScreenLayout(w: number, h: number, reserve = 0): PlacedMarker[] {
  const usable = h - reserve;
  const pad = Math.max(10, Math.round(Math.min(w, usable) * 0.015));
  const gap = Math.round(pad * 1.4);
  // Score grids by markers times their size: more corners steady the pose and survive a hand in front of the
  // screen, bigger markers decode from further away, and a grid that spans the whole width pins the rotation
  // best. Each marker still has to be at least a fifth of the screen's short side.
  const minSize = Math.min(w, usable) * 0.2;
  let best = { cols: 3, rows: 2, size: 0, score: -1 };
  for (let cols = 3; cols <= 6; cols++) {
    for (let rows = 2; rows <= 4; rows++) {
      if (cols * rows > CODES.length) continue;
      const size = Math.min((w - 2 * pad - gap * (cols - 1)) / cols, (usable - 2 * pad - gap * (rows - 1)) / rows);
      const score = (size >= minSize ? 1e6 : 0) + cols * rows * size;
      if (score > best.score) best = { cols, rows, size, score };
    }
  }
  const outer = Math.floor(best.size);
  const cell = outer / MARKER_SVG_CELLS;
  const left0 = (w - (best.cols * outer + (best.cols - 1) * gap)) / 2;
  const top0 = (usable - (best.rows * outer + (best.rows - 1) * gap)) / 2;
  const out: PlacedMarker[] = [];
  for (let r = 0; r < best.rows; r++) {
    for (let c = 0; c < best.cols; c++) {
      const left = Math.round(left0 + c * (outer + gap));
      const top = Math.round(top0 + r * (outer + gap));
      out.push({ id: r * best.cols + c, left, top, outer, x: left + cell, y: top + cell, size: outer - 2 * cell });
    }
  }
  return out;
}

interface ArucoModule {
  DICTIONARIES: Record<string, unknown>;
}

export function registerMarkerDictionary(ar: unknown): void {
  const dicts = (ar as ArucoModule).DICTIONARIES;
  dicts[MARKER_DICTIONARY] ??= { nBits: 16, tau: null, codeList: CODES };
}
