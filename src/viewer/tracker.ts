import { MARKER_DICTIONARY, registerMarkerDictionary } from "../shared/markers";
import { AR, type ArucoMarker } from "../vendor/aruco/aruco.js";
import { type BoardLayout, poseFromDetections, type TrackResult } from "./board-pose";
import DetectWorker from "./detect-worker.ts?worker";
import { median } from "./pose";

export type { BoardLayout, TrackResult };

interface Detections {
  markers: ArucoMarker[];
  width: number;
  height: number;
  ms: number;
}

/** Runs marker detection in a worker when the browser can, else on the main thread. */
class Detector {
  private worker: Worker | null = null;
  private busy = false;
  private resolve: ((d: Detections | null) => void) | null = null;
  private fallback: { detector: InstanceType<typeof AR.Detector>; canvas: HTMLCanvasElement } | null = null;

  constructor() {
    if (typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined") {
      try {
        this.worker = new DetectWorker();
        this.worker.onmessage = (e: MessageEvent<Detections>) => {
          this.busy = false;
          this.resolve?.(e.data);
          this.resolve = null;
        };
        this.worker.onerror = () => {
          this.worker = null;
          this.busy = false;
          this.resolve?.(null);
        };
      } catch {
        this.worker = null;
      }
    }
  }

  async detect(video: HTMLVideoElement, width: number, height: number): Promise<Detections | null> {
    if (this.busy) return null;
    if (this.worker) {
      this.busy = true;
      try {
        const bitmap = await createImageBitmap(video, {
          resizeWidth: width,
          resizeHeight: height,
          resizeQuality: "medium",
        });
        return await new Promise<Detections | null>((resolve) => {
          this.resolve = resolve;
          this.worker?.postMessage({ bitmap }, [bitmap]);
        });
      } catch {
        this.busy = false;
        return null;
      }
    }
    if (!this.fallback) {
      registerMarkerDictionary(AR);
      this.fallback = {
        detector: new AR.Detector({ dictionaryName: MARKER_DICTIONARY, maxHammingDistance: 1 }),
        canvas: document.createElement("canvas"),
      };
    }
    const { canvas, detector } = this.fallback;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    const t0 = performance.now();
    const markers = detector.detect(ctx.getImageData(0, 0, width, height)).filter((m) => m.id <= 3);
    return { markers, width, height, ms: performance.now() - t0 };
  }

  dispose(): void {
    this.worker?.terminate();
  }
}

/** Finds the board's corner markers in camera frames and turns them into a camera pose. */
export class BoardTracker {
  private readonly detector = new Detector();
  private readonly focalSamples: number[] = [];
  private frameSize = "";
  private lastGood = 0;
  layout: BoardLayout | null = null;
  /** Long side of the frame we analyse, in pixels. */
  processSide = 1280;
  lastDetectMs = 0;

  /** Focal length in pixels of the processed frame. Starts from a typical 66 degree phone camera. */
  focal(width: number): number {
    return this.focalSamples.length >= 5 ? median(this.focalSamples) : width / 2 / Math.tan((66 * Math.PI) / 360);
  }

  async track(video: HTMLVideoElement): Promise<TrackResult | null | "busy"> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || !this.layout) return null;
    const s = Math.min(1, this.processSide / Math.max(vw, vh));
    const w = Math.round(vw * s);
    const h = Math.round(vh * s);
    const size = `${w}x${h}`;
    if (size !== this.frameSize) {
      // A different frame size means a different focal length in pixels.
      this.frameSize = size;
      this.focalSamples.length = 0;
    }
    const found = await this.detector.detect(video, w, h);
    if (!found) return "busy";
    this.lastDetectMs = found.ms;
    const out = poseFromDetections(found.markers, this.layout, w, h, this.focal(w));
    if (!out) return null;
    // One marker alone is only trusted right after a good multi-marker fix.
    const now = performance.now();
    if (out.result.markers === 1 && now - this.lastGood > 800) return null;
    if (out.result.errorPx > 6) return null;
    if (out.result.markers >= 2) this.lastGood = now;
    if (out.focalEstimate !== null) {
      this.focalSamples.push(out.focalEstimate);
      if (this.focalSamples.length > 60) this.focalSamples.shift();
    }
    return out.result;
  }

  dispose(): void {
    this.detector.dispose();
  }
}
