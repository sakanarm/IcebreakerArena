import { LIMITS, clip, copyTitle, type Game, type Question, type QuestionType, type Round } from '@icebreaker/shared';
import { lockWrites, type Db, type Sql } from './db';
import { newId } from './session';

/** where a saved game came from; 'local' rows carry the browser's game id so moving twice is harmless */
export type GameOrigin = 'new' | 'sample' | 'import' | 'local' | 'copy' | 'catalog';

export interface GameRecord {
  id: string;
  version: number;
  /** built from content the owner may not share (Pika); set only by the server */
  tainted: boolean;
  origin: GameOrigin;
  updatedAt: number;
  /** the catalog entry made from this game, while it is listed or under review */
  sharedEntryId: string | null;
  sharedStatus: 'listed' | 'hidden' | null;
  /** built from content a report took down (this game, one it was copied from, or a copy of the reported entry): can't be shared until a curator clears it */
  held: boolean;
  game: Game;
}

export const MAX_GAMES_PER_USER = 300;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const TYPES: QuestionType[] = ['quiz', 'truefalse', 'poll'];

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Text Postgres will store: no NUL characters and no half of an emoji pair (jsonb refuses both). */
export const cleanText = (s: string) => s.replaceAll('\u0000', '').replace(LONE_SURROGATE, '�');

export { clip };

/** A draft field over what the database keeps. Refused rather than cut, so nothing is lost without the editor knowing. */
export class TooLong extends Error {}

/**
 * What a saved draft may hold: well above what the editor allows (LIMITS), so any draft the editor
 * makes saves, while junk can't fill the database. Image links share their limit with validateGame.
 */
const CAP = { title: 300, prompt: 1000, option: 500, imageUrl: LIMITS.imageUrlMax, description: 2000, rounds: 40, questions: 200, options: 6 };

function text(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  const s = cleanText(v);
  if (s.length > max) throw new TooLong();
  return s;
}

function list(v: unknown, max: number): unknown[] {
  const a = Array.isArray(v) ? v : [];
  if (a.length > max) throw new TooLong();
  return a;
}

/** the editor's own id when it is a sensible one, else one made from the position */
const idOr = (v: unknown, fallback: string) => {
  const s = typeof v === 'string' ? cleanText(v) : '';
  return s && s.length <= 64 ? s : fallback;
};

/**
 * A draft from the editor, coerced into the Game shape so the editor can always open it again.
 * Drafts may be incomplete: the full check (validateGame) runs before playing or sharing.
 * Null when it is not a game at all; throws TooLong when a field is over what is kept.
 */
export function normalizeDraft(input: unknown): Game | null {
  if (!isObj(input)) return null;
  const rounds: Round[] = list(input.rounds, CAP.rounds)
    .filter(isObj)
    .map((r, ri) => ({
      id: idOr(r.id, `r${ri + 1}`),
      title: text(r.title, CAP.title),
      ...(typeof r.subtitle === 'string' ? { subtitle: text(r.subtitle, CAP.title) } : {}),
      ...(typeof r.multiplier === 'number' && Number.isFinite(r.multiplier) ? { multiplier: r.multiplier } : {}),
      ...(typeof r.timed === 'boolean' ? { timed: r.timed } : {}),
      questions: list(r.questions, CAP.questions)
        .filter(isObj)
        .map((q, qi): Question => {
          const imageUrl = text(q.imageUrl, CAP.imageUrl);
          return {
            id: idOr(q.id, `q${ri + 1}-${qi + 1}`),
            type: TYPES.includes(q.type as QuestionType) ? (q.type as QuestionType) : 'quiz',
            prompt: text(q.prompt, CAP.prompt),
            options: list(q.options, CAP.options).map((o) => text(o, CAP.option)),
            correct: (Array.isArray(q.correct) ? q.correct : []).filter((c): c is number => Number.isInteger(c) && c >= 0 && c < 6).slice(0, 6),
            timeLimitS: typeof q.timeLimitS === 'number' && Number.isFinite(q.timeLimitS) ? q.timeLimitS : 20,
            ...(q.multiplier === 0 || q.multiplier === 1 || q.multiplier === 2 ? { multiplier: q.multiplier } : {}),
            ...(imageUrl ? { imageUrl } : {}),
          };
        }),
    }));
  return {
    id: '',
    title: text(input.title, CAP.title),
    description: text(input.description, CAP.description),
    rounds,
    settings: { streakBonus: isObj(input.settings) && input.settings.streakBonus === true },
  };
}

