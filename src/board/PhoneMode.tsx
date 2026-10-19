import { useEffect, useMemo } from "react";
import { fullScreenLayout } from "../shared/markers";
import type { Lesson, LessonState } from "./lesson";
import { markerSvg, useViewport } from "./Markers";

/** Height of the control strip under the markers. */
const STRIP = 56;

/**
 * Phone mode on the laptop: the whole screen is a grid of markers for the
 * phone to track, and the phone draws the board and Mochi. A thin strip at the
 * bottom keeps the lesson controls in reach.
 */
export function PhoneMode({ lesson, state }: { lesson: Lesson; state: LessonState }) {
  const { w, h } = useViewport();
  const layout = useMemo(() => fullScreenLayout(w, h, STRIP), [w, h]);
  const svgs = useMemo(() => layout.map((m) => markerSvg(m.id)), [layout]);

  useEffect(() => {
    lesson.setLayout(
      w,
      h,
      layout.map(({ id, x, y, size }) => ({ id, x, y, size })),
      true,
    );
  }, [lesson, w, h, layout]);

  const live = state.status === "live" || state.status === "reconnecting" || state.status === "connecting";
  return (
    <div className="phone-mode">
      {layout.map((m, i) => (
        <div
          key={m.id}
          className="marker"
          style={{ left: m.left, top: m.top, width: m.outer, height: m.outer }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated locally from the marker dictionary
          dangerouslySetInnerHTML={{ __html: svgs[i] }}
        />
      ))}
      <div className="phone-strip">
        <span>The board is on your phone. Keep this screen in its view.</span>
        {live ? (
          <button type="button" className="btn" onClick={() => lesson.stop()}>
            End lesson
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void lesson.start()}>
            Start lesson
          </button>
        )}
        <button type="button" className="btn" onClick={() => lesson.setPhoneBoard(false)}>
          Show the board here
        </button>
      </div>
    </div>
  );
}
