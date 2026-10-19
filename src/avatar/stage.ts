import * as THREE from "three";
import type { MochiAvatar } from "./mochi";

/** Add a soft round shadow under Mochi's feet once, so she doesn't float. */
export function ensureShadow(root: THREE.Object3D, radius: number): void {
  if (root.userData.shadow) return;
  root.userData.shadow = true;
  root.add(contactShadow(radius));
}

/** Height of the little wooden stage Mochi stands on, in metres. */
export const STAGE_HEIGHT = 0.06;

/**
 * A low round wooden stage, top at y = STAGE_HEIGHT, with its own shadow on
 * the floor or desk. Mochi stands on it so her feet always meet something solid.
 */
export function createStage(radius = 0.4): THREE.Group {
  const stage = new THREE.Group();
  const side = new THREE.MeshStandardMaterial({ color: 0x6e4b33, roughness: 0.85 });
  const top = new THREE.MeshStandardMaterial({ color: 0x9a6c48, roughness: 0.75 });
  const rim = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.7 });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.04, STAGE_HEIGHT - 0.008, 48, 1, true),
    side,
  );
  body.position.y = (STAGE_HEIGHT - 0.008) / 2;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.012, 48), top);
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = STAGE_HEIGHT;
  // A rounded lip where the top meets the side, so the edge catches the light.
  const lip = new THREE.Mesh(new THREE.TorusGeometry(radius - 0.006, 0.008, 8, 64), rim);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = STAGE_HEIGHT - 0.006;
  const floorShadow = contactShadow(radius * 1.35);
  floorShadow.position.y = 0.001;
  stage.add(floorShadow, body, cap, lip);
  return stage;
}

function contactShadow(radius: number): THREE.Mesh {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 2, radius * 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  return mesh;
}

export function addLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5048, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(0.8, 2, 2.5);
  scene.add(key);
}

/** Touch-first devices, which also have the least graphics memory. */
export function isPhone(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

/**
 * A transparent renderer that fits in a phone's graphics memory. On a dense
 * phone screen antialiasing costs a multisampled buffer as big as the canvas
 * and barely shows, so it's only on for laptops and low-density screens.
 */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const antialias = !isPhone() || window.devicePixelRatio < 2;
  return new THREE.WebGLRenderer({ canvas, alpha: true, antialias });
}

/** Size the drawing buffer to the canvas, at most 2x and at most `maxSide` pixels on the long side. */
export function fitRenderer(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement, maxSide = 2048): void {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2, maxSide / Math.max(w, h)));
  renderer.setSize(w, h, false);
}

/** Free the GPU memory now instead of whenever the browser collects the old context. */
export function releaseRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.dispose();
  renderer.forceContextLoss();
}

/** Renders Mochi full-body into a transparent canvas, for the board corner and the desktop viewer. */
export class AvatarStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(24, 1, 0.05, 50);
  private readonly timer = new THREE.Timer();
  private readonly resize: ResizeObserver;
  private avatar: MochiAvatar | null = null;
  private running = false;
  onFrame: ((dt: number) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    addLights(this.scene);
    this.scene.add(createStage());
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();
  }

  setAvatar(avatar: MochiAvatar, turn = -0.3): void {
    if (this.avatar) this.scene.remove(this.avatar.root);
    this.avatar = avatar;
    avatar.root.position.set(0, STAGE_HEIGHT, 0);
    avatar.root.rotation.set(0, turn, 0);
    avatar.root.scale.setScalar(1);
    ensureShadow(avatar.root, 0.3);
    avatar.setStudent(this.camera);
    this.scene.add(avatar.root);
    this.frame();
  }

  /** Back the camera off until Mochi and her stage fit, raised hands included, in a tall or a narrow canvas. */
  private frame(): void {
    if (!this.avatar) return;
    const h = this.avatar.height + STAGE_HEIGHT;
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // Headroom for a hand raised in a wave or a cheer, and room for one held out to the side.
    const dist = Math.max((h * 0.72) / tan, (h * 0.3) / (tan * this.camera.aspect));
    this.camera.position.set(0, h * 0.58, dist);
    this.camera.lookAt(0, h * 0.54, 0);
  }

  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.3);

  /**
   * Point at something on the page outside this canvas, like a board line to
   * Mochi's right: the screen point is cast into her world and she points at
   * where it lands, a little in front of her.
   */
  pointAtScreen(clientX: number, clientY: number, seconds?: number): void {
    if (!this.avatar) return;
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const hit = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (hit) this.avatar.pointAt(hit, seconds);
  }

  private fit(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    fitRenderer(this.renderer, this.canvas);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.frame();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.reset();
    this.renderer.setAnimationLoop((time) => {
      this.timer.update(time);
      const dt = Math.min(0.1, this.timer.getDelta());
      this.onFrame?.(dt);
      this.avatar?.update(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.stop();
    this.resize.disconnect();
    releaseRenderer(this.renderer);
  }
}
