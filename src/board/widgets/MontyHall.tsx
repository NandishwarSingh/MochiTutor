import { motion } from "motion/react";
import type { Door, MontyGame, MontySimulation } from "../../lib/simulations";

function Goat() {
  return (
    <g fill="none" stroke="var(--chalk)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
      <path d="M38 70 q22 -10 44 0 l-4 26 q-18 6 -36 0 z" />
      <path d="M44 66 q-10 -14 -2 -22 M76 66 q10 -14 2 -22" />
      <path d="M48 104 v14 M72 104 v14" />
      <circle cx="52" cy="80" r="1.6" fill="var(--chalk)" />
      <circle cx="68" cy="80" r="1.6" fill="var(--chalk)" />
      <path d="M56 92 q4 3 8 0" />
    </g>
  );
}

function Car() {
  return (
    <g fill="none" stroke="var(--yellow)" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 96 v-12 q0 -6 6 -7 l10 -2 l10 -14 q3 -4 8 -4 h22 q5 0 8 4 l10 14 l8 2 q6 1 6 7 v12 z" />
      <path d="M46 75 l7 -10 h14 l7 10 z" />
      <circle cx="40" cy="98" r="8" />
      <circle cx="82" cy="98" r="8" />
    </g>
  );
}

function doorLabel(n: Door, game: MontyGame): string {
  if (game.phase === "done") {
    if (n === game.final) return `door ${n}, final pick`;
    if (n === game.picked) return `door ${n}, first pick`;
    return `door ${n}`;
  }
  return game.phase === "decide" && n === game.picked ? `door ${n}, your pick` : `door ${n}`;
}

function DoorView({ n, game }: { n: Door; game: MontyGame }) {
  const picked = game.phase !== "choose" && (game.phase === "done" ? game.final === n : game.picked === n);
  const open = (game.phase !== "choose" && game.opened === n) || game.phase === "done";
  const prize = n === game.car ? <Car /> : <Goat />;
  return (
    <div className="door" data-picked={picked}>
      <svg viewBox="0 0 120 150" width={120} height={150}>
        <rect
          x={4}
          y={4}
          width={112}
          height={142}
          rx={4}
          fill="none"
          stroke={picked ? "var(--yellow)" : "var(--chalk-soft)"}
          strokeWidth={picked ? 3.2 : 2.4}
        />
        {open ? (
          <motion.g
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ originX: "60px", originY: "90px" }}
          >
            {prize}
          </motion.g>
        ) : (
          <>
            <text x={60} y={88} textAnchor="middle" fontFamily="var(--hand)" fontSize={46} fill="var(--chalk)">
              {n}
            </text>
            <circle cx={96} cy={84} r={4} fill="var(--chalk-soft)" />
          </>
        )}
      </svg>
      <div className="door-label">{doorLabel(n, game)}</div>
    </div>
  );
}

function SimBars({ sim }: { sim: MontySimulation }) {
  const rows = [
    { label: "Switch", wins: sim.switchWins, color: "var(--yellow)", target: 2 / 3 },
    { label: "Stay", wins: sim.stayWins, color: "var(--blue)", target: 1 / 3 },
  ];
  return (
    <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
      {rows.map((r) => (
        <div className="sim-row" key={r.label}>
          <span>{r.label}</span>
          <div className="sim-track">
            <motion.div
              className="sim-bar"
              style={{ background: r.color }}
              initial={{ width: "0%" }}
              animate={{ width: `${(r.wins / sim.games) * 100}%` }}
              transition={{ duration: 1.6, ease: "easeOut" }}
            />
            <div
              style={{
                position: "absolute",
                left: `${r.target * 100}%`,
                top: -6,
                bottom: -6,
                borderLeft: "2px dashed var(--chalk-soft)",
              }}
            />
          </div>
          <span>
            {r.wins.toLocaleString("en-IN")} wins ({((r.wins / sim.games) * 100).toFixed(1)}%)
          </span>
        </div>
      ))}
      <p className="widget-caption">{sim.games.toLocaleString("en-IN")} games played with each strategy.</p>
    </div>
  );
}

export function MontyHall({ game, sim }: { game: MontyGame | null; sim: MontySimulation | null }) {
  let caption = "Pick a door. One has a car, two have goats.";
  if (game?.phase === "decide") caption = `The host opened door ${game.opened}: a goat. Stay or switch?`;
  if (game?.phase === "done") {
    caption = `${game.switched ? "Switched" : "Stayed"} and ${game.won ? "won the car" : "got a goat"}.`;
  }
  return (
    <div className="widget">
      {game && (
        <>
          <div className="doors">
            {([1, 2, 3] as Door[]).map((n) => (
              <DoorView key={n} n={n} game={game} />
            ))}
          </div>
          <p className="widget-caption">{caption}</p>
        </>
      )}
      {sim && <SimBars sim={sim} />}
    </div>
  );
}
