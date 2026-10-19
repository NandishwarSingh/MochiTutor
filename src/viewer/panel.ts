import * as THREE from "three";

/** A rectangle in the world's x/y plane: its top-left corner, width and height, in metres. */
export interface PanelRect {
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
}

const corner = new THREE.Vector4();

/**
 * The CSS matrix3d (column-major, as `matrix3d()` takes it) that lays a
 * `pxW` x `pxH` DOM element, transformed from its top-left corner, exactly
 * over `panel` as `camera` sees it, inside a `viewW` x `viewH` container that
 * shows the same picture as the WebGL canvas. Null when any corner is behind
 * the camera, where browsers draw garbage.
 */
export function panelCssMatrix(
  camera: THREE.Camera,
  panel: PanelRect,
  viewW: number,
  viewH: number,
  pxW: number,
  pxH: number,
): number[] | null {
  camera.updateMatrixWorld();
  const view = camera.matrixWorld.clone().invert();
  // DOM pixels -> world: x along the panel, y down it, origin at its top-left corner.
  const model = new THREE.Matrix4().set(
    panel.width / pxW,
    0,
    0,
    panel.left,
    0,
    -panel.height / pxH,
    0,
    panel.top,
    0,
    0,
    1,
    panel.z,
    0,
    0,
    0,
    1,
  );
  const clip = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, view).multiply(model);
  for (const [x, y] of [
    [0, 0],
    [pxW, 0],
    [0, pxH],
    [pxW, pxH],
  ]) {
    corner.set(x, y, 0, 1).applyMatrix4(clip);
    if (corner.w <= 0.01) return null;
  }
  // Clip space -> CSS pixels of the container, y down.
  const toPx = new THREE.Matrix4().set(viewW / 2, 0, 0, viewW / 2, 0, -viewH / 2, 0, viewH / 2, 0, 0, 1, 0, 0, 0, 0, 1);
  return toPx.multiply(clip).elements.slice();
}
