import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import type { Gesture } from "../shared/protocol";

// Gestures as procedural poses: rotations of normalized VRM 1.0 bones, added
// on top of Mochi's relaxed base pose. No animation files, so any VRoid model
// works. Right arm: +z lowers it, -z raises it, +y swings it forward. The left
// arm mirrors that.

export type Pose = Partial<Record<VRMHumanBoneName, [number, number, number]>>;
export type GestureName = Exclude<Gesture, "none">;

export const GESTURE_SECONDS: Record<GestureName, number> = {
  wave: 1.8,
  nod: 1.0,
  point_board: 2.4,
  cheer: 1.5,
  shrug: 1.3,
  think: 2.4,
  hop: 1.3,
  peace: 2.2,
  cheeks: 2.0,
  tilt: 1.4,
  clap: 1.5,
  giggle: 1.6,
  ack: 0.7,
};

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Fade in over the first 18% and out over the last 22% of a gesture. */
export function envelope(u: number): number {
  if (u < 0.18) return smooth(u / 0.18);
  if (u > 0.78) return smooth((1 - u) / 0.22);
  return 1;
}

type Side = "left" | "right";
type Finger = "Index" | "Middle" | "Ring" | "Little";

/** Curl one finger by `amount` (0 straight, 1 a loose fist). */
function curl(pose: Pose, side: Side, finger: Finger, amount: number): void {
  const s = side === "right" ? 1 : -1;
  pose[`${side}${finger}Proximal` as VRMHumanBoneName] = [0, 0, s * 1.1 * amount];
  pose[`${side}${finger}Intermediate` as VRMHumanBoneName] = [0, 0, s * 1.4 * amount];
  pose[`${side}${finger}Distal` as VRMHumanBoneName] = [0, 0, s * 0.9 * amount];
}

function tuckThumb(pose: Pose, side: Side, amount: number): void {
  const s = side === "right" ? 1 : -1;
  pose[`${side}ThumbProximal` as VRMHumanBoneName] = [0, s * -0.6 * amount, s * 0.3 * amount];
  pose[`${side}ThumbDistal` as VRMHumanBoneName] = [0, s * -0.7 * amount, 0];
}

/** Both hands up by the cheeks, like "kyaa". */
function handsToCheeks(pose: Pose, e: number): void {
  pose.rightUpperArm = [0, 0.12 * e, -0.98 * e];
  pose.leftUpperArm = [0, -0.12 * e, 0.98 * e];
  pose.rightLowerArm = [-0.6 * e, 2.45 * e, 0];
  pose.leftLowerArm = [-0.6 * e, -2.45 * e, 0];
  pose.rightHand = [0, 0, -0.45 * e];
  pose.leftHand = [0, 0, 0.45 * e];
}

