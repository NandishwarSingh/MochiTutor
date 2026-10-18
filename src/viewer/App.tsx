import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MochiAvatar } from "../avatar/mochi";
import { AvatarStage } from "../avatar/stage";
import { loadMochi } from "../board/MochiPip";
import { smoothVisemes } from "../live/lipsync";
import type { Visemes } from "../shared/protocol";
import { StageSocket } from "../shared/stage-socket";
import { ArStage, type Calibration, DEFAULT_CALIBRATION } from "./ar-stage";
import { BoardTracker } from "./tracker";

type Mode = "intro" | "ar" | "3d";

const CAL_KEY = "mochi-calibration";

function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(CAL_KEY);
    if (raw) return { ...DEFAULT_CALIBRATION, ...(JSON.parse(raw) as Partial<Calibration>) };
  } catch {
    // storage blocked; use defaults
  }
  return DEFAULT_CALIBRATION;
}

function saveCalibration(c: Calibration): void {
  try {
    localStorage.setItem(CAL_KEY, JSON.stringify(c));
  } catch {
    // ignore
  }
}

/** Size the video and the 3D canvas to the same "cover" rectangle so they line up. */
function coverRect(vw: number, vh: number) {
  const s = Math.max(window.innerWidth / vw, window.innerHeight / vh);
  const w = vw * s;
  const h = vh * s;
  return { width: w, height: h, left: (window.innerWidth - w) / 2, top: (window.innerHeight - h) / 2 };
}