type GameRow = {
  id: string;
  version: number;
  tainted: boolean;
  origin: GameOrigin;
  updated_at: Date;
  data: Game;
  ancestors: string[];
  entry_id: string | null;
  entry_status: 'listed' | 'hidden' | null;
  held: boolean;
};

/**
 * A game is held when a takedown's hold names the game itself or anything it was copied from.
 * Holds are few (one per takedown), so checking each game against all of them stays cheap.
 */
const SELECT = `SELECT g.id, g.version, g.tainted, g.origin, g.updated_at, g.data, g.ancestors, e.id AS entry_id, e.status AS entry_status,
    EXISTS (SELECT 1 FROM ib_catalog_entries h
             WHERE h.hold IS NOT NULL AND (h.hold ? g.id OR g.ancestors ?| ARRAY(SELECT jsonb_array_elements_text(h.hold)))) AS held
  FROM ib_games g LEFT JOIN ib_catalog_entries e ON e.game_id = g.id AND e.status <> 'withdrawn'`;

const toRecord = (r: GameRow): GameRecord => ({
  id: r.id,
  version: r.version,
  tainted: r.tainted,
  origin: r.origin,
  updatedAt: r.updated_at.getTime(),
  sharedEntryId: r.entry_id,
  sharedStatus: r.entry_status,
  held: r.held,
  game: { ...r.data, id: r.id },
});

export async function listGames(sql: Sql, ownerId: string): Promise<GameRecord[]> {
  const rows = await sql.query<GameRow>(`${SELECT} WHERE g.owner_id = $1 ORDER BY g.updated_at DESC LIMIT ${MAX_GAMES_PER_USER}`, [ownerId]);
  return rows.map(toRecord);
}

async function getRow(sql: Sql, ownerId: string, id: string): Promise<GameRow | null> {
  const rows = await sql.query<GameRow>(`${SELECT} WHERE g.id = $1 AND g.owner_id = $2`, [id, ownerId]);
  return rows[0] ?? null;
}

/** Null for someone else's game as well as a missing one: the API answers 404 either way. */
export async function getGame(sql: Sql, ownerId: string, id: string): Promise<GameRecord | null> {
  const row = await getRow(sql, ownerId, id);
  return row ? toRecord(row) : null;
}

/** The saved game a browser game was moved into, so an old editor link still finds it. */
export async function findLocalGame(sql: Sql, ownerId: string, localId: string): Promise<string | null> {
  const rows = await sql.query<{ id: string }>("SELECT id FROM ib_games WHERE owner_id = $1 AND origin = 'local' AND origin_ref = $2", [ownerId, localId]);
  return rows[0]?.id ?? null;
}

export class TooManyGames extends Error {}

/** Where a new game's content came from, so a takedown reaches it. Only the server sets these. */
export type Lineage = { origin: GameOrigin; originRef?: string | null; tainted?: boolean; ancestors?: string[] };

/** Call inside a transaction that holds lockWrites, so two requests can't both pass the quota. */
export async function insertGame(sql: Sql, ownerId: string, draft: Game, { origin, originRef = null, tainted = false, ancestors = [] }: Lineage): Promise<GameRecord> {
  const [{ n }] = await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM ib_games WHERE owner_id = $1', [ownerId]);
  if (n >= MAX_GAMES_PER_USER) throw new TooManyGames();
  const id = newId();
  await sql.query(
    'INSERT INTO ib_games (id, owner_id, title, data, tainted, origin, origin_ref, ancestors) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    [id, ownerId, draft.title.trim(), JSON.stringify({ ...draft, id }), tainted, origin, originRef, JSON.stringify(ancestors)],
  );
  return (await getGame(sql, ownerId, id))!;
}

