import { useEffect, useMemo, useState } from "react";
import { CORNER_IDS, MARKER_DICTIONARY, markerLayout, registerMarkerDictionary } from "../shared/markers";
import type { MarkerLayout } from "../shared/protocol";
import { AR } from "../vendor/aruco/aruco.js";

registerMarkerDictionary(AR);
const dictionary = new AR.Dictionary(MARKER_DICTIONARY);

function useViewport() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return size;
}

/** ArUco markers in the screen corners so the phone can find the board. */
export function Markers({ onLayout }: { onLayout: (w: number, h: number, markers: MarkerLayout[]) => void }) {
  const { w, h } = useViewport();
  const layout = useMemo(() => markerLayout(w, h), [w, h]);
  const svgs = useMemo(() => CORNER_IDS.map((id) => dictionary.generateSVG(id) as string), []);

  useEffect(() => {
    onLayout(
      w,
      h,
      layout.map(({ id, x, y, size }) => ({ id, x, y, size })),
    );
  }, [w, h, layout, onLayout]);

  return (
    <>
      {layout.map((m, i) => (
        <div
          key={m.id}
          className="marker"
          style={{ left: m.left, top: m.top, width: m.outer, height: m.outer }}
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG generated locally from the marker dictionary
          dangerouslySetInnerHTML={{ __html: svgs[i] }}
        />
      ))}
    </>
  );
}