export function ViewerApp({ room }: { room: string | null }) {
  const [mode, setMode] = useState<Mode>("intro");
  const [boardOnline, setBoardOnline] = useState(false);
  const [lessonLive, setLessonLive] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarState, setAvatarState] = useState("Loading Mochi");
  const [adjusting, setAdjusting] = useState(false);
  const [cal, setCal] = useState<Calibration>(loadCalibration);
  const [rect, setRect] = useState<ReturnType<typeof coverRect> | null>(null);

  const avatar = useRef<MochiAvatar | null>(null);
  const mouth = useRef<{ target: Visemes; current: Visemes }>({ target: [0, 0, 0, 0, 0], current: [0, 0, 0, 0, 0] });
  const tracker = useRef(new BoardTracker());
  const boardAspect = useRef(0.625);
  const arStage = useRef<ArStage | null>(null);
  const activeStage = useRef<{ setAvatar(a: MochiAvatar): void } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  // Room link to the board.
  useEffect(() => {
    if (!room) return;
    const socket = new StageSocket(room, "viewer", (m) => {
      const a = avatar.current;
      switch (m.t) {
        case "presence":
          setBoardOnline(m.boards > 0);
          break;
        case "layout":
          tracker.current.layout = { w: m.w, h: m.h, markers: m.markers };
          boardAspect.current = m.h / m.w;
          arStage.current?.setBoardAspect(m.h / m.w);
          break;
        case "mouth":
          mouth.current.target = m.v;
          break;
        case "emote":
          a?.emote(m.emotion);
          break;
        case "gesture":
          a?.playGesture(m.gesture);
          break;
        case "look":
          a?.look(m.at);
          break;
        case "status":
          setLessonLive(m.live);
          if (!m.speaking) mouth.current.target = [0, 0, 0, 0, 0];
          break;
        case "ping":
          socket.send({ t: "pong", id: m.id });
          break;
      }
    });
    return () => socket.close();
  }, [room]);

  // Load the avatar once.
  useEffect(() => {
    loadMochi((f) => setAvatarState(`Loading Mochi ${Math.round(f * 100)}%`))
      .then((a) => {
        avatar.current = a;
        setAvatarState("");
        activeStage.current?.setAvatar(a);
      })
      .catch(() => setAvatarState("Couldn't load the avatar. Run bun run setup on the laptop."));
  }, []);

  const calRef = useRef(cal);
  calRef.current = cal;

  const tickMouth = useCallback((dt: number) => {
    const m = mouth.current;
    m.current = smoothVisemes(m.current, m.target, dt);
    avatar.current?.setVisemes(m.current);
  }, []);

  // AR mode: camera, tracking loop and the overlay renderer.
  useEffect(() => {
    if (mode !== "ar" || !video.current || !canvas.current) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    const stage = new ArStage(canvas.current);
    arStage.current = stage;
    activeStage.current = stage;
    stage.setBoardAspect(boardAspect.current);
    stage.setCalibration(calRef.current);
    if (avatar.current) stage.setAvatar(avatar.current);
    stage.onFrame = tickMouth;

    const loop = async () => {
      while (!stopped) {
        const v = video.current;
        if (v && v.readyState >= 2) {
          const r = await tracker.current.track(v);
          if (r && r !== "busy") {
            stage.setIntrinsics(r.width, r.height, r.focal);
            stage.setPose(r.pose);
          }
          setTracking(stage.tracking);
          if (r === "busy") await new Promise((res) => setTimeout(res, 8));
        } else {
          await new Promise((res) => setTimeout(res, 50));
        }
        await new Promise((res) => requestAnimationFrame(res));
      }
    };

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then(async (s) => {
        stream = s;
        const v = video.current;
        if (!v || stopped) return;
        v.srcObject = s;
        await v.play();
        const fit = () => setRect(coverRect(v.videoWidth, v.videoHeight));
        fit();
        window.addEventListener("resize", fit);
        stage.start();
        void loop();
      })
      .catch((e: Error) => {
        setError(
          /NotAllowed|Permission/i.test(e.message) ? "Camera access was blocked. Allow it and reload." : e.message,
        );
        setMode("intro");
      });

    return () => {
      stopped = true;
      for (const t of stream?.getTracks() ?? []) t.stop();
      stage.dispose();
      arStage.current = null;
      activeStage.current = null;
    };
  }, [mode, tickMouth]);

  useEffect(() => {
    arStage.current?.setCalibration(cal);
    saveCalibration(cal);
  }, [cal]);

  // Plain 3D mode for laptops and phones without a usable camera.
  useEffect(() => {
    if (mode !== "3d" || !canvas.current) return;
    const stage = new AvatarStage(canvas.current);
    const holder = { setAvatar: (a: MochiAvatar) => stage.setAvatar(a, 0) };
    activeStage.current = holder;
    stage.onFrame = tickMouth;
    if (avatar.current) holder.setAvatar(avatar.current);
    stage.start();
    return () => {
      stage.dispose();
      activeStage.current = null;
    };
  }, [mode, tickMouth]);

  if (!room) {
    return (
      <div className="viewer intro">
        <h1>Mochi</h1>
        <p>Open this page from the QR code on the board.</p>
      </div>
    );
  }

  let status = "Connecting to the board";
  if (boardOnline && mode === "ar")
    status = tracking ? "Found the board" : "Point at the screen, all four corners in view";
  else if (boardOnline) status = lessonLive ? "Lesson is on" : "Board connected";

  return (
    <div className="viewer" data-mode={mode}>
      {mode === "ar" && (
        <>
          <video ref={video} className="camera" playsInline muted style={rect ?? undefined} />
          <canvas ref={canvas} className="overlay" style={rect ?? undefined} />
        </>
      )}
      {mode === "3d" && <canvas ref={canvas} className="overlay full" />}

      {mode === "intro" ? (
        <motion.div className="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1>Mochi</h1>
          <p>Stand Mochi next to your laptop screen. Her voice comes from the laptop.</p>
          {error && (
            <p className="error">
              <span className="dot" />
              {error}
            </p>
          )}
          <div className="intro-actions">
            <button type="button" className="btn btn-primary" onClick={() => setMode("ar")}>
              Start camera
            </button>
            <button type="button" className="btn" onClick={() => setMode("3d")}>
              3D view instead
            </button>
          </div>
          <p className="hint">{boardOnline ? "Board connected." : "Waiting for the board..."}</p>
        </motion.div>
      ) : (
        <>
          <div className="pill" aria-live="polite">
            <span className="dot" data-on={mode === "ar" ? tracking : boardOnline} />
            {avatarState || status}
          </div>
          <div className="bar">
            {mode === "ar" && (
              <button type="button" className="btn" onClick={() => setAdjusting((a) => !a)}>
                {adjusting ? "Done" : "Adjust"}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setMode(mode === "ar" ? "3d" : "ar")}>
              {mode === "ar" ? "3D view" : "Camera view"}
            </button>
          </div>
        </>
      )}

      <AnimatePresence>
        {adjusting && mode === "ar" && (
          <motion.div
            className="adjust"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
          >
            {(
              [
                ["size", "Size", 0.25, 1.2, 0.01],
                ["gap", "Distance from screen", -0.2, 0.6, 0.01],
                ["drop", "Desk height", -0.1, 0.25, 0.005],
                ["tilt", "Screen tilt", 0, 35, 1],
                ["turn", "Turn", -80, 40, 1],
              ] as Array<[keyof Calibration, string, number, number, number]>
            ).map(([key, label, min, max, step]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={cal[key]}
                  onChange={(e) => setCal({ ...cal, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
            <button type="button" className="btn" onClick={() => setCal(DEFAULT_CALIBRATION)}>
              Reset
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
