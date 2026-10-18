import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from '@icebreaker/shared';

type InterServerEvents = Record<string, never>;

export type IO = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;
