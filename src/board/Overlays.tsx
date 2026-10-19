import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { renderSVG } from "uqr";
import type { LessonState } from "./lesson";

export function Captions({ state }: { state: LessonState }) {
  return (
    <div className="captions">
      <AnimatePresence>
        {state.youSaid && (
          <motion.div
            key="you"
            className="caption-you"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <b>You</b>
            {state.youSaid}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {state.error ? (
          <motion.div
            key="err"
            className="caption-error"
            role="alert"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {state.error}
          </motion.div>
        ) : (
          state.mochiSays && (
            <motion.div
              key="mochi"
              className="caption-mochi"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              transition={{ duration: 0.18 }}
            >
              <span>{state.mochiSays}</span>
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}

const INTRO_LINES = [
  { kind: "title", text: "Mochi" },
  { kind: "text", text: "Your maths teacher. Talk to her in Hindi, Hinglish or English." },
  { kind: "step", text: "Press Start lesson and just start talking." },
  { kind: "step", text: "Ask about maths, probability, stats, anything." },
];

/** What's on the board before class: a few chalk lines, written in one after another. */
export function Intro() {
  return (
    <motion.div className="intro" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      {INTRO_LINES.map((l, i) => (
        <motion.div
          key={l.text}
          className={`line line-${l.kind}`}
          initial={{ clipPath: "inset(-30% 100% -30% -10%)" }}
          animate={{ clipPath: "inset(-30% -10% -30% -10%)" }}
          transition={{ delay: 0.2 + i * 0.75, duration: 0.7, ease: [0.35, 0.1, 0.35, 1] }}
        >
          <span className="line-ink">
            {l.kind === "step" && <span className="step-dot">→</span>}
            <span>{l.text}</span>
          </span>
        </motion.div>
      ))}
    </motion.div>
  );
}

/** Small print under the empty board. */
export function PrivacyNote() {
  return (
    <motion.p className="intro-note" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      Mochi runs on Google's Gemini API. When a lesson starts, your voice goes to Google, and so do camera frames while
      she can see you.
    </motion.p>
  );
}

/** A dev server on this laptop or the LAN, reached by name or IP, with a self-signed certificate. */
function onLocalNetwork(hostname: string): boolean {
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    hostname.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

export function PairSheet({ room, onClose }: { room: string; onClose(): void }) {
  const [url, setUrl] = useState<string | null>(null);
  const lan = onLocalNetwork(location.hostname);
  useEffect(() => {
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    const build = (host: string) => `${location.protocol}//${host}/viewer/?room=${room}`;
    if (!local) {
      setUrl(build(location.host));
      return;
    }
    fetch("/api/network")
      .then((r) => r.json())
      .then((b: { addresses: string[] }) => {
        const ip = b.addresses.find((a) => a.startsWith("192.168.") || a.startsWith("10.")) ?? b.addresses[0];
        setUrl(build(ip ? `${ip}:${location.port}` : location.host));
      })
      .catch(() => setUrl(build(location.host)));
  }, [room]);

  const secure = location.protocol === "https:";
  return (
    <motion.div
      className="scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="sheet"
        role="dialog"
        aria-label="Show Mochi on your phone"
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Mochi on your phone</h2>
        <p>Your phone shows Mochi standing next to this screen. Her voice keeps coming from the laptop.</p>
        <div className="pair-row">
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: QR SVG generated locally */}
          <div className="qr" dangerouslySetInnerHTML={{ __html: url ? renderSVG(url, { border: 1 }) : "" }} />
          <div>
            <ol>
              {lan && <li>Connect the phone to the same Wi-Fi.</li>}
              <li>Scan the code with the phone camera.</li>
              {lan && secure && <li>The certificate is self-signed, so tap through the warning once.</li>}
              <li>
                Pick <b>Board and Mochi on this phone</b> to see the whole board big in AR, or{" "}
                <b>Mochi next to the laptop's board</b> to keep the board here.
              </li>
              <li>Point the phone at this screen and keep the squares in view.</li>
            </ol>
            {url && <div className="url">{url}</div>}
            <p className="room-code">
              Code <b>{room}</b>
            </p>
          </div>
        </div>
        {!secure && (
          <p>
            This page is on plain http, and phone browsers only open the camera on https. Run <code>bun run setup</code>{" "}
            and restart <code>bun run dev</code>.
          </p>
        )}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function CaptureOverlay({ video, count }: { video: HTMLVideoElement; count: number }) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    holder.current?.prepend(video);
  }, [video]);
  return (
    <motion.div className="capture" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="capture-frame" ref={holder}>
        <div className="capture-hint">Hold your notebook up to the camera</div>
        <AnimatePresence mode="popLayout">
          {count > 0 && (
            <motion.div
              key={count}
              className="capture-count"
              initial={{ scale: 1.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {count}
            </motion.div>
          )}
        </AnimatePresence>
        {count === 0 && (
          <motion.div
            className="flash"
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          />
        )}
      </div>
    </motion.div>
  );
}
