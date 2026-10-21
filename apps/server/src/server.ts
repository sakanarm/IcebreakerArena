import { timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { Server } from 'socket.io';
import {
  AVATARS,
  cleanNickname,
  randomAvatar,
  randomNickname,
  validateGame,
  type ClientToServerEvents,
} from '@icebreaker/shared';
import type { GameSocket, IO } from './io';
import type { Room } from './room';
import { Rooms } from './rooms';

export interface GameServer {
  port: number;
  close: () => Promise<void>;
}

/** Starts the HTTP + Socket.IO game server. Port 0 picks a free port (used by tests). */
export function startGameServer(port: number, host = '0.0.0.0'): Promise<GameServer> {
  const httpServer = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    // deploy/deploy.sh refuses to restart while rooms are in use: they live only in this process
    if (path === '/health') {
      return json(res, 200, {
        ok: true,
        rooms: rooms.size,
        inUse: rooms.inUse,
        clients: io.engine.clientsCount,
        uptimeS: Math.round(process.uptime()),
      });
    }
    // the Stage builds the join QR code from these when the Host opened the app on localhost
    if (path === '/info') return json(res, 200, { lanAddresses: lanAddresses() });
    json(res, 404, { ok: false });
  });

  const io: IO = new Server(httpServer, {
    cors: { origin: true },
    pingInterval: 10_000,
    pingTimeout: 10_000,
    maxHttpBufferSize: 512 * 1024,
  });
  const rooms = new Rooms(io);

  const attachHost = (socket: GameSocket, room: Room) => {
    detach(socket);
    socket.data = { pin: room.pin, role: 'host' };
    socket.join(room.stageChannel);
    socket.emit('stage:state', room.stageState());
  };

  /** Leaves whatever room this socket was part of before it takes a new role. */
  const detach = (socket: GameSocket) => {
    const room = rooms.get(socket.data.pin);
    if (room && socket.data.role === 'player' && socket.data.playerId) room.disconnect(socket.data.playerId, socket.id);
    if (room && socket.data.role !== 'player') socket.leave(room.stageChannel);
    socket.data = {};
  };

  io.on('connection', (socket) => {
    const allow = rateLimit(30, 10_000);
    const on = <E extends keyof ClientToServerEvents>(event: E, fn: ClientToServerEvents[E]) => handle(socket, event, fn);
    const hostRoom = () => (socket.data.role === 'host' ? rooms.get(socket.data.pin) : undefined);

    on('time:sync', (ack) => reply(ack)(Date.now()));

    on('room:check', (pin, ack) => {
      const done = reply(ack);
      if (!allow()) return done({ ok: false, error: 'rate_limited' });
      const room = rooms.get(pin);
      done(room ? { ok: true, title: room.game.title, phase: room.phase } : { ok: false, error: 'room_not_found' });
    });

    // ---------- Host ----------

    on('host:create', (payload, ack) => {
      const done = reply(ack);
      if (!allow()) return done({ ok: false, error: 'rate_limited' });
      const checked = validateGame(payload?.game);
      if (!checked.ok) return done({ ok: false, error: 'invalid_game', message: checked.errors.slice(0, 5).join('\n') });
      const room = rooms.create(checked.game);
      attachHost(socket, room);
      console.log(`[room ${room.pin}] created: ${room.game.title}`);
      done({ ok: true, pin: room.pin, hostToken: room.hostToken });
    });

    on('host:attach', (payload, ack) => {
      const done = reply(ack);
      const room = rooms.get(payload?.pin);
      if (!room) return done({ ok: false, error: 'room_not_found' });
      if (!sameSecret(payload.hostToken, room.hostToken)) return done({ ok: false, error: 'not_allowed' });
      attachHost(socket, room);
      done({ ok: true });
    });

    on('host:next', (at) => hostRoom()?.next(stepOf(at)));
    on('host:skip', (at) => hostRoom()?.skip(stepOf(at)));
    on('host:end', () => hostRoom()?.end());

    on('host:kick', (playerId) => {
      const socketId = hostRoom()?.kick(String(playerId));
      const target = socketId ? io.sockets.sockets.get(socketId) : undefined;
      if (!target) return;
      target.emit('player:kicked');
      target.data = {};
    });

    on('host:report', (ack) => {
      const room = hostRoom();
      reply(ack)(room ? { ok: true, report: room.report() } : { ok: false, error: 'not_allowed' });
    });

    on('host:close', (payload, ack) => {
      const done = reply(ack);
      const room = rooms.get(payload?.pin);
      if (!room) return done({ ok: false, error: 'room_not_found' });
      if (!sameSecret(payload.hostToken, room.hostToken)) return done({ ok: false, error: 'not_allowed' });
      rooms.close(room);
      console.log(`[room ${room.pin}] closed by the host`);
      done({ ok: true });
    });

    // ---------- Stage (read-only second screen) ----------

    on('stage:attach', (pin, ack) => {
      const done = reply(ack);
      const room = rooms.get(pin);
      if (!room) return done({ ok: false, error: 'room_not_found' });
      detach(socket);
      socket.data = { pin: room.pin, role: 'stage' };
      socket.join(room.stageChannel);
      done({ ok: true });
      socket.emit('stage:state', room.stageState());
    });

    // a finished room nobody is looking at must not hold up a deploy just because the tab is still open
    on('stage:leave', () => {
      if (socket.data.role === 'host' || socket.data.role === 'stage') detach(socket);
    });

    // ---------- Player ----------

    on('player:join', (payload, ack) => {
      const done = reply(ack);
      if (!allow()) return done({ ok: false, error: 'rate_limited' });
      const room = rooms.get(payload?.pin);
      if (!room) return done({ ok: false, error: 'room_not_found' });
      const nickname = cleanNickname(String(payload.nickname ?? '')) || randomNickname();
      const avatar = (AVATARS as readonly string[]).includes(payload.avatar) ? payload.avatar : randomAvatar();
      detach(socket);
      const player = room.addPlayer(nickname, avatar, socket.id);
      if (player === 'full') return done({ ok: false, error: 'room_full' });
      socket.data = { pin: room.pin, role: 'player', playerId: player.id };
      done({ ok: true, playerId: player.id, token: player.token, nickname: player.nickname });
      room.sendPlayerState(player);
    });

    // after a refresh or a dropped connection: same player, same score
    on('player:resume', (payload, ack) => {
      const done = reply(ack);
      const room = rooms.get(payload?.pin);
      if (!room) return done({ ok: false, error: 'room_not_found' });
      detach(socket);
      const player = room.resume(String(payload.token ?? ''), socket.id);
      if (!player) return done({ ok: false, error: 'not_allowed' });
      socket.data = { pin: room.pin, role: 'player', playerId: player.id };
      done({ ok: true });
      room.sendPlayerState(player);
    });

    on('player:answer', (payload, ack) => {
      const done = reply(ack);
      const room = socket.data.role === 'player' ? rooms.get(socket.data.pin) : undefined;
      if (!room || !socket.data.playerId) return done({ ok: false, error: 'not_allowed' });
      done(room.answer(socket.data.playerId, String(payload?.questionId), payload));
    });

    // only the lobby frees the spot: once the game runs, a score stays on the board even if its owner wanders off
    on('player:leave', (ack) => {
      const room = socket.data.role === 'player' ? rooms.get(socket.data.pin) : undefined;
      if (room?.phase === 'lobby' && socket.data.playerId) room.kick(socket.data.playerId);
      detach(socket);
      reply(ack)({ ok: true });
    });

    socket.on('disconnect', () => detach(socket));
  });

  return new Promise((resolve) => {
    httpServer.listen(port, host, () => {
      resolve({
        port: (httpServer.address() as AddressInfo).port,
        close: () => new Promise<void>((done) => io.close(() => done())),
      });
    });
  });
}

