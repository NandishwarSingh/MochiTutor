// Marker detection off the main thread so the phone keeps rendering at full speed.
import { CODES, MARKER_DICTIONARY, registerMarkerDictionary } from "../shared/markers";
import { AR } from "../vendor/aruco/aruco.js";

registerMarkerDictionary(AR);
const detector = new AR.Detector({ dictionaryName: MARKER_DICTIONARY, maxHammingDistance: 1 });
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

self.onmessage = (e: MessageEvent<{ bitmap: ImageBitmap }>) => {
  const { bitmap } = e.data;
  const { width, height } = bitmap;
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!ctx) return;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const t0 = performance.now();
  const markers = detector
    .detect(ctx.getImageData(0, 0, width, height))
    .filter((m) => m.id < CODES.length)
    .map((m) => ({
      id: m.id,
      hammingDistance: m.hammingDistance,
      corners: m.corners.map((c) => ({ x: c.x, y: c.y })),
    }));
  self.postMessage({ markers, width, height, ms: performance.now() - t0 });
};
