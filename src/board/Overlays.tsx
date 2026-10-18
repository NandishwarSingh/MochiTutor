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
            {state.youSaid}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {state.error ? (
          <motion.div
            key="err"
            className="caption-error"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <span className="dot" />
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
              {state.mochiSays}
            </motion.div>
          )
        )}
      </AnimatePresence>
    </div>
  );
}

export function Intro() {
  return (
    <motion.div
      className="intro"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
    >
      <motion.h1
        initial={{ clipPath: "inset(-10% 100% -10% 0)" }}
        animate={{ clipPath: "inset(-10% 0% -10% 0)" }}
        transition={{ duration: 0.9, ease: [0.3, 0.1, 0.3, 1] }}
      >
        Mochi
      </motion.h1>
      <p>Maths, probability, stats and anything else. Talk in Hindi, Hinglish or English.</p>
      <small>
        Mochi runs on Google's Gemini API. When a lesson starts, your voice goes to Google, and so do camera frames
        while she can see you.
      </small>
    </motion.div>
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
              <li>Point the phone at this screen so all four corner squares are visible.</li>
            </ol>
            {url && <div className="url">{url}</div>}
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
