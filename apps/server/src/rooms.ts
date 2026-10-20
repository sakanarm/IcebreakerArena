import { randomInt } from 'node:crypto';
import type { Game } from '@icebreaker/shared';
import type { IO } from './io';
import { Room } from './room';

const MINUTE = 60_000;
/** a room nobody has touched for this long is closed */
const IDLE_LIMIT_MS = 60 * MINUTE;
/** finished games stay around longer so the Host can still pull the report */
const FINISHED_LIMIT_MS = 120 * MINUTE;
/** a game nobody is connected to any more (no Host, screen or player) is closed after this */
export const EMPTY_LIMIT_MS = 30 * MINUTE;

/**
 * In-memory rooms for the prototype. Phase 1 moves room state to Redis
 * (with a lock so each room has exactly one owner process).
 */
export class Rooms {
  private rooms = new Map<string, Room>();
  /** when each room was first seen with nobody connected */
  private emptySince = new Map<Room, number>();

  constructor(private readonly io: IO) {
    setInterval(() => this.sweep(), MINUTE).unref();
  }

  get size() {
    return this.rooms.size;
  }

  create(game: Game): Room {
    const room = new Room(this.newPin(), game, this.io);
    this.rooms.set(room.pin, room);
    return room;
  }

  get(pin: unknown): Room | undefined {
    return typeof pin === 'string' ? this.rooms.get(pin.trim()) : undefined;
  }

  /**
   * Rooms a restart would hurt (deploy/deploy.sh waits for these): all but finished games
   * that nobody has open any more, whose only loss would be a report no one is looking at.
   */
  get inUse(): number {
    let n = 0;
    for (const room of this.rooms.values()) if (room.phase !== 'podium' || this.connected(room) > 0) n++;
    return n;
  }

  close(room: Room) {
    if (this.rooms.get(room.pin) !== room) return; // already closed, and the PIN may be another room's now
    room.close();
    this.rooms.delete(room.pin);
    this.emptySince.delete(room);
    // the PIN may be handed out again later: whoever was the host, a screen or a player here
    // must not find themselves running or watching the new room
    for (const socket of this.io.sockets.sockets.values()) {
      if (socket.data.pin !== room.pin) continue;
      socket.leave(room.stageChannel);
      socket.data = {};
    }
  }

  private newPin(): string {
    for (;;) {
      const pin = String(randomInt(100_000, 1_000_000));
      if (!this.rooms.has(pin)) return pin;
    }
  }

  /** the Host, screens and players that have this room open */
  private connected(room: Room): number {
    return (this.io.sockets.adapter.rooms.get(room.stageChannel)?.size ?? 0) + room.connectedCount();
  }

  /** Runs every minute; `now` is for tests. */
  sweep(now = Date.now()) {
    for (const room of [...this.rooms.values()]) {
      const limit = room.phase === 'podium' ? FINISHED_LIMIT_MS : IDLE_LIMIT_MS;
      if (now - room.lastActivity > limit) {
        this.close(room);
        continue;
      }
      if (this.connected(room) > 0) {
        this.emptySince.delete(room);
        continue;
      }
      const since = this.emptySince.get(room) ?? now;
      this.emptySince.set(room, since);
      // a Host who closed the tab without closing the room: nobody can play it, yet it holds up a deploy.
      // A finished one stays for its report (see FINISHED_LIMIT_MS) and does not hold up a deploy.
      if (room.phase !== 'podium' && now - since >= EMPTY_LIMIT_MS) this.close(room);
    }
  }
}
