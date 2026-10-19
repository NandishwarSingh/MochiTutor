import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MochiAvatar } from "../avatar/mochi";
import { AvatarStage, isPhone } from "../avatar/stage";
import { loadMochi } from "../board/MochiPip";
import { type BoardItem, BoardStore } from "../board/store";
import { smoothVisemes } from "../live/lipsync";
import { ROOM_CODE, type Visemes } from "../shared/protocol";
import { StageSocket } from "../shared/stage-socket";
import { ArStage, type Calibration, DEFAULT_CALIBRATION, DEFAULT_PANEL_CALIBRATION, type Stereo } from "./ar-stage";
import { BoardLayer, itemSpot } from "./BoardLayer";
import { DeviceRotation } from "./motion";
import { BoardTracker } from "./tracker";
import { VrView } from "./VrView";

/**
 * ar: Mochi beside the laptop's own board. board: the phone draws the board too,
 * the laptop shows markers. vr: the same as board, side by side for a headset.
 */
type Mode = "intro" | "vr-setup" | "ar" | "board" | "vr" | "3d";
type CameraMode = "ar" | "board";

const VR_KEY = "mochi-headset";
const VR_DEFAULTS: Stereo = { ipd: 0.063, zoom: 1, screenWidth: 0.31 };

function loadHeadset(): Stereo {
  try {
    const raw = localStorage.getItem(VR_KEY);
    if (raw) return { ...VR_DEFAULTS, ...(JSON.parse(raw) as Partial<Stereo>) };
  } catch {
    // storage blocked
  }
  return VR_DEFAULTS;
}

/** Keep the screen awake while the phone is in a headset or held up to the laptop. */
async function keepAwake(): Promise<(() => void) | null> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> };
    };
    const lock = await nav.wakeLock?.request("screen");
    return lock ? () => void lock.release() : null;
  } catch {
    return null;
  }
}

/** Full screen and landscape where the browser allows it (Android); iPhones need the page added to the home screen. */
async function goFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await o?.lock?.("landscape");
  } catch {
    // not supported here
  }
}

const CAL_KEYS: Record<CameraMode, string> = { ar: "mochi-calibration", board: "mochi-calibration-board" };
const CAL_DEFAULTS: Record<CameraMode, Calibration> = { ar: DEFAULT_CALIBRATION, board: DEFAULT_PANEL_CALIBRATION };

function loadCalibration(mode: CameraMode): Calibration {
  try {
    const raw = localStorage.getItem(CAL_KEYS[mode]);
    if (raw) return { ...CAL_DEFAULTS[mode], ...(JSON.parse(raw) as Partial<Calibration>) };
  } catch {
    // storage blocked; use defaults
  }
  return CAL_DEFAULTS[mode];
}

