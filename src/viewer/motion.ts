import * as THREE from "three";

// The phone's gyroscope, as camera rotations over time. Marker tracking only
// lands every few frames and each fix is a little late, which is what makes AR
// content feel like it floats behind the video. The gyro reports about 60
// times a second, so between fixes the view turns with the phone and the
// markers only correct the drift.

const ZEE = new THREE.Vector3(0, 0, 1);
const EULER = new THREE.Euler();
const SCREEN = new THREE.Quaternion();
/** The camera looks out of the back of the phone, not out of its top. */
const BACK = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const deg = THREE.MathUtils.degToRad;

/**
 * The rotation of a camera looking out of the back of the phone, from a
 * deviceorientation reading and the screen's rotation, in the same convention
 * as a three.js camera (x right, y up, looking down -z).
 */
export function cameraQuaternion(alpha: number, beta: number, gamma: number, screenAngle: number): THREE.Quaternion {
  EULER.set(deg(beta), deg(alpha), -deg(gamma), "YXZ");
  const q = new THREE.Quaternion().setFromEuler(EULER);
  q.multiply(BACK);
  q.multiply(SCREEN.setFromAxisAngle(ZEE, -deg(screenAngle)));
  return q;
}

function screenAngle(): number {
  if (typeof screen !== "undefined" && screen.orientation) return screen.orientation.angle;
  const legacy = (window as unknown as { orientation?: number }).orientation;
  return typeof legacy === "number" ? legacy : 0;
}

interface Sample {
  t: number;
  q: THREE.Quaternion;
}

export class DeviceRotation {
  private readonly samples: Sample[] = [];
  private listening = false;

  /** Ask for motion access, which iOS only grants from a tap, and say whether we have it. */
  static async request(): Promise<boolean> {
    if (typeof DeviceOrientationEvent === "undefined") return false;
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    if (typeof ask !== "function") return true;
    try {
      return (await ask.call(DeviceOrientationEvent)) === "granted";
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("deviceorientation", this.onOrientation);
  }

  stop(): void {
    this.listening = false;
    window.removeEventListener("deviceorientation", this.onOrientation);
    this.samples.length = 0;
  }

  /** Whether readings are arriving right now. */
  get live(): boolean {
    const last = this.samples.at(-1);
    return !!last && performance.now() - last.t < 300;
  }

  private readonly onOrientation = (e: DeviceOrientationEvent) => {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    this.add(e.timeStamp || performance.now(), cameraQuaternion(e.alpha, e.beta, e.gamma, screenAngle()));
  };

  /** Add a reading; exposed for tests. */
  add(t: number, q: THREE.Quaternion): void {
    this.samples.push({ t, q });
    while (this.samples.length > 2 && t - this.samples[0].t > 1500) this.samples.shift();
  }

  /** The camera's rotation at time t (performance.now() ms), interpolated between readings. */
  at(t: number): THREE.Quaternion | null {
    const s = this.samples;
    if (!s.length) return null;
    if (t <= s[0].t) return s[0].t - t < 100 ? s[0].q.clone() : null;
    const last = s[s.length - 1];
    if (t >= last.t) return t - last.t < 150 ? last.q.clone() : null;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > t) i--;
    const a = s[i - 1];
    const b = s[i];
    return a.q.clone().slerp(b.q, (t - a.t) / (b.t - a.t || 1));
  }

  /** How the camera turned between t1 and t2, in its own frame at t1: q(t1)^-1 * q(t2). */
  delta(t1: number, t2: number): THREE.Quaternion | null {
    const a = this.at(t1);
    const b = this.at(t2);
    return a && b ? a.invert().multiply(b) : null;
  }
}
