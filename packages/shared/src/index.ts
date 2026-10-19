export * from './types';
export * from './events';
export * from './scoring';
export * from './validate';
export * from './text';
export * from './nicknames';
export * from './sample-games';

/** reading time before answering opens; the doc's 3 s, longer for long questions */
export function leadInMs(prompt: string): number {
  return Math.min(6000, Math.max(3000, 1500 + prompt.length * 45));
}

export const MAX_PLAYERS_PER_ROOM = 1000;
export const GAME_SERVER_PORT = 4000;
