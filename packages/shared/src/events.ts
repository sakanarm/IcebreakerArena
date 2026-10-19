import type { Game, GameReport, Phase, PlayerState, StageState } from './types';

export type ErrorCode =
  | 'bad_request'
  | 'invalid_game'
  | 'room_not_found'
  | 'room_full'
  | 'not_allowed'
  | 'not_open'
  | 'already_answered'
  | 'too_late'
  | 'rate_limited';

export type Result<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: ErrorCode; message?: string };

type Ack<T> = (res: T) => void;

/** Events a browser (Host, Stage or Player) sends to the game server. */
export interface ClientToServerEvents {
  /** answers with the server clock, for countdown sync */
  'time:sync': (ack: Ack<number>) => void;
  'room:check': (pin: string, ack: Ack<Result<{ title: string; phase: Phase }>>) => void;

  'host:create': (payload: { game: Game }, ack: Ack<Result<{ pin: string; hostToken: string }>>) => void;
  'host:attach': (payload: { pin: string; hostToken: string }, ack: Ack<Result>) => void;
  /** Kahoot-style single "Next" button: moves the game to its next step */
  'host:next': () => void;
  /** closes answering now and goes to the reveal */
  'host:skip': () => void;
  'host:kick': (playerId: string) => void;
  'host:end': () => void;
  'host:report': (ack: Ack<Result<{ report: GameReport }>>) => void;
  /**
   * Closes the room for good: everyone in it is told, and the PIN stops working. It carries the token
   * like host:attach, so it still works when a reconnect sends it ahead of the re-attach.
   */
  'host:close': (payload: { pin: string; hostToken: string }, ack: Ack<Result>) => void;

  /** read-only big screen (a second display next to the Host Console) */
  'stage:attach': (pin: string, ack: Ack<Result>) => void;
  /** the Host or Stage page went away but the tab, and its connection, stays: stop watching the room */
  'stage:leave': () => void;

  'player:join': (
    payload: { pin: string; nickname: string; avatar: string },
    ack: Ack<Result<{ playerId: string; token: string; nickname: string }>>,
  ) => void;
  'player:resume': (payload: { pin: string; token: string }, ack: Ack<Result>) => void;
  'player:answer': (payload: { questionId: string; choice: number }, ack: Ack<Result>) => void;
  /** "change name" in the lobby: drops the old entry instead of leaving a ghost on the big screen */
  'player:leave': (ack: Ack<Result>) => void;
}

/** Events the game server pushes to browsers. */
export interface ServerToClientEvents {
  'stage:state': (state: StageState) => void;
  'player:state': (state: PlayerState) => void;
  'player:kicked': () => void;
  'room:closed': () => void;
}

export interface SocketData {
  pin?: string;
  role?: 'host' | 'stage' | 'player';
  playerId?: string;
}