/** The pose a gesture adds at progress `u` (0 to 1), plus how far it lifts her off the floor in metres. */
export function gesturePose(name: GestureName, u: number, t: number): { pose: Pose; lift: number } {
  const e = envelope(u);
  const pose: Pose = {};
  let lift = 0;
  switch (name) {
    case "wave":
      pose.rightUpperArm = [0, 0, -2.1 * e];
      pose.rightLowerArm = [0, 0, -0.5 * e + Math.sin(t * 13) * 0.35 * e];
      pose.head = [0, 0, 0.1 * e];
      break;
    case "nod":
      pose.head = [0.22 * Math.sin(u * Math.PI * 4) * e, 0, 0];
      pose.neck = [0.06 * e, 0, 0];
      break;
    case "point_board":
      pose.rightUpperArm = [0, 0.55 * e, -1.05 * e];
      pose.rightLowerArm = [0, 0.1 * e, 0];
      pose.rightHand = [0, 0, 0.2 * e];
      pose.spine = [0, -0.14 * e, 0];
      pose.head = [0, -0.35 * e, 0];
      break;
    case "cheer": {
      const bounce = Math.abs(Math.sin(u * Math.PI * 3));
      pose.rightUpperArm = [0, 0, -2.2 * e];
      pose.leftUpperArm = [0, 0, 2.2 * e];
      pose.rightLowerArm = [0, 0, -0.3 * e];
      pose.leftLowerArm = [0, 0, 0.3 * e];
      pose.spine = [-0.06 * bounce * e, 0, 0];
      pose.head = [-0.1 * e, 0, 0];
      break;
    }
    case "shrug":
      pose.leftShoulder = [0, 0, 0.22 * e];
      pose.rightShoulder = [0, 0, -0.22 * e];
      pose.leftUpperArm = [0, 0, 0.35 * e];
      pose.rightUpperArm = [0, 0, -0.35 * e];
      pose.leftLowerArm = [0, -0.9 * e, 0];
      pose.rightLowerArm = [0, 0.9 * e, 0];
      pose.head = [0, 0, 0.14 * e];
      break;
    case "think":
      pose.rightUpperArm = [0.2 * e, 0.25 * e, -0.45 * e];
      pose.rightLowerArm = [0, 2.0 * e, 0];
      pose.head = [-0.12 * e, 0, 0.16 * e];
      break;
    case "hop": {
      // Two little bunny hops with fists up: |sin| has two humps over one turn.
      const air = Math.abs(Math.sin(Math.min(1, u / 0.85) * Math.PI * 2)) * e;
      lift = 0.08 * air;
      pose.rightUpperArm = [0, 0.2 * e, -0.75 * e];
      pose.leftUpperArm = [0, -0.2 * e, 0.75 * e];
      pose.rightLowerArm = [0, 1.6 * e, 0];
      pose.leftLowerArm = [0, -1.6 * e, 0];
      pose.spine = [-0.05 * air, 0, 0];
      pose.head = [-0.08 * e, 0, 0.06 * Math.sin(t * 9) * e];
      for (const f of ["Index", "Middle", "Ring", "Little"] as const) {
        curl(pose, "right", f, e);
        curl(pose, "left", f, e);
      }
      break;
    }
    case "peace":
      // Peace sign by her cheek, head tipped toward it.
      pose.rightUpperArm = [0, 0.4 * e, -0.82 * e];
      pose.rightLowerArm = [-0.5 * e, 2.3 * e, 0];
      pose.rightHand = [0, 0, -0.25 * e];
      curl(pose, "right", "Ring", e);
      curl(pose, "right", "Little", e);
      tuckThumb(pose, "right", e);
      pose.rightIndexProximal = [0, -0.12 * e, 0];
      pose.rightMiddleProximal = [0, 0.12 * e, 0];
      pose.head = [0, 0.05 * e, -0.16 * e];
      pose.spine = [0, 0, -0.04 * e];
      break;
    case "cheeks":
      handsToCheeks(pose, e);
      pose.head = [0.06 * e, 0, 0.14 * Math.sin(u * Math.PI * 3) * e];
      pose.spine = [0.04 * e, 0, 0];
      break;
    case "ack":
      // A small "mm-hm" nod while the student is talking.
      pose.head = [0.1 * Math.sin(u * Math.PI) * e, 0, 0];
      break;
    case "tilt":
      pose.head = [0, 0.05 * e, 0.3 * e];
      pose.neck = [0, 0, 0.1 * e];
      pose.spine = [0, 0, 0.04 * e];
      break;
    case "clap": {
      const beat = Math.sin(t * 15) * e;
      // Palms turn to face each other at the wrist; twisting the forearm would change how the elbow bends.
      pose.rightUpperArm = [0, 0.9 * e, -0.5 * e];
      pose.leftUpperArm = [0, -0.9 * e, 0.5 * e];
      pose.rightLowerArm = [0, (1.55 + 0.2 * beat) * e, 0];
      pose.leftLowerArm = [0, -(1.55 + 0.2 * beat) * e, 0];
      pose.rightHand = [1.3 * e, 0, 0];
      pose.leftHand = [1.3 * e, 0, 0];
      pose.head = [-0.05 * e, 0, 0];
      break;
    }
    case "giggle": {
      // Hand over her mouth, shoulders bouncing.
      const shake = Math.sin(t * 17) * e;
      pose.rightUpperArm = [0.1 * e, 0.3 * e, -0.78 * e];
      pose.rightLowerArm = [-0.4 * e, 2.5 * e, 0];
      pose.rightHand = [0, 0, -0.3 * e];
      pose.leftShoulder = [0, 0, -0.05 * shake];
      pose.rightShoulder = [0, 0, -0.05 * shake];
      pose.spine = [0.07 * e, 0, 0];
      pose.head = [0.08 * e + 0.04 * shake, 0, 0.12 * e];
      break;
    }
  }
  return { pose, lift };
}
