import type { MarkerLayout } from "../shared/protocol";
import type { ArucoMarker } from "../vendor/aruco/aruco.js";
import { applyH, decomposePose, estimateFocal, type Pose, solveHomography, type Vec2 } from "./pose";

export interface BoardLayout {
  w: number;
  h: number;
  markers: MarkerLayout[];
}

export interface TrackResult {
  pose: Pose;
  focal: number;
  width: number;
  height: number;
  markers: number;
  errorPx: number;
}

/** Board-space corners of a marker, clockwise from its top-left, in board-width units. */
export function markerCorners(m: MarkerLayout, layout: BoardLayout): Vec2[] {
  const u = (px: number) => (px - layout.w / 2) / layout.w;
  const v = (py: number) => (py - layout.h / 2) / layout.w;
  return [
    [u(m.x), v(m.y)],
    [u(m.x + m.size), v(m.y)],
    [u(m.x + m.size), v(m.y + m.size)],
    [u(m.x), v(m.y + m.size)],
  ];
}

function quadArea(m: ArucoMarker): number {
  const c = m.corners;
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    a += c[i].x * c[j].y - c[j].x * c[i].y;
  }
  return Math.abs(a) / 2;
}

/** Match detected markers to the layout and estimate the camera pose. */
export function poseFromDetections(
  detections: ArucoMarker[],
  layout: BoardLayout,
  width: number,
  height: number,
  focalGuess: number,
): { result: TrackResult; focalEstimate: number | null } | null {
  const src: Vec2[] = [];
  const dst: Vec2[] = [];
  // A marker's inner cells can also decode as a tiny marker; keep the biggest per id.
  const best = new Map<number, ArucoMarker>();
  for (const d of detections) {
    if (d.corners.length !== 4) continue;
    const prev = best.get(d.id);
    if (!prev || quadArea(d) > quadArea(prev)) best.set(d.id, d);
  }
  const seen = new Set<number>();
  for (const d of best.values()) {
    const m = layout.markers.find((k) => k.id === d.id);
    if (!m) continue;
    seen.add(d.id);
    const corners = markerCorners(m, layout);
    for (let i = 0; i < 4; i++) {
      src.push(corners[i]);
      dst.push([d.corners[i].x, d.corners[i].y]);
    }
  }
  if (seen.size === 0) return null;
  const H = solveHomography(src, dst);
  if (!H) return null;
  const cx = width / 2;
  const cy = height / 2;
  const focalEstimate = seen.size >= 2 ? estimateFocal(H, cx, cy) : null;
  const plausible = focalEstimate !== null && focalEstimate > width * 0.45 && focalEstimate < width * 2.6;
  const pose = decomposePose(H, focalGuess, cx, cy);
  let err = 0;
  for (let i = 0; i < src.length; i++) {
    const p = applyH(H, src[i]);
    err += Math.hypot(p[0] - dst[i][0], p[1] - dst[i][1]);
  }
  return {
    result: { pose, focal: focalGuess, width, height, markers: seen.size, errorPx: err / src.length },
    focalEstimate: plausible ? focalEstimate : null,
  };
}
