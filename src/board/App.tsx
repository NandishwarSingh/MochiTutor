import { AnimatePresence } from "motion/react";
import { useCallback, useState, useSyncExternalStore } from "react";
import type { MarkerLayout } from "../shared/protocol";
import { Board } from "./Board";
import { Dock } from "./Dock";
import type { Lesson } from "./lesson";
import { Markers } from "./Markers";
import { MochiPip } from "./MochiPip";
import { Captions, CaptureOverlay, Intro, PairSheet } from "./Overlays";
import { useBoardItems } from "./store";

export function App({ lesson }: { lesson: Lesson }) {
  const state = useSyncExternalStore(lesson.subscribe, lesson.getState);
  const items = useBoardItems(lesson.board);
  const [pairing, setPairing] = useState(false);
  const phone = state.viewers > 0;
  const onLayout = useCallback(
    (w: number, h: number, markers: MarkerLayout[]) => lesson.setLayout(w, h, markers),
    [lesson],
  );

  return (
    <div className="app" data-phone={phone}>
      <main className="board">
        <Board store={lesson.board} />
        <AnimatePresence>{items.length === 0 && state.status !== "live" && <Intro />}</AnimatePresence>
      </main>
      <MochiPip lesson={lesson} phone={phone} />
      {(phone || pairing) && <Markers onLayout={onLayout} />}
      <Captions state={state} />
      <Dock
        state={state}
        onStart={() => void lesson.start()}
        onStop={() => lesson.stop()}
        onSeeMe={(on) => void lesson.setSeeMe(on)}
        onPair={() => setPairing(true)}
      />
      <AnimatePresence>
        {pairing && <PairSheet key="pair" room={lesson.roomCode} onClose={() => setPairing(false)} />}
        {state.countdown !== null && <CaptureOverlay key="cap" video={lesson.camera.video} count={state.countdown} />}
      </AnimatePresence>
    </div>
  );
}
