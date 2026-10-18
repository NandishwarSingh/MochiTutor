import { useEffect, useRef, useState } from "react";
import { MochiAvatar } from "../avatar/mochi";
import { AvatarStage } from "../avatar/stage";
import type { Lesson } from "./lesson";

export const AVATAR_URL = "/avatars/mochi.vrm";
export const SAMPLE_AVATAR_URL = "/avatars/sample.vrm";

/** Load the student's own avatar if there is one, else the sample model. */
export async function loadMochi(onProgress?: (f: number) => void): Promise<MochiAvatar> {
  const own = await fetch(AVATAR_URL, { method: "HEAD" }).catch(() => null);
  const isVrm = own?.ok && !own.headers.get("content-type")?.includes("text/html");
  return MochiAvatar.load(isVrm ? AVATAR_URL : SAMPLE_AVATAR_URL, onProgress);
}

/** Mochi standing in the right-hand column of the board. */
export function MochiPip({ lesson, phone }: { lesson: Lesson; phone: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [note, setNote] = useState<string | null>("Loading Mochi");

  useEffect(() => {
    if (!canvas.current) return;
    const stage = new AvatarStage(canvas.current);
    stage.onFrame = (dt) => lesson.tick(dt);
    stage.start();
    let cancelled = false;
    loadMochi((f) => setNote(`Loading Mochi ${Math.round(f * 100)}%`))
      .then((avatar) => {
        if (cancelled) return;
        stage.setAvatar(avatar);
        lesson.attachAvatar(avatar);
        setNote(null);
        avatar.playGesture("wave");
        avatar.emote("happy");
      })
      .catch(() => setNote("No avatar found. Run bun run setup to download the sample model."));
    return () => {
      cancelled = true;
      stage.dispose();
    };
  }, [lesson]);

  return (
    <aside className="pip" aria-label="Mochi">
      <canvas ref={canvas} />
      {note && !phone && <div className="pip-note">{note}</div>}
    </aside>
  );
}
