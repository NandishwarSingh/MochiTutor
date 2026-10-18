import { motion } from "motion/react";
import type { LessonState } from "./lesson";

const Icon = {
  camera: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
      <circle cx="12" cy="13" r="3.4" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  ),
};

function Meter({ level }: { level: number }) {
  const v = Math.min(1, level * 9);
  const bars = [0.55, 0.85, 1, 0.75, 0.5];
  return (
    <span className="meter" aria-hidden="true">
      {bars.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed bar list
        <i key={i} style={{ height: `${4 + v * b * 14}px` }} />
      ))}
    </span>
  );
}

interface Props {
  state: LessonState;
  onStart(): void;
  onStop(): void;
  onSeeMe(on: boolean): void;
  onPair(): void;
}

export function Dock({ state, onStart, onStop, onSeeMe, onPair }: Props) {
  const live = state.status === "live" || state.status === "reconnecting";
  const busy = state.status === "connecting" || state.status === "reconnecting";
  let label = "Ready when you are";
  let tone = "off";
  if (state.status === "connecting") [label, tone] = ["Waking Mochi up", "busy"];
  else if (state.status === "reconnecting") [label, tone] = ["Reconnecting", "busy"];
  else if (state.status === "live")
    [label, tone] = state.speaking ? ["Mochi is talking", "talking"] : ["Listening", "live"];
  else if (state.status === "ended") label = "Lesson ended";

  return (
    <motion.nav
      className="dock"
      aria-label="Lesson controls"
      initial={{ y: 30, opacity: 0, x: "-50%" }}
      animate={{ y: 0, opacity: 1, x: "-50%" }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      <div className="dock-status" data-state={tone} aria-live="polite">
        <span className="dot" />
        <span>{label}</span>
        {state.status === "live" && !state.speaking && <Meter level={state.micLevel} />}
      </div>
      {live || busy ? (
        <motion.button
          whileTap={{ scale: 0.96 }}
          className="btn"
          onClick={onStop}
          disabled={state.status === "connecting"}
        >
          End lesson
        </motion.button>
      ) : (
        <motion.button whileTap={{ scale: 0.96 }} className="btn btn-primary" onClick={onStart}>
          {state.status === "ended" || state.status === "error" ? "Start again" : "Start lesson"}
        </motion.button>
      )}
      <motion.button
        whileTap={{ scale: 0.92 }}
        className="btn btn-icon"
        aria-pressed={state.seeMe}
        aria-label={state.seeMe ? "Stop letting Mochi see you" : "Let Mochi see you"}
        title={state.seeMe ? "Mochi can see you" : "Let Mochi see you"}
        onClick={() => onSeeMe(!state.seeMe)}
      >
        {Icon.camera}
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.92 }}
        className="btn btn-icon"
        aria-label="Show Mochi on your phone"
        title={
          state.viewers > 0
            ? `Phone connected${state.linkMs !== null ? `, ${state.linkMs} ms` : ""}`
            : "Show Mochi on your phone"
        }
        onClick={onPair}
      >
        {Icon.phone}
        {state.viewers > 0 && <span className="badge" />}
      </motion.button>
      <motion.button
        whileTap={{ scale: 0.92 }}
        className="btn btn-icon"
        aria-label="Full screen"
        title="Full screen"
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen();
        }}
      >
        {Icon.expand}
      </motion.button>
    </motion.nav>
  );
}
