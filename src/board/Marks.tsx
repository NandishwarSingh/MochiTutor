import { motion } from "motion/react";
import { useMemo } from "react";
import type { LineMark } from "./store";

// Chalk marks drawn over a board line. Shapes live in a 0-100 box stretched
// over the line, with strokes that keep their width, and each one draws itself
// in like a hand moving the chalk.

const draw = (delay = 0) => ({
  initial: { pathLength: 0, opacity: 0 },
  animate: { pathLength: 1, opacity: 1 },
  transition: {
    pathLength: { duration: 0.55, delay, ease: [0.4, 0, 0.3, 1] as const },
    opacity: { duration: 0.05, delay },
  },
});

/** A small deterministic wobble so each mark looks hand-drawn but never jumps between renders. */
function wobble(seed: number) {
  let x = seed * 9301 + 49297;
  return () => {
    x = (x * 9301 + 49297) % 233280;
    return x / 233280 - 0.5;
  };
}

function loopPath(seed: number): string {
  const r = wobble(seed);
  const start = -1.9 + r() * 0.4;
  const turns = 2 * Math.PI + 0.55;
  const points: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = start + (turns * i) / 40;
    // The loop starts a little wide and closes a little tight, like a quick chalk circle.
    const grow = 1 + 0.05 * (1 - i / 40) + r() * 0.01;
    points.push(`${(50 + 54 * grow * Math.cos(a)).toFixed(1)} ${(50 + 64 * grow * Math.sin(a)).toFixed(1)}`);
  }
  return `M ${points.join(" L ")}`;
}

function boxPath(seed: number): string {
  const r = wobble(seed);
  const j = () => r() * 3;
  return `M ${-5 + j()} ${-12 + j()} L ${104 + j()} ${-14 + j()} L ${103 + j()} ${112 + j()} L ${-4 + j()} ${110 + j()} L ${-6 + j()} ${-16 + j()}`;
}

const SIDE_PATHS = {
  tick: "M4 13.5 L9.5 19 L21 4.5",
  cross: "M5 5 L19 19 M19.5 5 L4.5 19",
  star: "M12 2.5 L14.6 9 L21.5 9.3 L16 13.6 L18 20.5 L12 16.6 L6 20.5 L8 13.6 L2.5 9.3 L9.4 9 Z",
} as const;

function Mark({ mark }: { mark: LineMark }) {
  const path = useMemo(() => {
    if (mark.style === "circle") return loopPath(mark.id);
    if (mark.style === "box") return boxPath(mark.id);
    return null;
  }, [mark.id, mark.style]);

  if (mark.style === "highlight") {
    return (
      <motion.span
        className="mark-highlight"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.45, ease: [0.4, 0, 0.3, 1] }}
      />
    );
  }
  if (mark.style === "tick" || mark.style === "cross" || mark.style === "star") {
    return (
      <span className="mark-side" data-style={mark.style}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <motion.path d={SIDE_PATHS[mark.style]} {...draw(mark.delay)} />
        </svg>
        {mark.label && <span className="mark-label">{mark.label}</span>}
      </span>
    );
  }
  const label = mark.label && <span className="mark-label mark-label-end">{mark.label}</span>;
  if (mark.style === "underline") {
    // Dashes misbehave on a box this wide and flat, so the underline wipes in instead of drawing.
    return (
      <>
        <motion.svg
          className="mark-over"
          data-style="underline"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          initial={{ clipPath: "inset(-10% 100% -40% -5%)" }}
          animate={{ clipPath: "inset(-10% -5% -40% -5%)" }}
          transition={{ duration: 0.5, delay: mark.delay ?? 0, ease: [0.4, 0, 0.3, 1] }}
        >
          <path d="M -2 112 Q 30 118 60 113 T 103 110" />
          <path d="M 4 119 Q 40 123 98 117" />
        </motion.svg>
        {label}
      </>
    );
  }
  return (
    <>
      <svg
        className="mark-over"
        data-style={mark.style}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {path && <motion.path d={path} {...draw(mark.delay)} />}
      </svg>
      {label}
    </>
  );
}

export function Marks({ marks }: { marks?: LineMark[] }) {
  if (!marks?.length) return null;
  return (
    <>
      {marks.map((m) => (
        <Mark key={m.id} mark={m} />
      ))}
    </>
  );
}
