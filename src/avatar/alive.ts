import type { Pose } from "./gestures";

// The small motions that make Mochi look alive between gestures: breathing
// in her shoulders, shifting her weight from foot to foot, hands that move
// while she explains, an open-palm "see?" now and then, an attentive lean
// while the student talks, and quick glances so her eyes are never frozen.
// Everything here is added on top of her base pose and any gesture.

const smooth = (u: number) => u * u * (3 - 2 * u);
const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export interface AliveFrame {
  pose: Pose;
  /** sideways hip shift in metres */
  shift: number;
  /** offset for her gaze target, in metres, so the eyes make small saccades */
  glance: { x: number; y: number };
}

export class Alive {
  private side = 1;
  private sideFrom = 1;
  private sideAt = Number.NEGATIVE_INFINITY;
  private nextShift = between(5, 9);
  private talking = 0;
  private energy = 0;
  private talkSince = -1;
  private explain: { at: number; hand: "left" | "right" } | null = null;
  private nextExplain = between(4, 7);
  private glance = { x: 0, y: 0 };
  private nextGlance = between(1, 3);
  private listening = 0;

  /** Whether the student is talking right now; she leans in a little. */
  attentive = false;

  update(t: number, dt: number, speaking: boolean, mouthOpen: number, gestureBusy: boolean): AliveFrame {
    const pose: Pose = {};
    const add = (bone: keyof Pose, r: [number, number, number]) => {
      const b = pose[bone] ?? [0, 0, 0];
      pose[bone] = [b[0] + r[0], b[1] + r[1], b[2] + r[2]];
    };

    // Breathing: the chest swells and the shoulders rise a touch.
    const breath = (Math.sin(t * 1.6) + 1) / 2;
    add("chest", [0.022 * breath, 0, 0]);
    add("rightShoulder", [0, 0, -0.018 * breath]);
    add("leftShoulder", [0, 0, 0.018 * breath]);

    // Weight shift every few seconds, with the free knee softening.
    if (t >= this.nextShift && !speaking) {
      this.sideFrom = this.currentSide(t);
      this.side = -this.side;
      this.sideAt = t;
      this.nextShift = t + between(6, 11);
    }
    const w = this.currentSide(t);
    add("hips", [0, 0, 0.03 * w]);
    add("spine", [0, 0, -0.025 * w]);
    add(w > 0 ? "leftLowerLeg" : "rightLowerLeg", [0.07 * Math.abs(w), 0, 0]);
    add(w > 0 ? "leftUpperLeg" : "rightUpperLeg", [-0.035 * Math.abs(w), 0, 0]);

    // While she talks her forearms come up into an explaining pose and move with her voice.
    const k = 1 - Math.exp(-4 * dt);
    this.talking += ((speaking ? 1 : 0) - this.talking) * k;
    this.energy += (mouthOpen - this.energy) * (1 - Math.exp(-10 * dt));
    const hands = gestureBusy ? 0 : this.talking;
    add("rightUpperArm", [0, 0.16 * hands, -0.12 * hands]);
    add("leftUpperArm", [0, -0.12 * hands, 0.1 * hands]);
    add("rightLowerArm", [0, (0.55 + 0.35 * this.energy) * hands, 0]);
    add("leftLowerArm", [0, -(0.4 + 0.25 * this.energy) * hands, 0]);
    add("rightHand", [0.25 * hands, 0, -0.1 * hands]);
    add("leftHand", [0.25 * hands, 0, 0.1 * hands]);

    // Now and then, an open palm toward the student, alternating hands.
    if (speaking) {
      if (this.talkSince < 0) this.talkSince = t;
      if (!this.explain && !gestureBusy && t - this.talkSince > this.nextExplain) {
        this.explain = { at: t, hand: Math.random() < 0.6 ? "right" : "left" };
        this.talkSince = t;
        this.nextExplain = between(6, 10);
      }
    } else {
      this.talkSince = -1;
    }
    if (this.explain) {
      const u = (t - this.explain.at) / 1.6;
      if (u >= 1 || gestureBusy) this.explain = null;
      else {
        const e = u < 0.25 ? smooth(u / 0.25) : u > 0.7 ? smooth((1 - u) / 0.3) : 1;
        if (this.explain.hand === "right") {
          add("rightUpperArm", [0, 0.3 * e, -0.3 * e]);
          add("rightLowerArm", [0, 0.6 * e, 0]);
          add("rightHand", [0.9 * e, 0, 0]);
        } else {
          add("leftUpperArm", [0, -0.3 * e, 0.3 * e]);
          add("leftLowerArm", [0, -0.6 * e, 0]);
          add("leftHand", [0.9 * e, 0, 0]);
        }
        add("head", [0.05 * e, 0, this.explain.hand === "right" ? -0.05 * e : 0.05 * e]);
      }
    }

    // Listening: a slight lean forward and a curious head tilt.
    this.listening += ((this.attentive && !speaking ? 1 : 0) - this.listening) * (1 - Math.exp(-3 * dt));
    add("spine", [0.045 * this.listening, 0, 0]);
    add("head", [0.03 * this.listening, 0, 0.07 * this.listening]);

    // Saccades: the eyes jump to a nearby spot every second or three.
    if (t >= this.nextGlance) {
      this.glance = { x: between(-0.05, 0.05), y: between(-0.03, 0.03) };
      this.nextGlance = t + between(1.2, 3.5);
    }

    return { pose, shift: 0.012 * w, glance: this.glance };
  }

  private currentSide(t: number): number {
    const u = Math.min(1, (t - this.sideAt) / 1.4);
    return this.sideFrom + (this.side - this.sideFrom) * smooth(Math.max(0, u));
  }
}