/** Malformed input from a client must never crash the server for everyone else. */
function handle<E extends keyof ClientToServerEvents>(socket: GameSocket, event: E, fn: ClientToServerEvents[E]) {
  const listener = (...args: unknown[]) => {
    try {
      (fn as (...a: unknown[]) => void)(...args);
    } catch (err) {
      console.error(`[${event}]`, err);
    }
  };
  socket.on(event, listener as never);
}

/** the step a host's press carries (see `host:next`); anything else counts as none, as from a page before it */
function stepOf(at: unknown): number | undefined {
  const step = typeof at === 'object' && at !== null ? (at as { step?: unknown }).step : undefined;
  return Number.isSafeInteger(step) ? (step as number) : undefined;
}

function reply<T extends (...args: never[]) => void>(ack: T): T {
  return typeof ack === 'function' ? ack : ((() => {}) as unknown as T);
}

function rateLimit(max: number, windowMs: number) {
  let windowStart = 0;
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
    }
    return ++count <= max;
  };
}

function sameSecret(given: unknown, expected: string) {
  if (typeof given !== 'string' || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

/** Private IPv4 addresses, home/office Wi-Fi ranges first. */
export function lanAddresses(): string[] {
  const order = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
    .sort((a, b) => order(a) - order(b));
}
