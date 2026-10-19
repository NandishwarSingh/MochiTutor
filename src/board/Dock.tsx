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
      <rect x="7" y="3" width="10" height="18" rx="1" />
      <path d="M11 18h2" />
    </svg>
  ),
  expand: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  ),
};

interface Props {
  state: LessonState;
  onStart(): void;
  onStop(): void;
  onSeeMe(on: boolean): void;
  onPair(): void;
}

function statusOf(state: LessonState): { label: string; tone: string } {
  switch (state.status) {
    case "connecting":
      return { label: "Waking Mochi up", tone: "busy" };
    case "reconnecting":
      return { label: "Reconnecting", tone: "busy" };
    case "live":
      return state.speaking ? { label: "Mochi is talking", tone: "talking" } : { label: "Listening", tone: "live" };
    case "ended":
      return { label: "Lesson over", tone: "off" };
    case "error":
      return { label: "Stopped", tone: "off" };
    default:
      return { label: "Not started", tone: "off" };
  }
}

/** The bar along the bottom of the board: what's happening, and the few things you can do. */
export function Dock({ state, onStart, onStop, onSeeMe, onPair }: Props) {
  const live = state.status === "live" || state.status === "reconnecting";
  const busy = state.status === "connecting" || state.status === "reconnecting";
  const { label, tone } = statusOf(state);
  const level = state.status === "live" && !state.speaking ? Math.min(1, state.micLevel * 9) : 0;

  return (
    <nav className="bar" aria-label="Lesson controls">
      <div className="status" data-state={tone} aria-live="polite">
        <span>{label}</span>
        <span className="status-level" aria-hidden="true">
          <i style={{ width: `${state.speaking ? 100 : level * 100}%` }} />
        </span>
      </div>
      {live || busy ? (
        <button type="button" className="btn" onClick={onStop} disabled={state.status === "connecting"}>
          End lesson
        </button>
      ) : (
        <button type="button" className="btn btn-primary" onClick={onStart}>
          {state.status === "ended" || state.status === "error" ? "Start again" : "Start lesson"}
        </button>
      )}
      <div className="bar-end">
        <button
          type="button"
          className="btn"
          aria-pressed={state.seeMe}
          title={state.seeMe ? "Mochi can see you. Press to stop." : "Let Mochi see you through the webcam"}
          onClick={() => onSeeMe(!state.seeMe)}
        >
          {Icon.camera}
          <span className="label">{state.seeMe ? "She can see you" : "Camera"}</span>
        </button>
        <button type="button" className="btn" aria-pressed={state.viewers > 0} onClick={onPair}>
          {Icon.phone}
          <span className="label">
            Phone
            {state.viewers > 0 && state.linkMs !== null && <span className="ms"> {state.linkMs} ms</span>}
          </span>
        </button>
        <button
          type="button"
          className="btn"
          aria-label="Full screen"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen();
          }}
        >
          {Icon.expand}
          <span className="label">Full screen</span>
        </button>
      </div>
    </nav>
  );
}
