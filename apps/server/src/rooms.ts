import { randomInt } from 'node:crypto';
import type { Game } from '@icebreaker/shared';
import type { IO } from './io';
import { Room } from './room';

const MINUTE = 60_000;
/** a room nobody has touched for this long is closed */
const IDLE_LIMIT_MS = 60 * MINUTE;
/** finished games stay around longer so the Host can still pull the report */
const FINISHED_LIMIT_MS = 120 * MINUTE;

/**
 * In-memory rooms for the prototype. Phase 1 moves room state to Redis
 * (with a lock so each room has exactly one owner process).
 */
export class Rooms {
  private rooms = new Map<string, Room>();

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
    for (const room of this.rooms.values()) {
      const watching = this.io.sockets.adapter.rooms.get(room.stageChannel)?.size ?? 0;
      if (room.phase !== 'podium' || watching > 0 || room.connectedCount() > 0) n++;
    }
    return n;
  }

  close(room: Room) {
    if (this.rooms.get(room.pin) !== room) return; // already closed, and the PIN may be another room's now
    room.close();
    this.rooms.delete(room.pin);
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

  private sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      const limit = room.phase === 'podium' ? FINISHED_LIMIT_MS : IDLE_LIMIT_MS;
      if (now - room.lastActivity > limit) this.close(room);
    }
  }
}
