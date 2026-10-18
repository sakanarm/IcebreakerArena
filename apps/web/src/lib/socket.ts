import { io, type Socket } from 'socket.io-client';
import { GAME_SERVER_PORT, type ClientToServerEvents, type ServerToClientEvents } from '@icebreaker/shared';
import { BASE_PATH } from './paths';

export type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: GameClient | null = null;

/**
 * Where the game server answers: an origin, plus the path it is mounted under.
 *
 * - NEXT_PUBLIC_GAME_SERVER_URL wins when set; a path in it (https://example.com/icebreaker) is the mount.
 * - Behind a reverse proxy (the app has a base path) it shares the page's origin, under that base path.
 * - Otherwise it runs next to the web app on GAME_PORT from the build (default 4000). Using the page's
 *   own hostname means a phone that opened http://192.168.1.20:3000 talks to 192.168.1.20:4000.
 */
export function gameServer(): { origin: string; mount: string } {
  const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL;
  if (configured) {
    const url = new URL(configured);
    return { origin: url.origin, mount: url.pathname.replace(/\/+$/, '') };
  }
  if (BASE_PATH) return { origin: location.origin, mount: BASE_PATH };
  const port = process.env.NEXT_PUBLIC_GAME_PORT || GAME_SERVER_PORT;
  return { origin: `${location.protocol}//${location.hostname}:${port}`, mount: '' };
}

/** One connection per browser tab, shared by every screen. */
export function getSocket(): GameClient {
  if (!socket) {
    const { origin, mount } = gameServer();
    socket = io(origin, {
      // the mount goes in `path`: a path in the URL itself would be read as a Socket.IO namespace
      path: `${mount}/socket.io`,
      // WebSocket first; fall back to long-polling on networks that block it
      transports: ['websocket', 'polling'],
      tryAllTransports: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
  }
  return socket;
}
