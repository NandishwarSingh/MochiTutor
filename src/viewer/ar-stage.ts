import * as THREE from "three";
import type { MochiAvatar } from "../avatar/mochi";
import { addLights, createRenderer, ensureShadow, fitRenderer, releaseRenderer } from "../avatar/stage";
import { PoseFilter } from "./filter";
import { type Pose, poseToGl, projectionFromIntrinsics } from "./pose";

/** How Mochi stands next to the screen. Lengths are in board widths, angles in degrees. */
export interface Calibration {
  /** Mochi's height */
  size: number;
  /** gap between the screen's right edge and Mochi */
  gap: number;
  /** how far below the bottom of the screen the desk is */
  drop: number;
  /** screen tilt back from vertical */
  tilt: number;
  /** turn toward the board */
  turn: number;
}

export const DEFAULT_CALIBRATION: Calibration = { size: 0.6, gap: 0.16, drop: 0.04, tilt: 14, turn: -28 };

const LOST_AFTER_MS = 1200;

/**
 * Renders Mochi over the phone camera.
 *
 * The world is the board's frame (x right, y up, z out of the screen), measured
 * in Mochi's own metres so she is never scaled; her hair physics expects real
 * units. She stands still on the desk and the camera moves, so tracking jitter
 * and phone motion never shake her spring bones.
 */
export class ArStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera();
  private readonly world = new THREE.Group();
  private readonly feet = new THREE.Group();
  private readonly turn = new THREE.Group();
  private readonly timer = new THREE.Timer();
  private readonly filter = new PoseFilter();
  private readonly resize: ResizeObserver;
  private avatar: MochiAvatar | null = null;
  private boardAspect = 0.625;
  private calibration = DEFAULT_CALIBRATION;
  private lastSeen = 0;
  private lastPoseAt = 0;
  private filtered: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;
  private disposed = false;
  onFrame: ((dt: number) => void) | null = null;
  /** The browser took the GPU context away, usually because the phone ran out of graphics memory. */
  onContextLost: (() => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    canvas.addEventListener("webglcontextlost", this.lost);
    addLights(this.scene);
    this.camera.matrixAutoUpdate = false;
    this.world.visible = false;
    this.world.add(this.feet);
    this.feet.add(this.turn);
    this.scene.add(this.world);
    this.scene.add(this.camera);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();
  }

  private fit(): void {
    fitRenderer(this.renderer, this.canvas);
  }

  private readonly lost = (e: Event) => {
    e.preventDefault();
    if (!this.disposed) this.onContextLost?.();
  };

  /** Metres per board width, chosen so Mochi is calibration.size board widths tall. */
  private get unit(): number {
    return (this.avatar?.height ?? 1.5) / this.calibration.size;
  }

  setAvatar(avatar: MochiAvatar): void {
    if (this.avatar) this.turn.remove(this.avatar.root);
    this.avatar = avatar;
    avatar.root.position.set(0, 0, 0);
    avatar.root.rotation.set(0, 0, 0);
    avatar.root.scale.setScalar(1);
    ensureShadow(avatar.root, 0.34);
    avatar.setStudent(this.camera);
    this.turn.add(avatar.root);
    this.place();
  }

  setBoardAspect(heightOverWidth: number): void {
    this.boardAspect = heightOverWidth;
    this.place();
  }

  setCalibration(c: Calibration): void {
    this.calibration = c;
    this.place();
  }

  private place(): void {
    const c = this.calibration;
    const u = this.unit;
    this.feet.position.set((0.5 + c.gap) * u, (-this.boardAspect / 2 - c.drop) * u, 0.05 * u);
    // The screen leans back, so the board's "up" leans away; stand Mochi upright.
    this.feet.rotation.set(THREE.MathUtils.degToRad(c.tilt), 0, 0);
    this.turn.rotation.set(0, THREE.MathUtils.degToRad(c.turn), 0);
    this.applyCamera();
  }

  /** Camera intrinsics of the analysed frame. The canvas has the same aspect as the video. */
  setIntrinsics(width: number, height: number, focal: number): void {
    this.camera.projectionMatrix.fromArray(projectionFromIntrinsics(width, height, focal, 0.05, 500));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  /** The board's pose in camera space, in board-width units. */
  setPose(pose: Pose): void {
    const now = performance.now();
    const dt = this.lastPoseAt ? Math.min(0.2, (now - this.lastPoseAt) / 1000) : 1 / 30;
    if (now - this.lastSeen > LOST_AFTER_MS) this.filter.reset();
    this.lastPoseAt = now;
    this.lastSeen = now;
    this.m.fromArray(poseToGl(pose)).decompose(this.p, this.q, this.s);
    const f = this.filter.filter(this.p.toArray(), [this.q.x, this.q.y, this.q.z, this.q.w], dt);
    this.filtered = {
      p: new THREE.Vector3().fromArray(f.position),
      q: new THREE.Quaternion(f.quaternion[0], f.quaternion[1], f.quaternion[2], f.quaternion[3]),
    };
    this.applyCamera();
    this.world.visible = true;
  }

  /** Place the camera at the inverse of the board pose, scaled into Mochi's metres. */
  private applyCamera(): void {
    if (!this.filtered) return;
    this.m.compose(this.filtered.p.clone().multiplyScalar(this.unit), this.filtered.q, this.s.set(1, 1, 1)).invert();
    this.camera.matrix.copy(this.m);
    this.camera.matrixWorldNeedsUpdate = true;
  }

  get tracking(): boolean {
    return performance.now() - this.lastSeen < LOST_AFTER_MS;
  }

  private readonly boardCenter = new THREE.Vector3();

  start(): void {
    this.timer.reset();
    this.renderer.setAnimationLoop((time) => {
      this.timer.update(time);
      const dt = Math.min(0.1, this.timer.getDelta());
      if (!this.tracking) this.world.visible = false;
      this.onFrame?.(dt);
      if (this.avatar) {
        // Tell Mochi where the board centre is, in her own space, so she can glance at it.
        this.scene.updateMatrixWorld(true);
        this.boardCenter.set(0, 0, 0);
        this.avatar.boardPoint.copy(this.avatar.root.worldToLocal(this.boardCenter));
        this.avatar.update(dt);
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resize.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    releaseRenderer(this.renderer);
  }
}
