import { type VRM, type VRMHumanBoneName, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { Emotion, Gesture, Visemes } from "../shared/protocol";

// Mochi's body: a VRM model posed procedurally. No animation files, so any
// VRoid export works. Every frame the pose is rebuilt from a relaxed base,
// idle motion, the current gesture and where Mochi is looking.

type Pose = Partial<Record<VRMHumanBoneName, [number, number, number]>>;

const GESTURE_SECONDS: Record<Exclude<Gesture, "none">, number> = {
  wave: 1.8,
  nod: 1.0,
  point_board: 2.4,
  cheer: 1.5,
  shrug: 1.3,
  think: 2.4,
};

const EMOTION_FACES: Record<Emotion, Partial<Record<string, number>>> = {
  happy: { happy: 0.7 },
  excited: { happy: 1, surprised: 0.25 },
  thinking: { relaxed: 0.25 },
  surprised: { surprised: 0.75 },
  proud: { happy: 0.5, relaxed: 0.4 },
  oops: { sad: 0.35, surprised: 0.25 },
  calm: { relaxed: 0.35 },
};

const RESTING_FACE: Partial<Record<string, number>> = { happy: 0.18, relaxed: 0.12 };
const FACE_KEYS = ["happy", "relaxed", "surprised", "sad", "angry"];
const VISEME_KEYS = ["aa", "ih", "ou", "ee", "oh"] as const;

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

/** Fade in over the first 18% and out over the last 22% of a gesture. */
function envelope(u: number): number {
  if (u < 0.18) return smooth(u / 0.18);
  if (u > 0.78) return smooth((1 - u) / 0.22);
  return 1;
}

function gesturePose(name: Exclude<Gesture, "none">, u: number, t: number): Pose {
  const e = envelope(u);
  switch (name) {
    case "wave":
      return {
        rightUpperArm: [0, 0, -2.1 * e],
        rightLowerArm: [0, 0, -0.5 * e + Math.sin(t * 13) * 0.35 * e],
        head: [0, 0, 0.1 * e],
      };
    case "nod":
      return { head: [0.22 * Math.sin(u * Math.PI * 4) * e, 0, 0], neck: [0.06 * e, 0, 0] };
    case "point_board":
      return {
        rightUpperArm: [0, 0.55 * e, -1.05 * e],
        rightLowerArm: [0, 0.1 * e, 0],
        rightHand: [0, 0, 0.2 * e],
        spine: [0, -0.14 * e, 0],
        head: [0, -0.35 * e, 0],
      };
    case "cheer": {
      const bounce = Math.abs(Math.sin(u * Math.PI * 3));
      return {
        rightUpperArm: [0, 0, -2.2 * e],
        leftUpperArm: [0, 0, 2.2 * e],
        rightLowerArm: [0, 0, -0.3 * e],
        leftLowerArm: [0, 0, 0.3 * e],
        spine: [-0.06 * bounce * e, 0, 0],
        head: [-0.1 * e, 0, 0],
      };
    }
    case "shrug":
      return {
        leftShoulder: [0, 0, 0.22 * e],
        rightShoulder: [0, 0, -0.22 * e],
        leftUpperArm: [0, 0, 0.35 * e],
        rightUpperArm: [0, 0, -0.35 * e],
        leftLowerArm: [0, -0.9 * e, 0],
        rightLowerArm: [0, 0.9 * e, 0],
        head: [0, 0, 0.14 * e],
      };
    case "think":
      return {
        rightUpperArm: [0.2 * e, 0.25 * e, -0.45 * e],
        rightLowerArm: [0, 2.0 * e, 0],
        head: [-0.12 * e, 0, 0.16 * e],
      };
  }
}

export class MochiAvatar {
  readonly root = new THREE.Group();
  /** Approximate height in metres before any scaling. */
  readonly height: number;
  private time = 0;
  private visemes: Visemes = [0, 0, 0, 0, 0];
  private emotion: { name: Emotion; at: number } | null = null;
  private gesture: { name: Exclude<Gesture, "none">; at: number } | null = null;
  private face: Record<string, number> = {};
  private blink = { next: 2, start: -1 };
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
    vrm.update(0);
    const head = vrm.humanoid.getNormalizedBoneNode("head");
    const p = new THREE.Vector3();
    head?.getWorldPosition(p);
    this.height = (p.y || 1.4) + 0.14;
  }

  static async load(url: string, onProgress?: (fraction: number) => void): Promise<MochiAvatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url, (e) => {
      if (e.total) onProgress?.(e.loaded / e.total);
    });
    const vrm = gltf.userData.vrm as VRM | undefined;
    if (!vrm) throw new Error(`${url} is not a VRM model`);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
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
  }

  playGesture(name: Gesture): void {
    if (name === "none") return;
    this.gesture = { name, at: this.time };
    if (name === "point_board") this.look("board", GESTURE_SECONDS.point_board);
    if (name === "think") this.emote("thinking");
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
      chest: [0.025 * Math.sin(t * 1.6), 0, 0],
      spine: [0, 0.03 * Math.sin(t * 0.45), 0],
      hips: [0, 0.035 * Math.sin(t * 0.5), 0],
      head: [
        0.04 * mouthOpen + 0.02 * Math.sin(t * 0.9),
        0,
        0.03 * Math.sin(t * 0.7) + (speaking ? 0.02 * Math.sin(t * 3.1) : 0),
      ],
    };

    if (this.gesture) {
      const u = (t - this.gesture.at) / GESTURE_SECONDS[this.gesture.name];
      if (u >= 1) this.gesture = null;
      else {
        for (const [bone, r] of Object.entries(gesturePose(this.gesture.name, u, t)) as Array<
          [VRMHumanBoneName, [number, number, number]]
        >) {
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

    for (const [bone, r] of Object.entries(pose) as Array<[VRMHumanBoneName, [number, number, number]]>) {
      humanoid.getNormalizedBoneNode(bone)?.rotation.set(r[0], r[1], r[2]);
    }

    this.updateFace(dt, speaking);
    this.vrm.update(dt);
  }

  private updateFace(dt: number, speaking: boolean): void {
    const em = this.vrm.expressionManager;
    if (!em) return;
    let goal: Partial<Record<string, number>> = RESTING_FACE;
    if (this.emotion) {
      const age = this.time - this.emotion.at;
      if (age > 3.5) this.emotion = null;
      else goal = EMOTION_FACES[this.emotion.name];
    }
    const k = 1 - Math.exp(-8 * dt);
    for (const key of FACE_KEYS) {
      const target = (goal[key] ?? 0) * (speaking && key === "happy" ? 0.55 : 1);
      const cur = this.face[key] ?? 0;
      this.face[key] = cur + (target - cur) * k;
      em.setValue(key, this.face[key]);
    }
    VISEME_KEYS.forEach((key, i) => {
      em.setValue(key, this.visemes[i]);
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
    em.setValue("blink", b);
  }

  dispose(): void {
    VRMUtils.deepDispose(this.vrm.scene);
  }
}
