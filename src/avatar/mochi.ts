import { type VRM, type VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Emotion, Gesture, Visemes } from "../shared/protocol";
import { Alive } from "./alive";
import { type CuteFace, expandFace, registerCuteFaces } from "./faces";
import { GESTURE_SECONDS, type GestureName, gesturePose, type Pose } from "./gestures";

// Mochi's body: a VRM model posed procedurally. No animation files, so any
// VRoid export works. Every frame the pose is rebuilt from a relaxed base,
// idle motion, the current gesture and where Mochi is looking.

const EMOTION_FACES: Record<Emotion, Record<string, number>> = {
  happy: { beam: 0.75 },
  excited: { sparkle: 1 },
  thinking: { relaxed: 0.25 },
  surprised: { surprised: 0.75 },
  proud: { smug: 0.8 },
  oops: { pout: 0.55 },
  calm: { relaxed: 0.35 },
  teasing: { smug: 0.9 },
  pout: { pout: 1 },
  shy: { shy: 0.9 },
};

const RESTING_FACE: Record<string, number> = { happy: 0.18, relaxed: 0.12 };
const VISEME_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;
/** How long a teasing wink stays closed. */
const WINK_SECONDS = 0.6;

const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const ease = (u: number) => u * u * (3 - 2 * u);

/** Redraw every texture bigger than maxSize at a smaller size, keeping its aspect ratio. */
export function shrinkTextures(root: THREE.Object3D, maxSize: number): void {
  const seen = new Set<THREE.Texture>();
  const textures: THREE.Texture[] = [];
  const collect = (value: unknown) => {
    if (value instanceof THREE.Texture && !seen.has(value)) {
      seen.add(value);
      textures.push(value);
    }
  };
  root.traverse((obj) => {
    const material = (obj as THREE.Mesh).material;
    if (!material) return;
    for (const m of Array.isArray(material) ? material : [material]) {
      for (const value of Object.values(m)) collect(value);
      // MToon keeps its textures in shader uniforms.
      for (const u of Object.values((m as THREE.ShaderMaterial).uniforms ?? {})) collect(u?.value);
    }
  });
  // Textures can share one image, so each image is redrawn once and closed at the end.
  const redrawn = new Map<unknown, HTMLCanvasElement>();
  for (const texture of textures) {
    const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (!image?.width || !image.height) continue;
    const scale = maxSize / Math.max(image.width, image.height);
    if (scale >= 1) continue;
    let canvas = redrawn.get(image);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      redrawn.set(image, canvas);
    }
    texture.image = canvas;
    texture.needsUpdate = true;
  }
  for (const image of redrawn.keys()) {
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
  }
}

export class MochiAvatar {
  readonly root = new THREE.Group();
  /** Approximate height in metres before any scaling. */
  readonly height: number;
  private time = 0;
  private visemes: Visemes = [0, 0, 0, 0, 0];
  private emotion: { name: Emotion; at: number } | null = null;
  private gesture: { name: GestureName; at: number } | null = null;
  private face: Record<string, number> = {};
  /** Expression names as this model spells them, keyed in lower case. */
  private readonly expressionNames = new Map<string, string>();
  private readonly cuteFaces: Set<CuteFace>;
  private winkUntil = 0;
  private blink = { next: 2, start: -1 };
  private readonly alive = new Alive();
  /** Where her right hand is pointing, in world space, and when. */
  private point: { world: THREE.Vector3; at: number; seconds: number } | null = null;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly identity = new THREE.Quaternion();
  private lookMode: "student" | "board" = "student";
  private lookUntil = 0;
  private readonly lookTarget = new THREE.Object3D();
  private student: THREE.Object3D | null = null;
  private headYaw = 0;
  private headPitch = 0;
  /** Where the board is, in Mochi's own space (Mochi faces +Z, the board is to her right, -X). */
  boardPoint = new THREE.Vector3(-1.2, 1.2, 0.6);

  private constructor(readonly vrm: VRM) {
    VRMUtils.rotateVRM0(vrm);
    vrm.scene.traverse((o) => {
      o.frustumCulled = false;
    });
    this.root.add(vrm.scene);
    this.root.add(this.lookTarget);
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.cuteFaces = registerCuteFaces(vrm);
    // VRoid's VRM 0.x exports have no surprised preset; they carry a custom "Surprised" expression instead.
    for (const e of vrm.expressionManager?.expressions ?? []) {
      this.expressionNames.set(e.expressionName.toLowerCase(), e.expressionName);
    }
    vrm.update(0);
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const p = new THREE.Vector3();
    head?.getWorldPosition(p);
    this.height = (p.y || 1.4) + 0.14;
  }

