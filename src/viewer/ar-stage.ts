import * as THREE from "three";
import type { MochiAvatar } from "../avatar/mochi";
import {
  addLights,
  createRenderer,
  createStage,
  ensureShadow,
  fitRenderer,
  releaseRenderer,
  STAGE_HEIGHT,
} from "../avatar/stage";
import { PoseFilter } from "./filter";
import type { DeviceRotation } from "./motion";
import { panelCssMatrix } from "./panel";
import { type Pose, poseToGl, projectionFromIntrinsics } from "./pose";

/** How Mochi and the board are placed around the screen. Lengths are in screen widths, angles in degrees. */
export interface Calibration {
  /** Mochi's height */
  size: number;
  /** gap between the screen's (or the drawn board's) right edge and Mochi */
  gap: number;
  /** how far below the bottom of the screen the desk is */
  drop: number;
  /** screen tilt back from vertical */
  tilt: number;
  /** turn toward the board */
  turn: number;
  /** phone mode: the drawn board's width */
  panel: number;
  /** phone mode: how far the drawn board's bottom edge sits above the screen's bottom edge */
  lift: number;
}

/** Mochi next to the laptop's own board. */
export const DEFAULT_CALIBRATION: Calibration = {
  size: 0.6,
  gap: 0.16,
  drop: 0.04,
  tilt: 14,
  turn: -28,
  panel: 2,
  lift: 0,
};
/** Phone mode: a board twice the screen's width, and Mochi bigger beside it. */
export const DEFAULT_PANEL_CALIBRATION: Calibration = {
  size: 0.95,
  gap: 0.1,
  drop: 0.04,
  tilt: 14,
  turn: -35,
  panel: 2,
  lift: 0,
};

const LOST_AFTER_MS = 1200;
/** In a headset the gyro keeps the room steady while the markers are out of view, for this long. */
const HEADSET_HOLD_MS = 30_000;

/** A rectangle in CSS pixels from the canvas's top-left. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Side-by-side stereo for a phone in a Cardboard-style headset. */
export interface Stereo {
  /** distance between the eyes, metres */
  ipd: number;
  /** how big the camera picture is in each eye; 1 fits its width to the eye */
  zoom: number;
  /** the laptop screen's real width, metres, to turn the eye distance into screen widths */
  screenWidth: number;
}

export interface Eye {
  camera: THREE.PerspectiveCamera;
  /** this eye's half of the screen */
  half: Rect;
  /** where the camera picture (and the 3D view drawn over it) sits in that half */
  view: Rect;
  /** how far to slide the camera picture toward the nose, in CSS px, so the real screen and the drawn board meet in depth */
  shift: number;
}
/** Rough time from light hitting the camera to the frame showing on screen. */
const VIDEO_LATENCY_MS = 50;
/** How hard each marker fix pulls the gyro-driven rotation back toward it. */
const MARKER_PULL = 0.22;
/** A fix further off than this is trusted outright: the gyro estimate has drifted or the view jumped. */
const SNAP_RADIANS = THREE.MathUtils.degToRad(8);

