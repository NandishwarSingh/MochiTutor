import { useId, useMemo } from "react";
import { compileFunction } from "../../lib/calc";
import type { DiagramShape, DiagramSpec, XY } from "../store";
import { RichText } from "../Tex";
import { formatTick, linear, niceTicks } from "./chart";
import { Appear, arrowHead, CHALK, CHALK_FILL, Label, Stroke, sweep, useClock } from "./ink";

// A manim-style picture on the board: axes, curves, shapes and labels drawn
// in one after another, plus things that move (a tangent sliding along a
// curve, a point riding it). Everything is SVG, so it stays sharp at any size.

const W = 560;
const PAD = 30;
/** Seconds for one pass of a sliding tangent or a moving point. */
const SWEEP_SECONDS = 3.2;
const SWEEPS = 3;

type Fn = (x: number) => number;

function safe(f: Fn, x: number): number {
  try {
    const y = f(x);
    return Number.isFinite(y) ? y : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

/** How long each kind of shape takes to draw, in seconds. */
function drawTime(s: DiagramShape): number {
  switch (s.type) {
    case "function":
      return 1.2;
    case "area":
      return 0.9;
    case "polygon":
      return 0.25 * s.points.length + 0.2;
    case "circle":
      return 0.8;
    case "tangent":
    case "moving_point":
      return 0.6;
    case "point":
    case "label":
      return 0.3;
    default:
      return 0.55;
  }
}

export function Diagram({ spec }: { spec: DiagramSpec }) {
  const [x0, x1] = spec.xRange;
  const [y0, y1] = spec.yRange;
  // Equal axes keep circles round; graphs get a fixed, comfortable height instead.
  const H = spec.equal
    ? Math.round(Math.min(520, Math.max(240, ((W - 2 * PAD) * (y1 - y0)) / (x1 - x0) + 2 * PAD)))
    : 360;
  const sx = linear(x0, x1, PAD, W - PAD);
  const sy = linear(y0, y1, H - PAD, PAD);
  const pt = (p: XY) => ({ x: sx(p.x), y: sy(p.y) });

  const fns = useMemo(() => {
    const m = new Map<string, Fn>();
    for (const s of spec.shapes) {
      if ("expression" in s && !m.has(s.expression)) m.set(s.expression, compileFunction(s.expression));
    }
    return m;
  }, [spec.shapes]);

  // When each shape starts drawing: in order, each one overlapping the last a little.
  const starts: number[] = [];
  let t = spec.axes || spec.grid ? 0.55 : 0.1;
  for (const s of spec.shapes) {
    starts.push(t);
    t += drawTime(s) * 0.7;
  }
  const motionEnd = Math.max(
    t,
    ...spec.shapes.map((s, i) =>
      s.type === "tangent" || s.type === "moving_point" ? starts[i] + 0.6 + SWEEP_SECONDS * SWEEPS + 0.9 : 0,
    ),
  );
  const clock = useClock(motionEnd + 0.1);

  const curve = (f: Fn, from = x0, to = x1) => {
    let d = "";
    let pen = false;
    const n = 220;
    const span = y1 - y0;
    for (let i = 0; i <= n; i++) {
      const xv = from + ((to - from) * i) / n;
      const yv = safe(f, xv);
      if (!Number.isFinite(yv) || yv < y0 - span || yv > y1 + span) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${sx(xv).toFixed(1)},${sy(yv).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const uid = useId().replace(/:/g, "");
  const ax = Math.min(Math.max(0, y0), y1);
  const ay = Math.min(Math.max(0, x0), x1);

  return (
    <div className="widget diagram">
      {spec.title && (
        <p className="widget-title">
          <RichText text={spec.title} />
        </p>
      )}
      <svg className="chart ink" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img">
        <defs>
          <clipPath id={`${uid}-frame`}>
            <rect x={PAD - 6} y={PAD - 6} width={W - 2 * PAD + 12} height={H - 2 * PAD + 12} />
          </clipPath>
        </defs>
        {spec.grid &&
          niceTicks(x0, x1, 8).map((v) => (
            <line key={`gx${v}`} className="grid" x1={sx(v)} x2={sx(v)} y1={PAD} y2={H - PAD} />
          ))}
        {spec.grid &&
          niceTicks(y0, y1, 6).map((v) => (
            <line key={`gy${v}`} className="grid" x1={PAD} x2={W - PAD} y1={sy(v)} y2={sy(v)} />
          ))}
        {spec.axes && (
          <>
            <Stroke d={`M${PAD},${sy(ax)} L${W - PAD},${sy(ax)}`} color="chalk" width={1.8} duration={0.45} />
            <Stroke
              d={`M${sx(ay)},${H - PAD} L${sx(ay)},${PAD}`}
              color="chalk"
              width={1.8}
              duration={0.45}
              delay={0.1}
            />
            <Appear delay={0.4}>
              {niceTicks(x0, x1, 8)
                .filter((v) => v !== 0)
                .map((v) => (
                  <text key={`tx${v}`} className="tick" x={sx(v)} y={sy(ax) + 17} textAnchor="middle">
                    {formatTick(v)}
                  </text>
                ))}
              {niceTicks(y0, y1, 6)
                .filter((v) => v !== 0)
                .map((v) => (
                  <text key={`ty${v}`} className="tick" x={sx(ay) - 7} y={sy(v) + 5} textAnchor="end">
                    {formatTick(v)}
                  </text>
                ))}
            </Appear>
          </>
        )}
        <g clipPath={`url(#${uid}-frame)`}>
          {spec.shapes
            .map((s, i) => ({ s, id: `${uid}-${i}`, start: starts[i] }))
            .map(({ s, id, start }) => (
              <Shape
                key={id}
                id={id}
                shape={s}
                start={start}
                clock={clock}
                fns={fns}
                pt={pt}
                curve={curve}
                sx={sx}
                sy={sy}
              />
            ))}
        </g>
      </svg>
    </div>
  );
}

interface ShapeProps {
  /** unique within the page, for SVG clip ids */
  id: string;
  shape: DiagramShape;
  start: number;
  clock: number;
  fns: Map<string, Fn>;
  pt: (p: XY) => { x: number; y: number };
  curve: (f: Fn, from?: number, to?: number) => string;
  sx: (v: number) => number;
  sy: (v: number) => number;
}

function Shape({ id, shape: s, start, clock, fns, pt, curve, sx, sy }: ShapeProps) {
  switch (s.type) {
    case "function": {
      const f = fns.get(s.expression) as Fn;
      const d = curve(f);
      return (
        <>
          <Stroke d={d} color={s.color} width={2.8} delay={start} duration={1.2} dashed={s.dashed} />
          {s.label && <FunctionLabel f={f} label={s.label} color={s.color} start={start + 1} sx={sx} sy={sy} />}
        </>
      );
    }
    case "area": {
      const f = fns.get(s.expression) as Fn;
      let d = `M${sx(s.from)},${sy(0)}`;
      const n = 120;
      for (let i = 0; i <= n; i++) {
        const xv = s.from + ((s.to - s.from) * i) / n;
        const yv = safe(f, xv);
        d += ` L${sx(xv).toFixed(1)},${sy(Number.isFinite(yv) ? yv : 0).toFixed(1)}`;
      }
      d += ` L${sx(s.to)},${sy(0)} Z`;
      const mid = (s.from + s.to) / 2;
      const midY = safe(f, mid);
      return (
        <>
          <clipPath id={`${id}-sweep`}>
            <rect
              x={sx(s.from)}
              y={0}
              height="100%"
              width={Math.max(0, (sx(s.to) - sx(s.from)) * Math.min(1, Math.max(0, (clock - start) / 0.9)))}
            />
          </clipPath>
          <path d={d} fill={CHALK_FILL[s.color]} stroke="none" clipPath={`url(#${id}-sweep)`} />
          {s.label && (
            <Appear delay={start + 0.9}>
              <Label x={sx(mid)} y={sy((Number.isFinite(midY) ? midY : 0) / 2)} text={s.label} color={s.color} />
            </Appear>
          )}
        </>
      );
    }
    case "point": {
      const p = pt(s.at);
      return (
        <Appear delay={start} pop>
          <circle cx={p.x} cy={p.y} r={5.5} fill={CHALK[s.color]} />
          {s.label && <Label x={p.x + 10} y={p.y - 14} text={s.label} color={s.color} anchor="start" />}
        </Appear>
      );
    }
    case "segment":
    case "arrow": {
      const a = pt(s.from);
      const b = pt(s.to);
      return (
        <>
          <Stroke d={`M${a.x},${a.y} L${b.x},${b.y}`} color={s.color} delay={start} duration={0.55} dashed={s.dashed} />
          {s.type === "arrow" && (
            <Stroke d={arrowHead(b.x, b.y, b.x - a.x, b.y - a.y)} color={s.color} delay={start + 0.5} duration={0.2} />
          )}
          {s.label && (
            <Appear delay={start + 0.5}>
              <Label
                x={(a.x + b.x) / 2 + normal(a, b).x * 16}
                y={(a.y + b.y) / 2 + normal(a, b).y * 16}
                text={s.label}
                color={s.color}
              />
            </Appear>
          )}
        </>
      );
    }
    case "polygon": {
      const ps = s.points.map(pt);
      const d = `M${ps.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L")} Z`;
      const c = ps.reduce((acc, p) => ({ x: acc.x + p.x / ps.length, y: acc.y + p.y / ps.length }), { x: 0, y: 0 });
      const time = 0.25 * ps.length + 0.2;
      return (
        <>
          {s.fill && (
            <Appear delay={start + time}>
              <path d={d} fill={CHALK_FILL[s.color]} />
            </Appear>
          )}
          <Stroke d={d} color={s.color} delay={start} duration={time} />
          {s.vertexLabels?.map((v, i) => {
            const p = ps[i];
            if (!p || !v) return null;
            const dx = p.x - c.x;
            const dy = p.y - c.y;
            const len = Math.hypot(dx, dy) || 1;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: one label per vertex
              <Appear key={i} delay={start + 0.25 * (i + 1)}>
                <Label x={p.x + (dx / len) * 18} y={p.y + (dy / len) * 18} text={v} color={s.color} />
              </Appear>
            );
          })}
          {s.label && (
            <Appear delay={start + time}>
              <Label x={c.x} y={c.y} text={s.label} color={s.color} />
            </Appear>
          )}
        </>
      );
    }
    case "circle": {
      const c = pt(s.at);
      const r = Math.abs(sx(s.at.x + s.radius) - sx(s.at.x));
      const d = `M${c.x + r},${c.y} A${r},${r} 0 1 1 ${c.x - r},${c.y} A${r},${r} 0 1 1 ${c.x + r},${c.y}`;
      return (
        <>
          <Stroke d={d} color={s.color} delay={start} duration={0.8} />
          {s.label && (
            <Appear delay={start + 0.7}>
              <Label x={c.x} y={c.y - r - 14} text={s.label} color={s.color} />
            </Appear>
          )}
        </>
      );
    }
    case "angle": {
      const o = pt(s.at);
      const a = pt(s.from);
      const b = pt(s.to);
      const a1 = Math.atan2(a.y - o.y, a.x - o.x);
      const a2 = Math.atan2(b.y - o.y, b.x - o.x);
      let sweepAngle = a2 - a1;
      while (sweepAngle <= -Math.PI) sweepAngle += 2 * Math.PI;
      while (sweepAngle > Math.PI) sweepAngle -= 2 * Math.PI;
      const r = 24;
      const right = Math.abs(Math.abs(sweepAngle) - Math.PI / 2) < 0.02;
      const p1 = { x: o.x + r * Math.cos(a1), y: o.y + r * Math.sin(a1) };
      const p2 = { x: o.x + r * Math.cos(a2), y: o.y + r * Math.sin(a2) };
      const d = right
        ? `M${o.x + 15 * Math.cos(a1)},${o.y + 15 * Math.sin(a1)} L${o.x + 15 * Math.cos(a1) + 15 * Math.cos(a2)},${o.y + 15 * Math.sin(a1) + 15 * Math.sin(a2)} L${o.x + 15 * Math.cos(a2)},${o.y + 15 * Math.sin(a2)}`
        : `M${p1.x},${p1.y} A${r},${r} 0 0 ${sweepAngle > 0 ? 1 : 0} ${p2.x},${p2.y}`;
      const mid = a1 + sweepAngle / 2;
      return (
        <>
          <Stroke d={d} color={s.color} delay={start} duration={0.45} width={2.2} />
          {s.label && (
            <Appear delay={start + 0.4}>
              <Label
                x={o.x + 44 * Math.cos(mid)}
                y={o.y + 44 * Math.sin(mid)}
                text={s.label}
                color={s.color}
                size={16}
              />
            </Appear>
          )}
        </>
      );
    }
    case "label": {
      const p = pt(s.at);
      return (
        <Appear delay={start}>
          <Label x={p.x} y={p.y} text={s.text} color={s.color} />
        </Appear>
      );
    }
    case "tangent":
    case "moving_point": {
      const f = fns.get(s.expression) as Fn;
      const live = clock - start - 0.6;
      let xv = s.from + (s.to - s.from) * sweep(live, SWEEP_SECONDS, SWEEPS);
      // After its sweeps a tangent glides to the point it was asked about.
      if (s.type === "tangent" && s.settle !== undefined) {
        const k = Math.min(1, Math.max(0, (live - SWEEP_SECONDS * SWEEPS) / 0.8));
        xv += (s.settle - xv) * k * k * (3 - 2 * k);
      }
      const yv = safe(f, xv);
      if (!Number.isFinite(yv) || clock < start) return null;
      const p = { x: sx(xv), y: sy(yv) };
      if (s.type === "moving_point") {
        return (
          <Appear delay={start} pop>
            <circle cx={p.x} cy={p.y} r={6.5} fill={CHALK[s.color]} />
            <Label
              x={p.x + 12}
              y={p.y - 18}
              text={s.label ?? `(${formatTick(xv)}, ${formatTick(yv)})`}
              color={s.color}
              anchor="start"
              size={15}
            />
          </Appear>
        );
      }
      const h = 1e-4 * Math.max(1, Math.abs(xv));
      const slope = (safe(f, xv + h) - safe(f, xv - h)) / (2 * h);
      const reach = 1.6;
      const a = { x: sx(xv - reach), y: sy(yv - slope * reach) };
      const b = { x: sx(xv + reach), y: sy(yv + slope * reach) };
      return (
        <Appear delay={start}>
          <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={CHALK[s.color]} strokeWidth={2.4} strokeLinecap="round" />
          <circle cx={p.x} cy={p.y} r={6} fill={CHALK[s.color]} />
          <Label
            x={p.x + 12}
            y={p.y + 22}
            text={`slope ${Number(slope.toFixed(2))}`}
            color={s.color}
            anchor="start"
            size={15}
          />
        </Appear>
      );
    }
  }
}

function normal(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // The side that's up on screen, so labels sit above lines.
  const n = { x: dy / len, y: -dx / len };
  return n.y > 0 ? { x: -n.x, y: -n.y } : n;
}

function FunctionLabel({
  f,
  label,
  color,
  start,
  sx,
  sy,
}: {
  f: Fn;
  label: string;
  color: DiagramShape["color"];
  start: number;
  sx: (v: number) => number;
  sy: (v: number) => number;
}) {
  // Walk in from the right edge to the last x where the curve is on the board, and label it there.
  let xv = Number.NaN;
  let yv = Number.NaN;
  for (let k = 0.92; k > 0.3; k -= 0.04) {
    const candidate = invert(sx, k);
    const y = safe(f, candidate);
    if (Number.isFinite(y) && sy(y) > PAD + 10 && sy(y) < 520) {
      xv = candidate;
      yv = y;
      break;
    }
  }
  if (!Number.isFinite(xv)) return null;
  return (
    <Appear delay={start}>
      <Label x={sx(xv)} y={sy(yv) - 18} text={label} color={color} anchor="end" />
    </Appear>
  );
}

/** The x value at fraction k of the way across the plot. */
function invert(sx: (v: number) => number, k: number): number {
  // sx is linear, so two samples are enough to invert it.
  const a = sx(0);
  const b = sx(1);
  const target = PAD + (W - 2 * PAD) * k;
  return (target - a) / (b - a);
}
