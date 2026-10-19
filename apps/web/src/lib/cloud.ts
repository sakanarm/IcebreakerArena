import type { Game } from '@icebreaker/shared';
import type { CatalogEntry } from '@/server/catalog';
import type { GameRecord } from '@/server/games';
import { api } from './api';

export type { CatalogEntry, GameRecord };
export type ReportReason = 'confidential' | 'inappropriate' | 'other';

/** Ids the server hands out: 22 url-safe characters. Browser games look like `g-…`. */
export const isServerId = (id: string) => /^[\w-]{22}$/.test(id);

// Saves run one after another, so an older edit never lands after a newer one, and a page that
// lists games can wait for the editor's last save (it may still be in flight after leaving).
let queue: Promise<unknown> = Promise.resolve();
export function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}
export const settled = () => queue;

/** The logged-in user's games and the shared catalog, through the web app's API. */
export const cloud = {
  list: () => api<{ games: GameRecord[] }>('/games').then((r) => r.games),
  get: (id: string) => api<{ game: GameRecord }>(`/games/${id}`).then((r) => r.game),
  create: (game: Game, extra: { sampleId?: string; from?: 'import' } = {}) =>
    api<{ game: GameRecord }>('/games', { method: 'POST', body: { game, ...extra } }).then((r) => r.game),
  save: (id: string, game: Game, version: number) => api<{ version: number }>(`/games/${id}`, { method: 'PUT', body: { game, version } }).then((r) => r.version),
  remove: (id: string) => api(`/games/${id}`, { method: 'DELETE' }),
  copy: (id: string) => api<{ game: GameRecord }>(`/games/${id}/copy`, { method: 'POST' }).then((r) => r.game),
  importLocal: (localId: string, game: Game) => api<{ id: string; created: boolean; separate?: true }>('/games/import-local', { method: 'POST', body: { localId, game } }),
  /** the saved game a browser game was moved into (404 when it never was) */
  findLocal: (localId: string) => api<{ id: string }>(`/games/import-local?localId=${encodeURIComponent(localId)}`).then((r) => r.id),

  catalog: () => api<{ entries: CatalogEntry[] }>('/catalog').then((r) => r.entries),
  share: (gameId: string) => api<{ entry: CatalogEntry; replaced: string | null }>('/catalog', { method: 'POST', body: { gameId } }),
  withdraw: (entryId: string) => api(`/catalog/${entryId}`, { method: 'DELETE' }),
  copyEntry: (entryId: string) => api<{ game: GameRecord }>(`/catalog/${entryId}/copy`, { method: 'POST' }).then((r) => r.game),
  report: (entryId: string, reason: ReportReason, note: string) =>
    api<{ hidden: boolean }>(`/catalog/${entryId}/report`, { method: 'POST', body: { reason, note } }).then((r) => r.hidden),
};

/** `next` from a login link, if it is a path on this site ('/x', never '//evil' or 'https:…'). */
export function safeNext(next: unknown, fallback = '/host'): string {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) && !/[\u0000-\u001f]/.test(next) ? next : fallback;
}
