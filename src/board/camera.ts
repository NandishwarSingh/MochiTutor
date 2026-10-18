/** The laptop webcam: used for notebook photos and, if the student allows it, occasional frames. */
export class Camera {
  readonly video = document.createElement("video");
  private stream: MediaStream | null = null;
  private readonly canvas = document.createElement("canvas");

  constructor() {
    this.video.muted = true;
    this.video.playsInline = true;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  async start(): Promise<void> {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  stop(): void {
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.video.srcObject = null;
  }

  /** JPEG of the current frame, scaled so the long side is at most maxSide. */
  capture(maxSide: number, quality: number): { dataUrl: string; base64: string } | null {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (!w || !h) return null;
    const s = Math.min(1, maxSide / Math.max(w, h));
    this.canvas.width = Math.round(w * s);
    this.canvas.height = Math.round(h * s);
    const g = this.canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const dataUrl = this.canvas.toDataURL("image/jpeg", quality);
    return { dataUrl, base64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  }
}
