import type { NumberLineSpec } from "../store";
import { formatTick, linear } from "./chart";
import { Appear, arrowHead, CHALK, Label, Stroke } from "./ink";

// A number line: ticks, points (filled or open), intervals with open or
// closed ends that may run off to infinity, and jumps that hop along it one
// after another, like -3 + 5.

const W = 560;
const PAD = 28;

export function NumberLine({ spec }: { spec: NumberLineSpec }) {
  const hops = spec.jumps.length;
  const H = 120 + (hops ? 40 : 0) + spec.intervals.length * 16;
  const axisY = H - 46;
  const sx = linear(spec.from, spec.to, PAD + 10, W - PAD - 10);
  const ticks: number[] = [];
  for (let v = spec.from; v <= spec.to + spec.step * 1e-9 && ticks.length < 60; v += spec.step) {
    ticks.push(Number(v.toPrecision(12)));
  }
  const pointsStart = 0.7;
  const intervalStart = pointsStart + spec.points.length * 0.25;
  const jumpStart = intervalStart + spec.intervals.length * 0.6;

  return (
    <div className="widget number-line">
      <svg className="chart ink" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img">
        <Stroke d={`M${PAD},${axisY} L${W - PAD},${axisY}`} color="chalk" width={2} duration={0.5} />
        <Stroke d={arrowHead(W - PAD + 2, axisY, 1, 0, 10)} color="chalk" width={2} delay={0.45} duration={0.15} />
        <Stroke d={arrowHead(PAD - 2, axisY, -1, 0, 10)} color="chalk" width={2} delay={0.45} duration={0.15} />
        <Appear delay={0.4}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="axis" x1={sx(v)} x2={sx(v)} y1={axisY - 7} y2={axisY + 7} style={{ strokeWidth: 1.6 }} />
              <text className="tick" x={sx(v)} y={axisY + 26} textAnchor="middle">
                {formatTick(v)}
              </text>
            </g>
          ))}
        </Appear>
        {spec.intervals.map((iv, i) => {
          const y = axisY - 14 - i * 16;
          const a = iv.from === null ? PAD : sx(iv.from);
          const b = iv.to === null ? W - PAD : sx(iv.to);
          const start = intervalStart + i * 0.6;
          const color = CHALK[iv.color];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: intervals are fixed once drawn
            <g key={i}>
              <Stroke d={`M${a},${y} L${b},${y}`} color={iv.color} width={5} delay={start} duration={0.55} />
              {iv.from === null && (
                <Stroke
                  d={arrowHead(a - 4, y, -1, 0, 12)}
                  color={iv.color}
                  width={3}
                  delay={start + 0.5}
                  duration={0.15}
                />
              )}
              {iv.to === null && (
                <Stroke
                  d={arrowHead(b + 4, y, 1, 0, 12)}
                  color={iv.color}
                  width={3}
                  delay={start + 0.5}
                  duration={0.15}
                />
              )}
              <Appear delay={start + 0.45} pop>
                {iv.from !== null && (
                  <circle
                    cx={a}
                    cy={y}
                    r={6.5}
                    fill={iv.fromOpen ? "var(--board)" : color}
                    stroke={color}
                    strokeWidth={2.5}
                  />
                )}
                {iv.to !== null && (
                  <circle
                    cx={b}
                    cy={y}
                    r={6.5}
                    fill={iv.toOpen ? "var(--board)" : color}
                    stroke={color}
                    strokeWidth={2.5}
                  />
                )}
              </Appear>
              {iv.label && (
                <Appear delay={start + 0.5}>
                  <Label x={(a + b) / 2} y={y - 16} text={iv.label} color={iv.color} size={16} />
                </Appear>
              )}
            </g>
          );
        })}
        {spec.points.map((p, i) => {
          const color = CHALK[p.color];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: points are fixed once drawn
            <Appear key={i} delay={pointsStart + i * 0.25} pop>
              <circle
                cx={sx(p.value)}
                cy={axisY}
                r={7}
                fill={p.open ? "var(--board)" : color}
                stroke={color}
                strokeWidth={2.5}
              />
              {p.label && <Label x={sx(p.value)} y={axisY - 22} text={p.label} color={p.color} size={16} />}
            </Appear>
          );
        })}
        {spec.jumps.map((j, i) => {
          const a = sx(j.from);
          const b = sx(j.to);
          const lift = Math.min(70, 26 + Math.abs(b - a) * 0.18);
          const mid = (a + b) / 2;
          const start = jumpStart + i * 0.9;
          const d = `M${a},${axisY - 8} Q${mid},${axisY - 8 - lift * 2} ${b},${axisY - 8}`;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: jumps are fixed once drawn
            <g key={i}>
              <Stroke d={d} color="yellow" width={2.6} delay={start} duration={0.7} />
              <Stroke
                d={arrowHead(b, axisY - 8, b - mid, lift * 2, 11)}
                color="yellow"
                width={2.6}
                delay={start + 0.65}
                duration={0.15}
              />
              {j.label && (
                <Appear delay={start + 0.5}>
                  <Label x={mid} y={axisY - 14 - lift} text={j.label} color="yellow" size={16} />
                </Appear>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
