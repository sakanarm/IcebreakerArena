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

  private newPin(): string {
    for (;;) {
      const pin = String(randomInt(100_000, 1_000_000));
      if (!this.rooms.has(pin)) return pin;
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [pin, room] of this.rooms) {
      const limit = room.phase === 'podium' ? FINISHED_LIMIT_MS : IDLE_LIMIT_MS;
      if (now - room.lastActivity > limit) {
        room.close();
        this.rooms.delete(pin);
      }
    }
  }
}
