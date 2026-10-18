import type { BoardMessage, Role, ServerMessage, ViewerMessage } from "./protocol";

type Incoming = BoardMessage | ViewerMessage | ServerMessage;

/** WebSocket to the room relay, with reconnects. */
export class StageSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly code: string,
    private readonly role: Role,
    private readonly onMessage: (m: Incoming) => void,
    private readonly onState: (open: boolean) => void = () => {},
  ) {
    this.open();
  }

  private open(): void {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/rooms/${this.code}?role=${this.role}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onState(true);
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)) as Incoming);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      this.onState(false);
      if (this.closed) return;
      const wait = Math.min(5000, 300 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.open(), wait);
    };
  }

  send(msg: BoardMessage | ViewerMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}

export function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 10);
}
