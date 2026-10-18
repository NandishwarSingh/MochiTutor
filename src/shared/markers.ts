// The four corner markers the phone tracks. A tiny 4x4 dictionary with only the
// codes we use: big cells for their size, and far apart from each other, so they
// decode from across a desk. The codes are the first four of OpenCV's
// DICT_4X4_1000 (BSD-3-Clause, OpenCV Foundation).

export const MARKER_DICTIONARY = "MOCHI_4X4";
const CODES = [
  [181, 50],
  [15, 154],
  [51, 45],
  [153, 70],
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

interface ArucoModule {
  DICTIONARIES: Record<string, unknown>;
}

export function registerMarkerDictionary(ar: unknown): void {
  const dicts = (ar as ArucoModule).DICTIONARIES;
  dicts[MARKER_DICTIONARY] ??= { nBits: 16, tau: null, codeList: CODES };
}
