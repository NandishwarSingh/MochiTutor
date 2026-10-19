import { useEffect, useRef } from "react";
import { Board } from "../board/Board";
import type { BoardStore } from "../board/store";
import type { ArStage } from "./ar-stage";

/** The phone's board is laid out at a laptop board's size, so pages break the same way and text keeps its proportions. */
export const PANEL_PX = { w: 1120, h: 700 };

export interface View {
  /** where this view sits on screen, in CSS pixels, matching the canvas it draws over */
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The real board, drawn as DOM so KaTeX, the chalk font and every widget look
 * exactly as on the laptop, then laid onto the AR board panel with a matrix3d
 * that's recomputed after every rendered frame. Crisp at any distance, and it
 * costs the GPU almost nothing.
 *
 * In a headset there is one layer per eye: `eye` picks which, and the layer
 * follows that eye's camera and the spot its picture has in its half of the screen.
 */
export function BoardLayer({
  store,
  stage,
  view,
  eye,
}: {
  store: BoardStore;
  stage: ArStage | null;
  view?: View;
  eye?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const s = stage;
    if (!s) return;
    let last = "";
    return s.onRendered(() => {
      const el = panel.current;
      if (!el) return;
      let m: number[] | null;
      if (eye === undefined) {
        if (!view) return;
        m = s.panelCssMatrix(view.width, view.height, PANEL_PX.w, PANEL_PX.h);
      } else {
        const e = s.eyes[eye];
        const b = box.current;
        if (b) {
          b.style.left = `${e.view.x - e.half.x}px`;
          b.style.top = `${e.view.y}px`;
          b.style.width = `${e.view.w}px`;
          b.style.height = `${e.view.h}px`;
        }
        m = s.panelCssMatrix(e.view.w, e.view.h, PANEL_PX.w, PANEL_PX.h, e.camera);
      }
      if (!m) {
        if (last !== "none") el.style.visibility = "hidden";
        last = "none";
        return;
      }
      const t = `matrix3d(${m.map((v) => v.toPrecision(8)).join(",")})`;
      if (t !== last) {
        el.style.transform = t;
        el.style.visibility = "visible";
        last = t;
      }
    });
  }, [stage, view, eye]);

  return (
    <div ref={box} className="ar-board-view" style={view}>
      <div ref={panel} className="ar-board" style={{ width: PANEL_PX.w, height: PANEL_PX.h, visibility: "hidden" }}>
        <Board store={store} />
      </div>
    </div>
  );
}

/** Where an item sits on the drawn board, as fractions of the board from its top-left, untouched by the 3D transform. */
export function itemSpot(root: HTMLElement, id: number): { x: number; y: number } | null {
  const el =
    root.querySelector<HTMLElement>(`.board-item[data-id="${id}"] .line-ink`) ??
    root.querySelector<HTMLElement>(`.board-item[data-id="${id}"]`);
  if (!el) return null;
  // Layout offsets ignore transforms, which is exactly what's needed here.
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== root) return null;
  // Offsets start inside the board's wooden frame.
  x += root.clientLeft;
  y += root.clientTop;
  return {
    x: Math.min(1, Math.max(0, (x + Math.min(48, el.offsetWidth * 0.2)) / PANEL_PX.w)),
    y: Math.min(1, Math.max(0, (y + Math.min(el.offsetHeight / 2, 30)) / PANEL_PX.h)),
  };
}