  /**
   * Load a VRM. `maxTextureSize` shrinks bigger textures: VRoid exports carry
   * 2048 px body and normal maps, about 100 MB of graphics memory in all,
   * which is enough to crash a phone's browser tab.
   */
  static async load(
    url: string,
    onProgress?: (fraction: number) => void,
    maxTextureSize = Number.POSITIVE_INFINITY,
  ): Promise<MochiAvatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error(`${url} is not a VRM model`);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    if (Number.isFinite(maxTextureSize)) shrinkTextures(gltf.scene, maxTextureSize);
    return new MochiAvatar(vrm);
  }

  /** The object Mochi looks at when talking to the student, usually the camera. */
  setStudent(target: THREE.Object3D): void {
    this.student = target;
  }

  setVisemes(v: Visemes): void {
    this.visemes = v;
  }

  emote(name: Emotion): void {
    this.emotion = { name, at: this.time };
    if (name === "teasing") this.winkUntil = this.time + WINK_SECONDS;
  }

  playGesture(name: Gesture): void {
    if (name === "none") return;
    this.gesture = { name, at: this.time };
    if (name === "point_board") this.look("board", GESTURE_SECONDS.point_board);
    if (name === "think") this.emote("thinking");
  }

  /** Lean in a little while the student is talking. */
  setAttentive(on: boolean): void {
    this.alive.attentive = on;
  }

  /** Point her right hand at a spot in the world, like a line on the board, and look at it. */
  pointAt(world: THREE.Vector3, seconds = 1.8): void {
    this.point = { world: world.clone(), at: this.time, seconds };
    this.look("board", seconds);
  }

  look(at: "student" | "board", seconds = 1.6): void {
    this.lookMode = at;
    this.lookUntil = at === "board" ? this.time + seconds : 0;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const humanoid = this.vrm.humanoid;
    humanoid.resetNormalizedPose();

    const speaking = this.visemes.some((v) => v > 0.05);
    const mouthOpen = Math.max(...this.visemes);

    const pose: Pose = {
      leftUpperArm: [0.05, 0, -1.22],
      rightUpperArm: [0.05, 0, 1.22],
      leftLowerArm: [0, -0.28, 0],
      rightLowerArm: [0, 0.28, 0],
      leftHand: [0, 0, -0.1],
      rightHand: [0, 0, 0.1],
      spine: [0, 0.03 * Math.sin(t * 0.45), 0],
      hips: [0, 0.035 * Math.sin(t * 0.5), 0],
      head: [
        0.04 * mouthOpen + 0.02 * Math.sin(t * 0.9),
        0,
        0.03 * Math.sin(t * 0.7) + (speaking ? 0.02 * Math.sin(t * 3.1) : 0),
      ],
    };

    // Pointing: how far into the point she is, 0 to 1, easing in and out.
    let pointing = 0;
    if (this.point) {
      const u = (t - this.point.at) / this.point.seconds;
      if (u >= 1) this.point = null;
      else pointing = u < 0.18 ? ease(u / 0.18) : u > 0.8 ? ease((1 - u) / 0.2) : 1;
    }

    const alive = this.alive.update(t, dt, speaking, mouthOpen, this.gesture !== null || pointing > 0);
    for (const [bone, r] of Object.entries(alive.pose) as Array<[VRMHumanBoneName, [number, number, number]]>) {
      const base = pose[bone] ?? [0, 0, 0];
      pose[bone] = [base[0] + r[0], base[1] + r[1], base[2] + r[2]];
    }

    let lift = 0;
    if (this.gesture) {
      const u = (t - this.gesture.at) / GESTURE_SECONDS[this.gesture.name];
      if (u >= 1) this.gesture = null;
      else {
        const g = gesturePose(this.gesture.name, u, t);
        lift = g.lift;
        for (const [bone, r] of Object.entries(g.pose) as Array<[VRMHumanBoneName, [number, number, number]]>) {
          const base = pose[bone] ?? [0, 0, 0];
          pose[bone] = [base[0] + r[0], base[1] + r[1], base[2] + r[2]];
        }
      }
    }

    // Gaze: eyes track exactly, the head follows part of the way.
    if (this.lookMode === "board" && t > this.lookUntil) this.lookMode = "student";
    const target = this.lookMode === "board" || !this.student ? null : this.student;
    if (target) {
      target.getWorldPosition(this.lookTarget.position);
      this.root.worldToLocal(this.lookTarget.position);
      this.lookTarget.position.x += alive.glance.x;
      this.lookTarget.position.y += alive.glance.y;
    } else if (this.point) {
      // While pointing, she looks where her finger goes.
      this.lookTarget.position.copy(this.point.world);
      this.root.worldToLocal(this.lookTarget.position);
    } else {
      this.lookTarget.position.copy(this.boardPoint);
    }
    const local = this.lookTarget.position;
    const yaw = Math.max(-0.7, Math.min(0.7, Math.atan2(local.x, local.z)));
    const pitch = Math.max(
      -0.35,
      Math.min(0.35, -Math.atan2(local.y - this.height * 0.92, Math.hypot(local.x, local.z))),
    );
    const k = 1 - Math.exp(-6 * dt);
    this.headYaw += (yaw - this.headYaw) * k;
    this.headPitch += (pitch - this.headPitch) * k;
    const head = pose.head ?? [0, 0, 0];
    pose.head = [head[0] + this.headPitch * 0.5, head[1] + this.headYaw * 0.45, head[2]];
    pose.neck = [(pose.neck?.[0] ?? 0) + this.headPitch * 0.2, this.headYaw * 0.2, 0];

    // A pointing hand: index finger out, the rest curled.
    if (pointing > 0) {
      for (const f of ["Middle", "Ring", "Little"] as const) {
        pose[`right${f}Proximal`] = [0, 0, 1.1 * pointing];
        pose[`right${f}Intermediate`] = [0, 0, 1.4 * pointing];
        pose[`right${f}Distal`] = [0, 0, 0.9 * pointing];
      }
      pose.rightThumbProximal = [0, -0.5 * pointing, 0.3 * pointing];
    }

    // Poses are written for VRM 1.0. A VRM 0.x rig faces the other way, so its X and Z axes point opposite.
    const m = this.vrm.meta.metaVersion === "0" ? -1 : 1;
    for (const [bone, r] of Object.entries(pose) as Array<[VRMHumanBoneName, [number, number, number]]>) {
      humanoid.getNormalizedBoneNode(bone)?.rotation.set(r[0] * m, r[1], r[2] * m);
    }
    const hips = humanoid.getNormalizedBoneNode("hips");
    if (hips) {
      hips.position.y += lift;
      hips.position.x += alive.shift * m;
    }
    if (pointing > 0 && this.point) this.aimRightArm(this.point.world, pointing);

    this.updateFace(dt, speaking);
    this.vrm.update(dt);
  }

  /**
   * Swing the right upper arm so it points at a world position, nearly
   * straightening the elbow. Worked out in the arm's parent space, so it's the
   * same for VRM 0.x and 1.0 rigs.
   */
  private aimRightArm(world: THREE.Vector3, weight: number): void {
    const humanoid = this.vrm.humanoid;
    const upper = humanoid.getNormalizedBoneNode("rightUpperArm");
    const lower = humanoid.getNormalizedBoneNode("rightLowerArm");
    if (!upper?.parent || !lower) return;
    upper.parent.updateWorldMatrix(true, false);
    const dir = upper.parent.worldToLocal(this.tmpA.copy(world)).sub(upper.position).normalize();
    // In the normalized rig every bone rests unrotated, so the elbow's offset is the arm's rest direction.
    const rest = this.tmpB.copy(lower.position).normalize();
    this.tmpQ.setFromUnitVectors(rest, dir);
    upper.quaternion.slerp(this.tmpQ, weight);
    lower.quaternion.slerp(this.identity, weight * 0.85);
  }

  private updateFace(dt: number, speaking: boolean): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    let goal: Record<string, number> = RESTING_FACE;
    if (this.emotion) {
      const age = this.time - this.emotion.at;
      if (age > 3.5) this.emotion = null;
      else goal = EMOTION_FACES[this.emotion.name];
    }
    if (this.time < this.winkUntil) goal = { wink: 1 };
    const target = expandFace(goal, this.cuteFaces, speaking ? 0.35 : 1);
    const k = 1 - Math.exp(-(this.time < this.winkUntil ? 20 : 8) * dt);
    // Ease every face expression toward its target, including ones the last goal used and this one doesn't.
    for (const key of new Set([...Object.keys(this.face), ...Object.keys(target)])) {
      const cur = this.face[key] ?? 0;
      this.face[key] = cur + ((target[key] ?? 0) - cur) * k;
      this.setExpression(key.toLowerCase(), this.face[key]);
    }
    VISEME_KEYS.forEach((key, i) => {
      this.setExpression(key, this.visemes[i]);
    });

    // Blink every 2-6 s, sometimes twice.
    if (this.blink.start < 0 && this.time >= this.blink.next) this.blink.start = this.time;
    let b = 0;
    if (this.blink.start >= 0) {
      const u = (this.time - this.blink.start) / 0.16;
      b = u < 0.4 ? u / 0.4 : clamp01(1 - (u - 0.4) / 0.6);
      if (u >= 1) {
        this.blink.start = -1;
        this.blink.next = this.time + (Math.random() < 0.15 ? 0.25 : 2 + Math.random() * 4);
      }
    }
    this.setExpression("blink", b);
  }

  private setExpression(key: string, weight: number): void {
    const name = this.expressionNames.get(key);
    if (name) this.vrm.expressionManager?.setValue(name, weight);
  }

  dispose(): void {
    VRMUtils.deepDispose(this.vrm.scene);
  }
}
