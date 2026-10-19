import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { CODES, fullScreenLayout } from "../src/shared/markers";
import { parseMessage } from "../src/shared/protocol";
import { cameraQuaternion, DeviceRotation } from "../src/viewer/motion";
import { panelCssMatrix } from "../src/viewer/panel";

const bits = ([a, b]: number[]) =>
  [...`${a.toString(2).padStart(8, "0")}${b.toString(2).padStart(8, "0")}`].map(Number);
const rot = (c: number[]) => Array.from({ length: 16 }, (_, i) => c[(3 - (i % 4)) * 4 + Math.floor(i / 4)]);
const dist = (a: number[], b: number[]) => a.filter((x, i) => x !== b[i]).length;

describe("marker codes", () => {
  test("every pair differs in at least 5 cells in every rotation, and none looks like itself turned", () => {
    const codes = CODES.map(bits);
    for (let i = 0; i < codes.length; i++) {
      let r = codes[i];
      for (let k = 1; k < 4; k++) {
        r = rot(r);
        expect(dist(codes[i], r)).toBeGreaterThanOrEqual(4);
      }
      for (let j = i + 1; j < codes.length; j++) {
        let rj = codes[j];
        for (let k = 0; k < 4; k++) {
          expect(dist(codes[i], rj)).toBeGreaterThanOrEqual(5);
          rj = rot(rj);
        }
      }
    }
  });

  test("the full-screen grid fills the screen without overlaps and keeps the control strip clear", () => {
    for (const [w, h] of [
      [1440, 900],
      [1280, 800],
      [1920, 1080],
      [1024, 768],
    ]) {
      const layout = fullScreenLayout(w, h, 56);
      expect(layout.length).toBeGreaterThanOrEqual(9);
      expect(new Set(layout.map((m) => m.id)).size).toBe(layout.length);
      for (const m of layout) {
        expect(m.left).toBeGreaterThanOrEqual(0);
        expect(m.top).toBeGreaterThanOrEqual(0);
        expect(m.left + m.outer).toBeLessThanOrEqual(w);
        expect(m.top + m.outer).toBeLessThanOrEqual(h - 56);
        expect(m.id).toBeLessThan(CODES.length);
      }
      for (const a of layout)
        for (const b of layout)
          if (a !== b)
            expect(
              a.left + a.outer <= b.left ||
                b.left + b.outer <= a.left ||
                a.top + a.outer <= b.top ||
                b.top + b.outer <= a.top,
            ).toBe(true);
      // Big enough to read from across a desk.
      expect(layout[0].outer).toBeGreaterThan(Math.min(w, h) * 0.2);
    }
  });
});

describe("phone mode messages", () => {
  test("board snapshots, photos, captions and point-item from the board; board-mode from the phone", () => {
    expect(parseMessage("board", JSON.stringify({ t: "board", items: [], focus: null }))).not.toBeNull();
    expect(
      parseMessage("board", JSON.stringify({ t: "photo", id: 3, data: "data:image/jpeg;base64,AAAA" })),
    ).not.toBeNull();
    expect(parseMessage("board", JSON.stringify({ t: "photo", id: 3, data: "https://evil.example/x.jpg" }))).toBeNull();
    expect(parseMessage("board", JSON.stringify({ t: "caption", mochi: "hi", you: "" }))).not.toBeNull();
    expect(parseMessage("board", JSON.stringify({ t: "point-item", id: 9 }))).not.toBeNull();
    expect(parseMessage("viewer", JSON.stringify({ t: "board-mode", on: true }))).not.toBeNull();
    expect(parseMessage("viewer", JSON.stringify({ t: "board", items: [], focus: null }))).toBeNull();
  });

  test("size limits depend on the kind of message", () => {
    const bigCaption = JSON.stringify({ t: "caption", mochi: "x".repeat(5000), you: "" });
    expect(parseMessage("board", bigCaption)).toBeNull();
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: i,
      kind: "line",
      line: "text",
      content: "y".repeat(400),
    }));
    expect(parseMessage("board", JSON.stringify({ t: "board", items, focus: 4 }))).not.toBeNull();
    const huge = JSON.stringify({ t: "photo", id: 1, data: `data:image/jpeg;base64,${"A".repeat(500_000)}` });
    expect(parseMessage("board", huge)).toBeNull();
  });
});

describe("panelCssMatrix", () => {
  test("lays the DOM panel's corners exactly where the camera sees the board's corners", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 100);
    camera.position.set(0.3, 0.2, 1.4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const panel = { left: -0.6, top: 0.4, width: 1.2, height: 0.75, z: 0 };
    const [vw, vh, pw, ph] = [1280, 720, 1120, 700];
    const m = panelCssMatrix(camera, panel, vw, vh, pw, ph);
    expect(m).not.toBeNull();
    const css = new THREE.Matrix4().fromArray(m as number[]);
    for (const [x, y] of [
      [0, 0],
      [pw, 0],
      [0, ph],
      [pw, ph],
      [pw / 2, ph / 3],
    ]) {
      const p = new THREE.Vector4(x, y, 0, 1).applyMatrix4(css);
      const world = new THREE.Vector3(
        panel.left + (x / pw) * panel.width,
        panel.top - (y / ph) * panel.height,
        0,
      ).project(camera);
      expect(p.x / p.w).toBeCloseTo(((world.x + 1) / 2) * vw, 3);
      expect(p.y / p.w).toBeCloseTo(((1 - world.y) / 2) * vh, 3);
    }
  });

  test("gives up when the board is behind the camera", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
    camera.position.set(0, 0, 1);
    camera.lookAt(0, 0, 2);
    camera.updateMatrixWorld();
    expect(panelCssMatrix(camera, { left: -0.5, top: 0.5, width: 1, height: 1, z: 0 }, 100, 100, 100, 100)).toBeNull();
  });
});

describe("DeviceRotation", () => {
  test("a phone held upright in portrait looks straight ahead, and flat on a table looks down", () => {
    const forward = (q: THREE.Quaternion) => new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const upright = forward(cameraQuaternion(0, 90, 0, 0));
    expect(upright.y).toBeCloseTo(0, 5);
    const flat = forward(cameraQuaternion(0, 0, 0, 0));
    expect(flat.y).toBeCloseTo(-1, 5);
  });

  test("interpolates readings and reports turns in the camera's own frame", () => {
    const r = new DeviceRotation();
    const yaw = (deg: number) =>
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(deg));
    r.add(1000, yaw(0));
    r.add(1016, yaw(2));
    r.add(1032, yaw(4));
    const mid = r.at(1024) as THREE.Quaternion;
    expect(THREE.MathUtils.radToDeg(mid.angleTo(yaw(0)))).toBeCloseTo(3, 4);
    const turn = r.delta(1000, 1032) as THREE.Quaternion;
    expect(THREE.MathUtils.radToDeg(turn.angleTo(new THREE.Quaternion()))).toBeCloseTo(4, 4);
    // Too far from any reading: no guess.
    expect(r.at(5000)).toBeNull();
  });
});
