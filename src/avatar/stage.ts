import * as THREE from "three";
import type { MochiAvatar } from "./mochi";

/** Add a soft round shadow under Mochi's feet once, so she doesn't float. */
export function ensureShadow(root: THREE.Object3D, radius: number): void {
  if (root.userData.shadow) return;
  root.userData.shadow = true;
  root.add(contactShadow(radius));
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
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    this.fit();
  }

  setAvatar(avatar: MochiAvatar, turn = -0.3): void {
    if (this.avatar) this.scene.remove(this.avatar.root);
    this.avatar = avatar;
    avatar.root.position.set(0, 0, 0);
    avatar.root.rotation.set(0, turn, 0);
    avatar.root.scale.setScalar(1);
    ensureShadow(avatar.root, 0.34);
    avatar.setStudent(this.camera);
    this.scene.add(avatar.root);
    const h = avatar.height;
    // Leave headroom for a raised hand when Mochi waves or cheers.
    const dist = (h * 0.72) / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(0, h * 0.6, dist);
    this.camera.lookAt(0, h * 0.56, 0);
  }

  private fit(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    fitRenderer(this.renderer, this.canvas);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