/** A new game: blank, from a built-in sample, or imported from a file. */
export async function createGame(db: Db, ownerId: string, draft: Game, origin: 'new' | 'sample' | 'import', originRef: string | null = null): Promise<GameRecord> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    return insertGame(sql, ownerId, draft, { origin, originRef });
  });
}

export type SaveResult = { ok: true; version: number } | { ok: false; reason: 'not_found' } | { ok: false; reason: 'conflict'; version: number };

/** Saves over `version` only: a stale tab or a second device gets a conflict instead of silently winning. */
export async function saveGame(sql: Sql, ownerId: string, id: string, draft: Game, version: number): Promise<SaveResult> {
  const rows = await sql.query<{ version: number }>(
    `UPDATE ib_games SET title = $4, data = $5, version = version + 1, updated_at = now()
      WHERE id = $1 AND owner_id = $2 AND version = $3 RETURNING version`,
    [id, ownerId, version, draft.title.trim(), JSON.stringify({ ...draft, id })],
  );
  if (rows[0]) return { ok: true, version: rows[0].version };
  const now = await sql.query<{ version: number }>('SELECT version FROM ib_games WHERE id = $1 AND owner_id = $2', [id, ownerId]);
  return now[0] ? { ok: false, reason: 'conflict', version: now[0].version } : { ok: false, reason: 'not_found' };
}

/**
 * Deleting a game leaves its catalog snapshot alone: what was shared stays shared until withdrawn.
 * Copies keep the deleted game's id in their lineage, so a takedown still reaches them.
 */
export async function deleteGame(sql: Sql, ownerId: string, id: string): Promise<boolean> {
  const rows = await sql.query('DELETE FROM ib_games WHERE id = $1 AND owner_id = $2 RETURNING id', [id, ownerId]);
  return rows.length > 0;
}

/** A copy of your own game. Taint and lineage travel with it, so copying gets around neither "can't share" nor a takedown. */
export async function copyGame(db: Db, ownerId: string, id: string): Promise<GameRecord | null> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const src = await getRow(sql, ownerId, id);
    if (!src) return null;
    return insertGame(sql, ownerId, { ...src.data, title: copyTitle(src.data.title) }, { origin: 'copy', originRef: src.id, tainted: src.tainted, ancestors: [...src.ancestors, src.id] });
  });
}

/**
 * Moves a game kept in this browser into the account. Keyed on the browser's game id, so a retry
 * or a double click gives back the same game instead of a second copy.
 */
export async function importLocalGame(
  db: Db,
  ownerId: string,
  localId: string,
  draft: Game,
): Promise<{ id: string; created: boolean; separate?: true }> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const existing = await findLocalGame(sql, ownerId, localId);
    if (existing) {
      const [same] = await sql.query<{ same: boolean }>('SELECT data = $3::jsonb AS same FROM ib_games WHERE id = $1 AND owner_id = $2', [
        existing,
        ownerId,
        JSON.stringify({ ...draft, id: existing }),
      ]);
      if (same?.same) return { id: existing, created: false };
      // the browser has content the account does not (an old tab kept saving after the move):
      // keep it as another game, since the browser copy is deleted once this answers
      const kept = { ...draft, title: (clip(draft.title.trim(), LIMITS.titleMax - FROM_BROWSER.length) + FROM_BROWSER).trim() };
      // a retry whose first answer was lost must not make it twice
      const [again] = await sql.query<{ id: string }>(
        `SELECT id FROM ib_games WHERE owner_id = $1 AND origin = 'local' AND origin_ref IS NULL AND data - 'id' = $2::jsonb - 'id' LIMIT 1`,
        [ownerId, JSON.stringify(kept)],
      );
      if (again) return { id: again.id, created: false, separate: true };
      const rec = await insertGame(sql, ownerId, kept, { origin: 'local' });
      return { id: rec.id, created: true, separate: true };
    }
    const rec = await insertGame(sql, ownerId, draft, { origin: 'local', originRef: localId });
    return { id: rec.id, created: true };
  });
}

const FROM_BROWSER = ' (จากเบราว์เซอร์)';
