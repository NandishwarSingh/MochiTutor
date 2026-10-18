// Types for the vendored js-aruco2 build (only what MochiTutor uses).

export interface ArucoPoint {
  x: number;
  y: number;
}

export interface ArucoMarker {
  id: number;
  corners: ArucoPoint[];
  hammingDistance: number;
}

export interface ArucoDetector {
  detect(image: { width: number; height: number; data: Uint8ClampedArray }): ArucoMarker[];
  /** MochiTutor addition: adaptive threshold radius, default 2 */
  thresholdKernel?: number;
  /** MochiTutor addition: pixels per cell when sampling a candidate, default 7 */
  warpCell?: number;
}

export declare const AR: {
  DICTIONARIES: Record<string, unknown>;
  Detector: new (config?: { dictionaryName?: string; maxHammingDistance?: number }) => ArucoDetector;
  Dictionary: new (name: string) => {
    generateSVG(id: number): string;
    codeList: string[];
    markSize: number;
  };
};
