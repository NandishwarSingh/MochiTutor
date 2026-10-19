import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ChalkColor } from "../store";
import { RichText, Tex } from "../Tex";

// Shared pieces for the animated board pictures: chalk colours, strokes that
// draw themselves in, labels that can hold LaTeX, and a clock for things that move.

export const CHALK: Record<ChalkColor, string> = {
  chalk: "var(--chalk)",
  yellow: "var(--yellow)",
  blue: "var(--blue)",
  pink: "var(--pink)",
  green: "var(--green)",
};

export const CHALK_FILL: Record<ChalkColor, string> = {
  chalk: "rgba(236, 232, 220, 0.14)",
  yellow: "rgba(242, 207, 106, 0.2)",
  blue: "rgba(157, 205, 224, 0.2)",
  pink: "rgba(240, 162, 179, 0.2)",
  green: "rgba(169, 212, 154, 0.2)",
};

const EASE = [0.4, 0, 0.3, 1] as const;

/** A path that draws itself in, like chalk dragged across the board. */
export function Stroke({
  d,
  color = "chalk",
  width = 2.6,
  delay = 0,
  duration = 0.8,
  dashed = false,
  fill,
}: {
  d: string;
  color?: ChalkColor;
  width?: number;
  delay?: number;
  duration?: number;
  dashed?: boolean;
  fill?: string;
}) {
  if (dashed) {
    // Dash patterns and pathLength don't mix, so dashed lines fade in instead.
    return (
      <motion.path
        d={d}
        fill={fill ?? "none"}
        stroke={CHALK[color]}
        strokeWidth={width}
        strokeDasharray="7 7"
        strokeLinecap="round"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay, duration: duration * 0.6 }}
      />
    );
  }
  return (
    <motion.path
      d={d}
      fill={fill ?? "none"}
      stroke={CHALK[color]}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      initial={{ pathLength: 0, opacity: 0 }}
      animate={{ pathLength: 1, opacity: 1 }}
      transition={{ pathLength: { delay, duration, ease: EASE }, opacity: { delay, duration: 0.01 } }}
    />
  );
}

/** Fades or pops a group in at its moment. */
export function Appear({
  children,
  delay = 0,
  pop = false,
  origin,
}: {
  children: React.ReactNode;
  delay?: number;
  pop?: boolean;
  origin?: { x: number; y: number };
}) {
  return (
    <motion.g
      initial={{ opacity: 0, scale: pop ? 0.2 : 1 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay, duration: pop ? 0.35 : 0.3, ease: pop ? [0.3, 1.4, 0.5, 1] : "easeOut" }}
      style={origin ? { transformOrigin: `${origin.x}px ${origin.y}px` } : undefined}
    >
      {children}
    </motion.g>
  );
}

const hasMath = (s: string) => /\\[a-zA-Z]|\^|_|\\\(|\$/.test(s);

/**
 * A label at an SVG point. Plain words are chalk text; anything with LaTeX is
 * typeset by KaTeX inside a foreignObject.
 */
export function Label({
  x,
  y,
  text,
  color = "chalk",
  anchor = "middle",
  size = 17,
}: {
  x: number;
  y: number;
  text: string;
  color?: ChalkColor;
  anchor?: "start" | "middle" | "end";
  size?: number;
}) {
  if (!hasMath(text)) {
    return (
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        dominantBaseline="middle"
        className="ink-label"
        style={{ fill: CHALK[color], fontSize: size }}
      >
        {text}
      </text>
    );
  }
  const w = 220;
  const h = 48;
  const left = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  const justify = anchor === "start" ? "flex-start" : anchor === "end" ? "flex-end" : "center";
  const inline = /\\\(|\$/.test(text);
  return (
    <foreignObject x={left} y={y - h / 2} width={w} height={h} style={{ overflow: "visible" }}>
      <div className="ink-math" style={{ justifyContent: justify, color: CHALK[color], fontSize: size }}>
        {inline ? <RichText text={text} /> : <Tex tex={text} />}
      </div>
    </foreignObject>
  );
}

/** Seconds since mount, ticking every frame until `until`, then frozen. */
export function useClock(until: number): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const s = (now - start) / 1000;
      setT(Math.min(s, until));
      if (s < until) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [until]);
  return t;
}

/** 0 to 1 and back, `times` sweeps of `seconds` each, then resting at the far end. */
export function sweep(elapsed: number, seconds: number, times = 3): number {
  if (elapsed <= 0) return 0;
  const k = elapsed / seconds;
  if (k >= times) return times % 2 === 1 ? 1 : 0;
  const leg = Math.floor(k);
  const u = k - leg;
  const eased = u * u * (3 - 2 * u);
  return leg % 2 === 0 ? eased : 1 - eased;
}

/** An arrowhead pointing along (dx, dy) with its tip at (x, y). */
export function arrowHead(x: number, y: number, dx: number, dy: number, size = 11): string {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = x - ux * size;
  const by = y - uy * size;
  const px = -uy * size * 0.55;
  const py = ux * size * 0.55;
  return `M${(bx + px).toFixed(1)},${(by + py).toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)} L${(bx - px).toFixed(1)},${(by - py).toFixed(1)}`;
}