/**
 * Renders Mochi, and in phone mode a big board, over the phone camera.
 *
 * The world is the screen's frame (x right, y up, z out of the screen), measured
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
  private panelMode = false;
  private lastSeen = 0;
  private lastPoseAt = 0;
  /** The camera's pose in the screen's frame, in screen widths. */
  private cam: { p: THREE.Vector3; q: THREE.Quaternion } | null = null;
  private motion: DeviceRotation | null = null;
  private lastRenderAt = 0;
  private disposed = false;
  onFrame: ((dt: number) => void) | null = null;
  /** Called after each frame is drawn, with the camera where it was drawn from. */
  private readonly renderListeners = new Set<() => void>();
  private stereo: Stereo | null = null;
  private frame = { w: 1280, h: 720, focal: 1000 };
  /** The two eyes while in a headset, updated every frame. */
  readonly eyes: Eye[] = [0, 1].map(() => ({
    camera: Object.assign(new THREE.PerspectiveCamera(), { matrixAutoUpdate: false }),
    half: { x: 0, y: 0, w: 1, h: 1 },
    view: { x: 0, y: 0, w: 1, h: 1 },
    shift: 0,
  }));
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
    this.turn.add(createStage());
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

  /** Metres per screen width, chosen so Mochi is calibration.size screen widths tall. */
  get unit(): number {
    return (this.avatar?.height ?? 1.5) / this.calibration.size;
  }

  setAvatar(avatar: MochiAvatar): void {
    if (this.avatar) this.turn.remove(this.avatar.root);
    this.avatar = avatar;
    avatar.root.position.set(0, STAGE_HEIGHT, 0);
    avatar.root.rotation.set(0, 0, 0);
    avatar.root.scale.setScalar(1);
    ensureShadow(avatar.root, 0.3);
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

  /** Phone mode: draw a board panel around the screen and stand Mochi beside it. */
  setPanelMode(on: boolean): void {
    this.panelMode = on;
    this.place();
  }

  /** Use the phone's gyroscope between marker fixes. */
  setMotion(motion: DeviceRotation | null): void {
    this.motion = motion;
  }

  private place(): void {
    const c = this.calibration;
    const u = this.unit;
    const right = this.panelMode ? c.panel / 2 : 0.5;
    this.feet.position.set(
      (right + c.gap) * u,
      (-this.boardAspect / 2 - c.drop) * u,
      (this.panelMode ? 0.12 : 0.05) * u,
    );
    // The screen leans back, so the board's "up" leans away; stand Mochi upright.
    this.feet.rotation.set(THREE.MathUtils.degToRad(c.tilt), 0, 0);
    this.turn.rotation.set(0, THREE.MathUtils.degToRad(c.turn), 0);
    this.applyCamera();
  }

  /** Camera intrinsics of the analysed frame. The canvas has the same aspect as the video. */
  setIntrinsics(width: number, height: number, focal: number): void {
    this.frame = { w: width, h: height, focal };
    this.camera.projectionMatrix.fromArray(projectionFromIntrinsics(width, height, focal, 0.05, 500));
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  /**
   * A marker fix: the screen's pose in camera space, in screen widths, for the
   * frame grabbed at `frameTime` (performance.now() ms).
   */
  setPose(pose: Pose, frameTime = performance.now()): void {
    const now = performance.now();
    const dt = this.lastPoseAt ? Math.min(0.2, (now - this.lastPoseAt) / 1000) : 1 / 30;
    if (now - this.lastSeen > LOST_AFTER_MS) {
      this.filter.reset();
      this.cam = null;
    }
    this.lastPoseAt = now;
    this.lastSeen = now;
    // Invert the screen-in-camera pose into the camera's pose in the screen's frame.
    this.m.fromArray(poseToGl(pose)).invert().decompose(this.p, this.q, this.s);
    const f = this.filter.filter(this.p.toArray(), [this.q.x, this.q.y, this.q.z, this.q.w], dt);
    const position = new THREE.Vector3().fromArray(f.position);
    // With the gyro: carry the fix forward from its frame to the frame on screen, then
    // pull the running rotation toward it. Without: the smoothed fix as it is.
    const turned = this.motion?.live ? this.motion.delta(frameTime - VIDEO_LATENCY_MS, now - VIDEO_LATENCY_MS) : null;
    if (turned) {
      const measured = this.q.clone().multiply(turned);
      if (!this.cam || this.cam.q.angleTo(measured) > SNAP_RADIANS) this.cam = { p: position, q: measured };
      else {
        this.cam.p.copy(position);
        this.cam.q.slerp(measured, MARKER_PULL);
      }
    } else {
      this.cam = { p: position, q: new THREE.Quaternion().fromArray(f.quaternion) };
    }
    this.lastRenderAt = now;
    this.applyCamera();
    this.world.visible = true;
  }

  /** Between fixes, turn the camera with the phone. */
  private followGyro(now: number): void {
    if (!this.cam || !this.motion?.live || !this.lastRenderAt) return;
    const turned = this.motion.delta(this.lastRenderAt - VIDEO_LATENCY_MS, now - VIDEO_LATENCY_MS);
    this.lastRenderAt = now;
    if (!turned) return;
    this.cam.q.multiply(turned).normalize();
    this.applyCamera();
  }

  /** Place the camera, scaled into Mochi's metres. */
  private applyCamera(): void {
    if (!this.cam) return;
    this.camera.matrix.compose(this.cam.p.clone().multiplyScalar(this.unit), this.cam.q, this.s.set(1, 1, 1));
    this.camera.matrixWorldNeedsUpdate = true;
  }

  /** A point on the screen, as fractions of its width and height from the top-left corner, in world space. */
  private screenPoint(fx: number, fy: number): THREE.Vector3 {
    const u = this.unit;
    return new THREE.Vector3((fx - 0.5) * u, (0.5 - fy) * this.boardAspect * u, 0.02 * u);
  }

  /** The drawn board's corners in screen widths: top-left, then one step right and one step down per unit. */
  private panelFrame() {
    const c = this.calibration;
    const height = c.panel * PANEL_ASPECT;
    const bottom = -this.boardAspect / 2 + c.lift;
    return { left: -c.panel / 2, top: bottom + height, width: c.panel, height };
  }

  /** A point on the drawn board, as fractions of its width and height from its top-left corner, in world space. */
  panelPoint(fx: number, fy: number): THREE.Vector3 {
    const f = this.panelFrame();
    const u = this.unit;
    return new THREE.Vector3((f.left + fx * f.width) * u, (f.top - fy * f.height) * u, -0.01 * u);
  }

  /** Point at a spot on the laptop's own board. */
  pointAtBoard(fx: number, fy: number): void {
    this.avatar?.pointAt(this.screenPoint(fx, fy));
  }

  /** Point at a spot on the drawn board. */
  pointAtPanel(fx: number, fy: number): void {
    this.avatar?.pointAt(this.panelPoint(fx, fy));
  }

  /**
   * The CSS matrix3d that lays a `pxW` x `pxH` DOM element exactly over the
   * drawn board, inside a container of `viewW` x `viewH` CSS pixels that shows
   * the same picture as the canvas. Null when the board isn't in view.
   */
  panelCssMatrix(
    viewW: number,
    viewH: number,
    pxW: number,
    pxH: number,
    camera: THREE.Camera = this.camera,
  ): number[] | null {
    if (!this.tracking || !this.cam) return null;
    const f = this.panelFrame();
    const u = this.unit;
    return panelCssMatrix(
      camera,
      { left: f.left * u, top: f.top * u, width: f.width * u, height: f.height * u, z: -0.01 * u },
      viewW,
      viewH,
      pxW,
      pxH,
    );
  }

  get tracking(): boolean {
    // In a headset the gyro alone keeps the room steady for a while after the markers go out of view.
    const hold = this.stereo && this.motion?.live ? HEADSET_HOLD_MS : LOST_AFTER_MS;
    return performance.now() - this.lastSeen < hold;
  }

  /** Called after every rendered frame; returns a function that stops the calls. */
  onRendered(fn: () => void): () => void {
    this.renderListeners.add(fn);
    return () => this.renderListeners.delete(fn);
  }

  /** Render side by side for a headset, or back to one view with null. */
  setStereo(stereo: Stereo | null): void {
    this.stereo = stereo;
  }

  private readonly offset = new THREE.Matrix4();
  private readonly eyePos = new THREE.Vector3();
  private readonly size = new THREE.Vector2();

  /** Lay out both eyes and draw the scene once for each. */
  private renderStereo(st: Stereo): void {
    this.renderer.getSize(this.size);
    const { x: cw, y: ch } = this.size;
    const eyeSpacing = (st.ipd / st.screenWidth) * this.unit;
    this.camera.updateMatrixWorld();
    // How far the drawn board is, for sliding the flat camera picture to the same depth.
    const center = this.panelMode ? this.panelPoint(0.5, 0.5) : new THREE.Vector3();
    const distance = Math.max(0.05, this.eyePos.setFromMatrixPosition(this.camera.matrixWorld).distanceTo(center));
    this.renderer.setScissorTest(true);
    this.eyes.forEach((eye, i) => {
      eye.half = { x: (i * cw) / 2, y: 0, w: cw / 2, h: ch };
      // The camera picture fits the eye's width, scaled by zoom, centred in its half.
      const w = eye.half.w * st.zoom;
      const h = (w * this.frame.h) / this.frame.w;
      eye.view = { x: eye.half.x + (eye.half.w - w) / 2, y: (ch - h) / 2, w, h };
      const side = i === 0 ? -1 : 1;
      eye.camera.projectionMatrix.copy(this.camera.projectionMatrix);
      eye.camera.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse);
      eye.camera.matrix.copy(this.camera.matrix).multiply(this.offset.makeTranslation((side * eyeSpacing) / 2, 0, 0));
      eye.camera.matrixWorldNeedsUpdate = true;
      eye.camera.updateMatrixWorld();
      eye.shift = ((eyeSpacing / 2) * this.frame.focal * (w / this.frame.w)) / distance;
      this.renderer.setScissor(eye.half.x, ch - eye.half.y - eye.half.h, eye.half.w, eye.half.h);
      this.renderer.setViewport(eye.view.x, ch - eye.view.y - eye.view.h, eye.view.w, eye.view.h);
      this.renderer.render(this.scene, eye.camera);
    });
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, cw, ch);
  }

  private readonly boardCenter = new THREE.Vector3();

  start(): void {
    this.timer.reset();
    this.renderer.setAnimationLoop((time) => {
      this.timer.update(time);
      const dt = Math.min(0.1, this.timer.getDelta());
      if (!this.tracking) this.world.visible = false;
      else this.followGyro(performance.now());
      this.onFrame?.(dt);
      if (this.avatar) {
        // Tell Mochi where the board centre is, in her own space, so she can glance at it.
        this.scene.updateMatrixWorld(true);
        if (this.panelMode) this.boardCenter.copy(this.panelPoint(0.5, 0.45));
        else this.boardCenter.set(0, 0, 0);
        this.avatar.boardPoint.copy(this.avatar.root.worldToLocal(this.boardCenter));
        this.avatar.update(dt);
      }
      if (this.stereo) this.renderStereo(this.stereo);
      else this.renderer.render(this.scene, this.camera);
      for (const fn of this.renderListeners) fn();
    });
  }

  dispose(): void {
    this.disposed = true;
    this.renderListeners.clear();
    this.renderer.setAnimationLoop(null);
    this.resize.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    releaseRenderer(this.renderer);
  }
}

/** Height over width of the drawn board, matching the DOM board the phone lays on it. */
export const PANEL_ASPECT = 0.625;
