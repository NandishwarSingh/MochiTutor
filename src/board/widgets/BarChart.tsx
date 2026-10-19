import { motion } from "motion/react";
import type { BarSpec } from "../store";
import { RichText } from "../Tex";
import { formatTick, linear, niceTicks } from "./chart";
import { Appear, Label, Stroke } from "./ink";

// Bars that grow one after another, a dashed mean line drawn in after them,
// and highlighted bars in pink chalk.

const W = 560;
const H = 300;
const PAD = { l: 44, r: 84, t: 26, b: 44 };

export function BarChart({ spec }: { spec: BarSpec }) {
  const max = Math.max(0, ...spec.bars.map((b) => b.value), spec.mean ?? 0);
  const min = Math.min(0, ...spec.bars.map((b) => b.value));
  const top = max === min ? max + 1 : max + (max - min) * 0.08;
  const sy = linear(min, top, H - PAD.b, PAD.t);
  const band = (W - PAD.l - PAD.r) / Math.max(1, spec.bars.length);
  const barW = Math.min(64, band * 0.62);
  const zero = sy(0);
  const growEnd = 0.3 + spec.bars.length * 0.18 + 0.5;

  return (
    <div className="widget bars">
      {spec.title && (
        <p className="widget-title">
          <RichText text={spec.title} />
        </p>
      )}
      <svg className="chart ink" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img">
        {niceTicks(min, top, 5).map((v) => (
          <g key={v}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} />
            <text className="tick" x={PAD.l - 8} y={sy(v) + 5} textAnchor="end">
              {formatTick(v)}
            </text>
          </g>
        ))}
        <Stroke d={`M${PAD.l},${zero} L${W - PAD.r},${zero}`} color="chalk" width={2} duration={0.4} />
        {spec.bars.map((b, i) => {
          const x = PAD.l + band * i + (band - barW) / 2;
          const y = Math.min(sy(b.value), zero);
          const h = Math.abs(zero - sy(b.value));
          const delay = 0.3 + i * 0.18;
          const color = b.highlight ? "var(--pink)" : "var(--blue)";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: bars are fixed once drawn, and labels can repeat
            <g key={`${b.label}-${i}`}>
              <motion.rect
                x={x}
                y={y}
                width={barW}
                height={h}
                fill={b.highlight ? "rgba(240, 162, 179, 0.28)" : "rgba(157, 205, 224, 0.22)"}
                stroke={color}
                strokeWidth={2.2}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay, duration: 0.5, ease: [0.3, 1.2, 0.5, 1] }}
                style={{ transformOrigin: `${x + barW / 2}px ${zero}px`, transformBox: "view-box" }}
              />
              <Appear delay={delay + 0.4}>
                <text className="bar-value" x={x + barW / 2} y={y - 8} textAnchor="middle" style={{ fill: color }}>
                  {formatTick(b.value)}
                </text>
              </Appear>
              <text className="tick" x={x + barW / 2} y={H - PAD.b + 22} textAnchor="middle">
                {b.label}
              </text>
            </g>
          );
        })}
        {spec.mean !== undefined && (
          <>
            <Stroke
              d={`M${PAD.l},${sy(spec.mean)} L${W - PAD.r},${sy(spec.mean)}`}
              color="yellow"
              width={2.4}
              delay={growEnd}
              duration={0.6}
              dashed
            />
            <Appear delay={growEnd + 0.3}>
              <Label
                x={W - PAD.r + 8}
                y={sy(spec.mean)}
                text={`mean ${formatTick(spec.mean)}`}
                color="yellow"
                anchor="start"
                size={16}
              />
            </Appear>
          </>
        )}
      </svg>
      {spec.yLabel && <p className="widget-caption">{spec.yLabel}</p>}
    </div>
  );
}
