import { motion } from "motion/react";
import { useMemo } from "react";
import {
  type DistributionFamily,
  type DistributionParams,
  makeDistribution,
  probabilityBetween,
} from "../../lib/stats";
import { formatProb, formatTick, linear, niceTicks } from "./chart";

const W = 620;
const H = 260;
const PAD = { l: 56, r: 16, t: 14, b: 36 };

interface Props {
  family: DistributionFamily;
  params: DistributionParams;
  from?: number;
  to?: number;
}

export function Distribution({ family, params, from, to }: Props) {
  const view = useMemo(() => {
    const dist = makeDistribution(family, params);
    const [lo, hi] = dist.range;
    const inShade = (v: number) => (from === undefined || v >= from) && (to === undefined || v <= to);
    const shaded = from !== undefined || to !== undefined;
    if (dist.discrete) {
      const ks: number[] = [];
      const step = Math.max(1, Math.ceil((hi - lo + 1) / 60));
      for (let k = Math.ceil(lo); k <= hi; k += step) ks.push(k);
      const ys = ks.map((k) => dist.density(k));
      return { dist, shaded, inShade, ks, ys, maxY: Math.max(...ys), lo: lo - 0.5, hi: hi + 0.5 };
    }
    const xs = Array.from({ length: 241 }, (_, i) => lo + ((hi - lo) * i) / 240);
    const ys = xs.map((v) => dist.density(v));
    return { dist, shaded, inShade, xs, ys, maxY: Math.max(...ys), lo, hi };
  }, [family, params, from, to]);

  const x = linear(view.lo, view.hi, PAD.l, W - PAD.r);
  const y = linear(0, view.maxY * 1.1, H - PAD.b, PAD.t);
  const prob = view.shaded ? probabilityBetween(view.dist, from, to) : null;

  let body: React.ReactNode;
  if ("ks" in view && view.ks) {
    const bw = Math.max(2, ((W - PAD.l - PAD.r) / (view.hi - view.lo)) * 0.72);
    body = view.ks.map((k, i) => (
      <motion.rect
        key={k}
        x={x(k) - bw / 2}
        width={bw}
        rx={1.5}
        fill={view.inShade(k) && view.shaded ? "var(--yellow)" : "rgba(236,231,218,0.5)"}
        initial={{ y: H - PAD.b, height: 0 }}
        animate={{ y: y(view.ys[i]), height: H - PAD.b - y(view.ys[i]) }}
        transition={{ delay: i * 0.012, duration: 0.45, ease: "easeOut" }}
      />
    ));
  } else if (view.xs) {
    const pts = view.xs.map((v, i) => `${x(v).toFixed(1)},${y(view.ys[i]).toFixed(1)}`);
    const curve = `M${pts.join("L")}`;
    const shadeXs = view.xs.filter((v) => view.inShade(v));
    const shadePath =
      view.shaded && shadeXs.length > 1
        ? `M${x(shadeXs[0])},${y(0)}L${shadeXs.map((v) => `${x(v).toFixed(1)},${y(view.dist.density(v)).toFixed(1)}`).join("L")}L${x(shadeXs[shadeXs.length - 1])},${y(0)}Z`
        : null;
    body = (
      <>
        {shadePath && (
          <motion.path
            d={shadePath}
            fill="rgba(242,207,106,0.4)"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 }}
          />
        )}
        <motion.path
          d={curve}
          fill="none"
          stroke="var(--chalk)"
          strokeWidth={2.6}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeInOut" }}
        />
      </>
    );
  }

  return (
    <div className="widget">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
        {niceTicks(0, view.maxY * 1.1, 4).map((v) => (
          <g key={v}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text x={PAD.l - 10} y={y(v) + 5} textAnchor="end">
              {formatTick(v)}
            </text>
          </g>
        ))}
        {niceTicks(view.lo, view.hi, 8).map((v) => (
          <text key={v} x={x(v)} y={H - 12} textAnchor="middle">
            {formatTick(v)}
          </text>
        ))}
        <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
        {body}
        <line
          x1={x(view.dist.mean)}
          x2={x(view.dist.mean)}
          y1={PAD.t}
          y2={H - PAD.b}
          stroke="var(--blue)"
          strokeWidth={1.6}
          strokeDasharray="4 6"
        />
      </svg>
      <p className="widget-caption">
        {view.dist.label}, mean {formatTick(view.dist.mean)}
        {prob !== null && (
          <>
            {" "}
            · P({from ?? "−∞"} ≤ X ≤ {to ?? "∞"}) = <strong>{formatProb(prob)}</strong>
          </>
        )}
      </p>
    </div>
  );
}
