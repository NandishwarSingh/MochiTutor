import { motion } from "motion/react";
import type { CoinRun } from "../../lib/simulations";
import { formatTick, linear, niceTicks } from "./chart";

const W = 600;
const H = 220;
const PAD = { l: 48, r: 16, t: 12, b: 34 };

export function CoinFlips({ run }: { run: CoinRun }) {
  const x = linear(0, run.flips, PAD.l, W - PAD.r);
  const y = linear(0, 1, H - PAD.b, PAD.t);
  const path = run.running.map(([n, s], i) => `${i ? "L" : "M"}${x(n).toFixed(1)},${y(s).toFixed(1)}`).join("");
  const share = run.heads / run.flips;
  return (
    <div className="widget">
      <div className="coins">
        {run.firstResults.map((heads, i) => (
          <motion.div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed list for one run
            key={i}
            className="coin"
            data-tails={!heads}
            initial={{ rotateY: 0, opacity: 0, y: -8 }}
            animate={{ rotateY: 720, opacity: 1, y: 0 }}
            transition={{ delay: i * 0.09, duration: 0.55, ease: "easeOut" }}
          >
            {heads ? "H" : "T"}
          </motion.div>
        ))}
      </div>
      {run.flips > 1 && (
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }}>
          {[0, 0.25, 0.5, 0.75, 1].map((v) => (
            <g key={v}>
              <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
              <text x={PAD.l - 10} y={y(v) + 5} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {niceTicks(0, run.flips, 5).map((v) => (
            <text key={v} x={x(v)} y={H - 10} textAnchor="middle">
              {formatTick(v)}
            </text>
          ))}
          <line className="axis" x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} />
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(run.p)}
            y2={y(run.p)}
            stroke="var(--blue)"
            strokeWidth={2}
            strokeDasharray="6 7"
          />
          <motion.path
            d={path}
            fill="none"
            stroke="var(--yellow)"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: 0.6, duration: 1.8, ease: "easeInOut" }}
          />
        </svg>
      )}
      <p className="widget-caption">
        {run.flips.toLocaleString("en-IN")} flips: heads {run.heads.toLocaleString("en-IN")}, tails{" "}
        {run.tails.toLocaleString("en-IN")}. Share of heads <strong>{share.toFixed(3)}</strong>, true chance {run.p}.
      </p>
    </div>
  );
}
