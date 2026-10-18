import { parseMessage, type Role, type ServerMessage } from "../src/shared/protocol";

export interface Peer {
  send(data: string): unknown;
}

interface Room<P> {
  board: Set<P>;
  viewer: Set<P>;
}

/** Pairs one board with its viewers and relays validated messages between them. */
export class Rooms<P extends Peer> {
  private readonly rooms = new Map<string, Room<P>>();

  constructor(private readonly maxPeersPerRoom = 6) {}

  join(code: string, role: Role, peer: P): boolean {
    let room = this.rooms.get(code);
    if (!room) {
      room = { board: new Set(), viewer: new Set() };
      this.rooms.set(code, room);
    }
    if (room.board.size + room.viewer.size >= this.maxPeersPerRoom) return false;
    room[role].add(peer);
    this.announce(room);
    return true;
  }

  leave(code: string, role: Role, peer: P): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room[role].delete(peer);
    if (room.board.size === 0 && room.viewer.size === 0) this.rooms.delete(code);
    else this.announce(room);
  }

  /** Forward a message to the other side of the room. Returns false if it was dropped. */
  relay(code: string, role: Role, raw: string): boolean {
    const room = this.rooms.get(code);
    if (!room || !parseMessage(role, raw)) return false;
    for (const peer of role === "board" ? room.viewer : room.board) peer.send(raw);
    return true;
  }

  size(): number {
    return this.rooms.size;
  }

  private announce(room: Room<P>): void {
    const msg: ServerMessage = { t: "presence", boards: room.board.size, viewers: room.viewer.size };
    const raw = JSON.stringify(msg);
    for (const peer of room.board) peer.send(raw);
    for (const peer of room.viewer) peer.send(raw);
  }
}
