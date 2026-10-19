import "../shared/fonts";
import "katex/dist/katex.min.css";
import "../board/surface.css";
import "./viewer.css";
import { createRoot } from "react-dom/client";
import { ROOM_CODE } from "../shared/protocol";
import { ViewerApp } from "./App";

const param = new URLSearchParams(location.search).get("room");
const room = param && ROOM_CODE.test(param) ? param : null;

createRoot(document.getElementById("root")!).render(<ViewerApp room={room} />);