function saveCalibration(mode: CameraMode, c: Calibration): void {
  try {
    localStorage.setItem(CAL_KEYS[mode], JSON.stringify(c));
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

const KNOWN_KINDS = new Set([
  "line",
  "plot",
  "coins",
  "monty",
  "distribution",
  "calc",
  "notebook",
  "diagram",
  "tree",
  "numberline",
  "venn",
  "bars",
  "image",
]);

/** Board items from the laptop, with anything that could load from elsewhere dropped and photos filled in. */
function acceptItems(items: BoardItem[], photos: Map<number, string>): BoardItem[] {
  return items.flatMap((it): BoardItem[] => {
    if (!it || typeof it !== "object" || !KNOWN_KINDS.has(it.kind) || typeof it.id !== "number") return [];
    if (it.kind === "image") return typeof it.src === "string" && it.src.startsWith("/api/images/") ? [it] : [];
    if (it.kind === "notebook") return [{ ...it, image: photos.get(it.id) ?? "" }];
    return [it];
  });
}

const ADJUST: Record<CameraMode, Array<[keyof Calibration, string, number, number, number]>> = {
  ar: [
    ["size", "Size", 0.25, 1.2, 0.01],
    ["gap", "Distance from screen", -0.2, 0.6, 0.01],
    ["drop", "Desk height", -0.1, 0.25, 0.005],
    ["tilt", "Screen tilt", 0, 35, 1],
    ["turn", "Turn", -80, 40, 1],
  ],
  board: [
    ["panel", "Board size", 1.2, 3.5, 0.05],
    ["lift", "Board height", -0.3, 0.9, 0.01],
    ["size", "Mochi size", 0.4, 1.6, 0.01],
    ["gap", "Mochi distance", -0.4, 0.8, 0.01],
    ["drop", "Desk height", -0.1, 0.25, 0.005],
    ["tilt", "Screen tilt", 0, 35, 1],
    ["turn", "Turn", -80, 40, 1],
  ],
};

export function ViewerApp({ room }: { room: string | null }) {
  const [mode, setMode] = useState<Mode>("intro");
  const [boardOnline, setBoardOnline] = useState(false);
  const [socketOpen, setSocketOpen] = useState(false);
  const [lessonLive, setLessonLive] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarState, setAvatarState] = useState("Loading Mochi");
  const [adjusting, setAdjusting] = useState(false);
  const [cals, setCals] = useState<Record<CameraMode, Calibration>>(() => ({
    ar: loadCalibration("ar"),
    board: loadCalibration("board"),
  }));
  const [rect, setRect] = useState<ReturnType<typeof coverRect> | null>(null);
  const [captions, setCaptions] = useState({ mochi: "", you: "" });
  const [laptopShowsMarkers, setLaptopShowsMarkers] = useState(false);
  const [stage, setStage] = useState<ArStage | null>(null);
  const [headset, setHeadset] = useState<Stereo>(loadHeadset);
  const [vrMenu, setVrMenu] = useState(false);
  const [portrait, setPortrait] = useState(() => window.innerHeight > window.innerWidth);

  const avatar = useRef<MochiAvatar | null>(null);
  const mouth = useRef<{ target: Visemes; current: Visemes }>({ target: [0, 0, 0, 0, 0], current: [0, 0, 0, 0, 0] });
  const tracker = useRef(new BoardTracker());
  const boardAspect = useRef(0.625);
  const arStage = useRef<ArStage | null>(null);
  const activeStage = useRef<{ setAvatar(a: MochiAvatar): void } | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const video2 = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const socket = useRef<StageSocket | null>(null);
  const board = useRef(new BoardStore());
  const photos = useRef(new Map<number, string>());
  const lastItems = useRef<{ items: BoardItem[]; focus: number | null }>({ items: [], focus: null });
  const motionRef = useRef(new DeviceRotation());
  const laptopShowsMarkersRef = useRef(false);
  laptopShowsMarkersRef.current = laptopShowsMarkers;
  const cameraMode: CameraMode = mode === "board" || mode === "vr" ? "board" : "ar";
  const camera = mode === "ar" || mode === "board" || mode === "vr";
  const headsetRef = useRef(headset);
  headsetRef.current = headset;
  const cal = cals[cameraMode];

  // Room link to the board.
  useEffect(() => {
    if (!room) return;
    const s = new StageSocket(
      room,
      "viewer",
      (m) => {
        const a = avatar.current;
        switch (m.t) {
          case "presence":
            setBoardOnline(m.boards > 0);
            break;
          case "layout":
            tracker.current.layout = { w: m.w, h: m.h, markers: m.markers };
            boardAspect.current = m.h / m.w;
            arStage.current?.setBoardAspect(m.h / m.w);
            setLaptopShowsMarkers(m.full === true);
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
          case "point":
            // In AR beside the laptop she points at the real spot on its board; elsewhere she just glances.
            if (arStage.current && !laptopShowsMarkersRef.current) arStage.current.pointAtBoard(m.x, m.y);
            else a?.look("board", 1.2);
            break;
          case "point-item": {
            const root = document.querySelector<HTMLElement>(".ar-board");
            const spot = root && itemSpot(root, m.id);
            if (spot && arStage.current) arStage.current.pointAtPanel(spot.x, spot.y);
            break;
          }
          case "listen":
            a?.setAttentive(m.on);
            break;
          case "board":
            lastItems.current = { items: m.items, focus: m.focus };
            board.current.replace(acceptItems(m.items, photos.current), m.focus);
            break;
          case "photo":
            photos.current.set(m.id, m.data);
            board.current.replace(acceptItems(lastItems.current.items, photos.current), lastItems.current.focus);
            break;
          case "caption":
            setCaptions({ mochi: m.mochi, you: m.you });
            break;
          case "status":
            setLessonLive(m.live);
            if (!m.speaking) mouth.current.target = [0, 0, 0, 0, 0];
            break;
          case "ping":
            s.send({ t: "pong", id: m.id });
            break;
        }
      },
      setSocketOpen,
    );
    socket.current = s;
    return () => {
      s.close();
      socket.current = null;
    };
  }, [room]);

  // Ask the laptop to hand over the board while this phone is drawing it, again after any reconnect.
  useEffect(() => {
    if (socketOpen) socket.current?.send({ t: "board-mode", on: mode === "board" || mode === "vr" });
  }, [mode, socketOpen]);

  // Show what went wrong instead of a page that silently stops.
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Chrome reports harmless ResizeObserver loop notices as errors.
      if (!/ResizeObserver/.test(e.message)) setError(e.message || "Something went wrong.");
    };
    const onRejection = (e: PromiseRejectionEvent) =>
      setError(e.reason instanceof Error ? e.reason.message : String(e.reason));
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // Load the avatar once. Phones get 1024 px textures so the model fits in their graphics memory.
  useEffect(() => {
    loadMochi((f) => setAvatarState(`Loading Mochi ${Math.round(f * 100)}%`), isPhone() ? 1024 : undefined)
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

  // Camera modes: the camera, the tracking loop and the overlay renderer.
  useEffect(() => {
    if ((mode !== "ar" && mode !== "board" && mode !== "vr") || !video.current || !canvas.current) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let release: (() => void) | null = null;
    void keepAwake().then((r) => {
      if (stopped) r?.();
      else release = r;
    });
    const stage = new ArStage(canvas.current);
    arStage.current = stage;
    activeStage.current = stage;
    setStage(stage);
    stage.setBoardAspect(boardAspect.current);
    stage.setCalibration(calRef.current);
    stage.setPanelMode(mode === "board" || mode === "vr");
    stage.setStereo(mode === "vr" ? headsetRef.current : null);
    stage.setMotion(motionRef.current);
    if (avatar.current) stage.setAvatar(avatar.current);
    stage.onFrame = tickMouth;
    stage.onContextLost = () => {
      setError("Your phone ran out of graphics memory. Close other tabs and try again, or use the 3D view.");
      setMode("intro");
    };

    const loop = async () => {
      while (!stopped) {
        const v = video.current;
        if (v && v.readyState >= 2) {
          const grabbed = performance.now();
          const r = await tracker.current.track(v);
          if (r && r !== "busy") {
            stage.setIntrinsics(r.width, r.height, r.focal);
            stage.setPose(r.pose, grabbed);
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
        // Tracking runs at 1280 px anyway, and a 1080p stream costs phones memory for nothing.
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      .then(async (s) => {
        stream = s;
        const v = video.current;
        if (!v || stopped) return;
        v.srcObject = s;
        await v.play();
        // In a headset the right eye shows the same picture.
        if (video2.current) {
          video2.current.srcObject = s;
          void video2.current.play().catch(() => {});
        }
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
      release?.();
      for (const t of stream?.getTracks() ?? []) t.stop();
      stage.dispose();
      arStage.current = null;
      activeStage.current = null;
      setStage(null);
    };
  }, [mode, tickMouth]);

  useEffect(() => {
    arStage.current?.setStereo(mode === "vr" ? headset : null);
    try {
      localStorage.setItem(VR_KEY, JSON.stringify(headset));
    } catch {
      // ignore
    }
  }, [headset, mode]);

  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  useEffect(() => {
    arStage.current?.setCalibration(cal);
    saveCalibration(cameraMode, cal);
  }, [cal, cameraMode]);

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

  /** Start a camera mode from a tap: iOS only grants motion access from one. */
  const startCamera = async (next: CameraMode | "vr") => {
    setError(null);
    if (next === "vr") void goFullscreen();
    if (await DeviceRotation.request()) motionRef.current.start();
    setMode(next);
  };

  useEffect(() => {
    if (!camera) motionRef.current.stop();
    if (mode !== "vr" && document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, [mode, camera]);

  if (!room) {
    return (
      <div className="viewer">
        <div className="intro">
          <h1>Mochi</h1>
          <p>Scan the QR code on the board, or type the code shown under it.</p>
          <RoomEntry />
        </div>
      </div>
    );
  }

  let status = "Connecting to the board";
  if (boardOnline && mode === "board") {
    if (!laptopShowsMarkers) status = "Waiting for the laptop to switch to markers";
    else status = tracking ? (lessonLive ? "Lesson is on" : "Found the screen") : "Point at the laptop screen";
  } else if (boardOnline && mode === "ar") {
    status = tracking ? "Found the board" : "Point at the screen, all four corners in view";
  } else if (boardOnline) status = lessonLive ? "Lesson is on" : "Board connected";

  const view = rect ?? { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };

  if (mode === "vr") {
    return (
      <div className="viewer" data-mode="vr">
        <VrView stage={stage} store={board.current} caption={captions.mochi} videos={[video, video2]} />
        <canvas ref={canvas} className="overlay full" />
        <button type="button" className="vr-tap" aria-label="Show the headset menu" onClick={() => setVrMenu(true)} />
        {portrait && <div className="vr-turn">Turn your phone sideways for the headset.</div>}
        {vrMenu && (
          <div className="vr-menu">
            <p>{error || avatarState || status}</p>
            <HeadsetSliders headset={headset} onChange={setHeadset} />
            <div className="vr-menu-actions">
              <button type="button" className="btn" onClick={() => setVrMenu(false)}>
                Back to the headset
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setVrMenu(false);
                  setMode("board");
                }}
              >
                Leave VR
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="viewer" data-mode={mode}>
      {(mode === "ar" || mode === "board") && (
        <>
          <video ref={video} className="camera" playsInline muted style={rect ?? undefined} />
          {mode === "board" && <BoardLayer store={board.current} stage={stage} view={view} />}
          <canvas ref={canvas} className="overlay" style={rect ?? undefined} />
        </>
      )}
      {mode === "3d" && <canvas ref={canvas} className="overlay full" />}

      {mode === "vr-setup" ? (
        <motion.div className="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1>Headset</h1>
          <p>For a Cardboard-style headset with a hole for the camera. Her voice stays on the laptop.</p>
          <ol className="steps">
            <li>Put the laptop in reach and start the lesson there.</li>
            <li>On an iPhone, add this page to your home screen first, so it can fill the whole screen.</li>
            <li>Press Start, turn the phone sideways and slide it into the headset.</li>
            <li>Look at the laptop. Tap the screen any time to get this menu back.</li>
          </ol>
          <HeadsetSliders headset={headset} onChange={setHeadset} />
          <div className="intro-actions">
            <button type="button" className="btn btn-primary" onClick={() => void startCamera("vr")}>
              Start
            </button>
            <button type="button" className="btn" onClick={() => setMode("intro")}>
              Back
            </button>
          </div>
        </motion.div>
      ) : mode === "intro" ? (
        <motion.div className="intro" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <h1>Mochi</h1>
          <p>Point this phone at your laptop. Her voice stays on the laptop.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="intro-actions">
            <button type="button" className="btn btn-primary" onClick={() => void startCamera("board")}>
              Board and Mochi on this phone
            </button>
            <button type="button" className="btn" onClick={() => void startCamera("ar")}>
              Mochi next to the laptop's board
            </button>
            <button type="button" className="btn" onClick={() => setMode("vr-setup")}>
              In a VR headset
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setError(null);
                setMode("3d");
              }}
            >
              3D view instead
            </button>
          </div>
          <p className="hint">
            {boardOnline ? "Connected to the board." : "Waiting for the board to open on the laptop."}
          </p>
          {!boardOnline && <RoomEntry label="Different code?" />}
        </motion.div>
      ) : (
        <>
          <div className="status-chip" aria-live="polite" data-ok={!error && (mode === "3d" ? boardOnline : tracking)}>
            {error || avatarState || status}
          </div>
          {(captions.mochi || captions.you) && mode !== "3d" && (
            <div className="captions-hud" aria-live="polite">
              {captions.you && <div className="you">You: {captions.you}</div>}
              {captions.mochi && (
                <div className="mochi">
                  <span>{captions.mochi}</span>
                </div>
              )}
            </div>
          )}
          <div className="bar">
            {mode !== "3d" && (
              <button type="button" className="btn" onClick={() => setAdjusting((a) => !a)}>
                {adjusting ? "Done" : "Adjust"}
              </button>
            )}
            {mode !== "3d" && (
              <button type="button" className="btn" onClick={() => setMode(mode === "board" ? "ar" : "board")}>
                {mode === "board" ? "Mochi only" : "Board here too"}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setMode(mode === "3d" ? "intro" : "3d")}>
              {mode === "3d" ? "Back" : "3D view"}
            </button>
          </div>
        </>
      )}

      <AnimatePresence>
        {adjusting && (mode === "ar" || mode === "board") && (
          <motion.div
            className="adjust"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
          >
            {ADJUST[cameraMode].map(([key, label, min, max, step]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={cal[key]}
                  onChange={(e) => setCals((c) => ({ ...c, [cameraMode]: { ...cal, [key]: Number(e.target.value) } }))}
                />
              </label>
            ))}
            <button
              type="button"
              className="btn"
              onClick={() => setCals((c) => ({ ...c, [cameraMode]: CAL_DEFAULTS[cameraMode] }))}
            >
              Reset
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Join a board by its code. A viewer opened from the home screen has no code in
 * its address, and each laptop tab makes a new one, so it can be typed in.
 */
function RoomEntry({ label = "Join" }: { label?: string }) {
  const [code, setCode] = useState("");
  const valid = ROOM_CODE.test(code);
  return (
    <form
      className="room-entry"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) location.search = `?room=${code}`;
      }}
    >
      <input
        aria-label="Board code"
        placeholder="Board code"
        value={code}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setCode(e.target.value.trim().toLowerCase())}
      />
      <button type="submit" className="btn" disabled={!valid}>
        {label}
      </button>
    </form>
  );
}

/** Eye spacing and picture size for the headset. */
function HeadsetSliders({ headset, onChange }: { headset: Stereo; onChange: (h: Stereo) => void }) {
  return (
    <div className="adjust adjust-inline">
      <label>
        <span>Eye spacing</span>
        <input
          type="range"
          min={0.05}
          max={0.075}
          step={0.001}
          value={headset.ipd}
          onChange={(e) => onChange({ ...headset, ipd: Number(e.target.value) })}
        />
      </label>
      <label>
        <span>Picture size</span>
        <input
          type="range"
          min={0.7}
          max={1.4}
          step={0.01}
          value={headset.zoom}
          onChange={(e) => onChange({ ...headset, zoom: Number(e.target.value) })}
        />
      </label>
      <label>
        <span>Laptop screen width</span>
        <input
          type="range"
          min={0.25}
          max={0.42}
          step={0.005}
          value={headset.screenWidth}
          onChange={(e) => onChange({ ...headset, screenWidth: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}
