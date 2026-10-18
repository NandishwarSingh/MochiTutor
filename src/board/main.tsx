import "katex/dist/katex.min.css";
import "./board.css";
import { createRoot } from "react-dom/client";
import { newRoomCode } from "../shared/stage-socket";
import { App } from "./App";
import { Lesson } from "./lesson";

function roomCode(): string {
  try {
    const saved = sessionStorage.getItem("mochi-room");
    if (saved) return saved;
    const code = newRoomCode();
    sessionStorage.setItem("mochi-room", code);
    return code;
  } catch {
    return newRoomCode();
  }
}

const lesson = new Lesson(roomCode());
createRoot(document.getElementById("root")!).render(<App lesson={lesson} />);
