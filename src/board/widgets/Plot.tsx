import { motion } from "motion/react";
import { useMemo } from "react";
import { compileFunction } from "../../lib/calc";
import { formatTick, linear, niceTicks } from "./chart";

const W = 620;
const H = 300;
const PAD = { l: 50, r: 16, t: 14, b: 34 };

export function Plot({
  expression,
  xMin,
  xMax,
  label,
}: {
  expression: string;
  xMin: number;
  xMax: number;
  label?: string;
}) {
  const view = useMemo(() => {
    const f = compileFunction(expression);
    const n = 480;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= n; i++) {
      const xv = xMin + ((xMax - xMin) * i) / n;
      let yv = Number.NaN;
      try {
        yv = f(xv);
      } catch {
        // leave a gap
      }
      pts.push([xv, yv]);
    }
    const finite = pts
      .map((p) => p[1])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    let lo = finite[Math.floor(finite.length * 0.02)] ?? -1;
    let hi = finite[Math.ceil(finite.length * 0.98) - 1] ?? 1;
    if (hi - lo < 1e-9) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.1;
    return { pts, lo: lo - pad, hi: hi + pad };
  }, [expression, xMin, xMax]);

  const x = linear(xMin, xMax, PAD.l, W - PAD.r);
  const y = linear(view.lo, view.hi, H - PAD.b, PAD.t);
  let d = "";
  let pen = false;
  for (const [xv, yv] of view.pts) {
    if (!Number.isFinite(yv) || yv < view.lo - (view.hi - view.lo) || yv > view.hi + (view.hi - view.lo)) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${x(xv).toFixed(1)},${y(yv).toFixed(1)}`;
    pen = true;
  }
  const axisY = view.lo <= 0 && view.hi >= 0 ? y(0) : H - PAD.b;
  const axisX = xMin <= 0 && xMax >= 0 ? x(0) : PAD.l;

  return (
    <div className="widget">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
        {niceTicks(view.lo, view.hi, 5).map((v) => (
          <g key={`y${v}`}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text x={PAD.l - 8} y={y(v) + 5} textAnchor="end">
              {formatTick(v)}
            </text>
          </g>
        ))}
        {niceTicks(xMin, xMax, 8).map((v) => (
          <g key={`x${v}`}>
            <line className="grid" x1={x(v)} x2={x(v)} y1={PAD.t} y2={H - PAD.b} />
            <text x={x(v)} y={H - 10} textAnchor="middle">
              {formatTick(v)}
            </text>
          </g>
        ))}
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={axisY} y2={axisY} />
        <line className="axis" x1={axisX} x2={axisX} y1={PAD.t} y2={H - PAD.b} />
        <motion.path
          d={d}
          fill="none"
          stroke="var(--yellow)"
          strokeWidth={2.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
        />
      </svg>
      <p className="widget-caption">{label ?? `y = ${expression}`}</p>
    </div>
  );
}
