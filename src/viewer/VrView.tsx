import { type RefObject, useEffect, useRef } from "react";
import type { BoardStore } from "../board/store";
import type { ArStage } from "./ar-stage";
import { BoardLayer } from "./BoardLayer";

/**
 * Side-by-side stereo for a phone in a Cardboard-style headset. Each eye gets
 * the camera picture, slid toward the nose so the real laptop screen sits at
 * the same depth as the drawn board, the board itself seen from that eye, and
 * the captions. Mochi is drawn per eye by the WebGL canvas on top.
 */
export function VrView({
  stage,
  store,
  caption,
  videos,
}: {
  stage: ArStage | null;
  store: BoardStore;
  caption: string;
  videos: [RefObject<HTMLVideoElement | null>, RefObject<HTMLVideoElement | null>];
}) {
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!stage) return;
    const halves = [left, right];
    return stage.onRendered(() => {
      stage.eyes.forEach((e, i) => {
        const half = halves[i].current;
        if (half) {
          half.style.left = `${e.half.x}px`;
          half.style.width = `${e.half.w}px`;
          half.style.height = `${e.half.h}px`;
        }
        const v = videos[i].current;
        if (v) {
          const slide = i === 0 ? e.shift : -e.shift;
          v.style.left = `${e.view.x - e.half.x + slide}px`;
          v.style.top = `${e.view.y}px`;
          v.style.width = `${e.view.w}px`;
          v.style.height = `${e.view.h}px`;
        }
      });
    });
  }, [stage, videos]);

  return (
    <>
      {[left, right].map((ref, i) => (
        <div key={i === 0 ? "left" : "right"} ref={ref} className="vr-eye">
          <video ref={videos[i]} className="camera" playsInline muted />
          <BoardLayer store={store} stage={stage} eye={i} />
          {caption && (
            <div className="vr-caption">
              <span>{caption}</span>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
