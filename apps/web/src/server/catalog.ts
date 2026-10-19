import { validateGame, type Game } from '@icebreaker/shared';
import { countQuestions, dropBlankOptions } from '../lib/games';
import { audit } from './audit';
import { lockWrites, type Db, type Sql } from './db';
import { cleanText, clip, getGame, insertGame, type GameRecord } from './games';
import { newId, type SessionUser } from './session';

export interface CatalogEntry {
  id: string;
  title: string;
  authorName: string;
  createdAt: number;
  /** 'hidden' only ever reaches the author: a report took it down until a curator looks */
  status: 'listed' | 'hidden';
  mine: boolean;
  questionCount: number;
  game: Game;
}

export const MAX_LISTED_PER_AUTHOR = 50;
const LIST_LIMIT = 300;
/** distinct reports that hide an entry; a confidentiality report hides it at once */
const HIDE_AFTER_REPORTS = 3;

type EntryRow = {
  id: string;
  title: string;
  author_id: string;
  author_name: string;
  created_at: Date;
  status: 'listed' | 'hidden';
  data: Game;
};

const toEntry = (r: EntryRow, viewerId: string): CatalogEntry => ({
  id: r.id,
  title: r.title,
  authorName: r.author_name,
  createdAt: r.created_at.getTime(),
  status: r.status,
  mine: r.author_id === viewerId,
  questionCount: countQuestions(r.data),
  game: { ...r.data, id: r.id },
});

/** Everything listed, newest first, plus the viewer's own entries that are under review. */
export async function listCatalog(sql: Sql, viewerId: string): Promise<CatalogEntry[]> {
  const rows = await sql.query<EntryRow>(
    `SELECT id, title, author_id, author_name, created_at, status, data FROM ib_catalog_entries
      WHERE status = 'listed' OR (status = 'hidden' AND author_id = $1)
      ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`,
    [viewerId],
  );
  return rows.map((r) => toEntry(r, viewerId));
}

/** A listed entry anyone logged in may play or copy; the author also reaches their own hidden one. */
export async function getEntry(sql: Sql, viewerId: string, id: string): Promise<CatalogEntry | null> {
  const rows = await sql.query<EntryRow>(
    `SELECT id, title, author_id, author_name, created_at, status, data FROM ib_catalog_entries
      WHERE id = $1 AND (status = 'listed' OR (status = 'hidden' AND author_id = $2))`,
    [id, viewerId],
  );
  return rows[0] ? toEntry(rows[0], viewerId) : null;
}

export type ShareResult =
  | { ok: true; entry: CatalogEntry; replaced: string | null }
  | { ok: false; reason: 'not_found' | 'tainted' | 'under_review' | 'too_many' }
  | { ok: false; reason: 'invalid'; errors: string[] };

/**
 * Publishes a frozen copy of the game: later edits to the game don't change what others see.
 * Sharing again replaces the listed copy. Games built from Pika content never leave their owner,
 * and content a report took down stays down, however it was copied, until a curator clears it.
 */
export async function shareGame(db: Db, user: SessionUser, gameId: string): Promise<ShareResult> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const rows = await sql.query<{ ancestors: string[] }>('SELECT ancestors FROM ib_games WHERE id = $1 AND owner_id = $2', [gameId, user.id]);
    if (!rows[0]) return { ok: false, reason: 'not_found' };
    const rec = (await getGame(sql, user.id, gameId))!;
    if (rec.tainted) return { ok: false, reason: 'tainted' };
    if (rec.held || rec.sharedStatus === 'hidden') return { ok: false, reason: 'under_review' };
    const checked = validateGame(dropBlankOptions(rec.game));
    if (!checked.ok) return { ok: false, reason: 'invalid', errors: checked.errors };

    const [{ n }] = await sql.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM ib_catalog_entries WHERE author_id = $1 AND status = 'listed' AND game_id IS DISTINCT FROM $2",
      [user.id, gameId],
    );
    if (n >= MAX_LISTED_PER_AUTHOR) return { ok: false, reason: 'too_many' };

    const replaced = rec.sharedEntryId;
    if (replaced) {
      await sql.query("UPDATE ib_catalog_entries SET status = 'withdrawn', status_at = now() WHERE id = $1 AND status = 'listed'", [replaced]);
    }
    const id = newId();
    const snapshot: Game = { ...checked.game, id };
    await sql.query(
      `INSERT INTO ib_catalog_entries (id, game_id, source_game, ancestors, author_id, author_name, title, data)
       VALUES ($1, $2, $2, $3::jsonb, $4, $5, $6, $7)`,
      [id, gameId, JSON.stringify(rows[0].ancestors), user.id, user.name, snapshot.title, JSON.stringify(snapshot)],
    );
    await audit(sql, user.id, 'catalog.share', id, { game: gameId, replaced });
    return { ok: true, entry: (await getEntry(sql, user.id, id))!, replaced };
  });
}

/**
 * The author takes a listed entry out of the catalog; a curator can take out any entry. An entry
 * hidden by a report stays as it is for the author: withdrawing it would not lift the takedown.
 * Copies people already made stay theirs.
 */
export async function withdrawEntry(db: Db, user: SessionUser, entryId: string): Promise<boolean> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const rows = await sql.query(
      `UPDATE ib_catalog_entries SET status = 'withdrawn', status_at = now()
        WHERE id = $1 AND ((status = 'listed' AND author_id = $2) OR ($3 AND status <> 'withdrawn')) RETURNING id`,
      [entryId, user.id, user.isCurator],
    );
    if (rows.length === 0) return false;
    await audit(sql, user.id, 'catalog.withdraw', entryId);
    return true;
  });
}

/** A private, editable copy of a listed entry, remembering where its content came from. */
export async function copyEntry(db: Db, userId: string, entryId: string): Promise<GameRecord | null> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const rows = await sql.query<{ data: Game; source_game: string | null; ancestors: string[] }>(
      "SELECT data, source_game, ancestors FROM ib_catalog_entries WHERE id = $1 AND status = 'listed'",
      [entryId],
    );
    const entry = rows[0];
    if (!entry) return null;
    const ancestors = [...entry.ancestors, ...(entry.source_game ? [entry.source_game] : []), entryId];
    const rec = await insertGame(sql, userId, { ...entry.data, id: entryId }, { origin: 'catalog', originRef: entryId, ancestors });
    await audit(sql, userId, 'catalog.copy', entryId, { game: rec.id });
    return rec;
  });
}

export type ReportReason = 'confidential' | 'inappropriate' | 'other';
export const REPORT_REASONS: ReportReason[] = ['confidential', 'inappropriate', 'other'];
export const REPORT_NOTE_MAX = 500;

/**
 * What a takedown of entry $1 holds back: the entry, the game it was shared from, and the copies
 * that game was made from back to the last catalog copy (content from the catalog before that is
 * someone else's and stays shareable). Any game with one of these in its lineage is held.
 */
const HOLD_OF_ENTRY = `
  SELECT jsonb_build_array(e.id)
      || CASE WHEN e.source_game IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(e.source_game) END
      || COALESCE((SELECT jsonb_agg(a.x ORDER BY a.n) FROM jsonb_array_elements_text(e.ancestors) WITH ORDINALITY a (x, n)
                    WHERE a.n > COALESCE((SELECT max(b.n) FROM jsonb_array_elements_text(e.ancestors) WITH ORDINALITY b (x, n)
                                            JOIN ib_catalog_entries k ON k.id = b.x), 0)), '[]'::jsonb) AS hold
    FROM ib_catalog_entries e WHERE e.id = $1`;

/**
 * Anyone logged in can flag an entry. Leaked confidential content can't wait for a curator,
 * so one such report hides the entry at once; other reasons hide it after a few people agree.
 * Reports count across every snapshot of the same game, so sharing it again doesn't reset them.
 * A takedown also hides the listed entries shared from copies of the same content.
 */
export async function reportEntry(
  db: Db,
  userId: string,
  entryId: string,
  reason: ReportReason,
  note: string,
): Promise<{ ok: true; hidden: boolean } | { ok: false; reason: 'not_found' | 'own_entry' }> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const rows = await sql.query<{ author_id: string; status: string; source_game: string | null }>(
      'SELECT author_id, status, source_game FROM ib_catalog_entries WHERE id = $1',
      [entryId],
    );
    const entry = rows[0];
    if (!entry || entry.status !== 'listed') return { ok: false, reason: 'not_found' };
    if (entry.author_id === userId) return { ok: false, reason: 'own_entry' };
    await sql.query(
      `INSERT INTO ib_catalog_reports (entry_id, reporter_id, reason, note) VALUES ($1, $2, $3, $4)
       ON CONFLICT (entry_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, note = EXCLUDED.note, created_at = now()`,
      [entryId, userId, reason, clip(cleanText(note), REPORT_NOTE_MAX) || null],
    );
    const [{ n }] = await sql.query<{ n: number }>(
      `SELECT count(DISTINCT r.reporter_id)::int AS n FROM ib_catalog_reports r JOIN ib_catalog_entries e ON e.id = r.entry_id
        WHERE e.id = $1 OR (e.source_game IS NOT NULL AND e.source_game = $2)`,
      [entryId, entry.source_game],
    );
    const hide = reason === 'confidential' || n >= HIDE_AFTER_REPORTS;
    let alsoHidden: string[] = [];
    if (hide) {
      const [{ hold }] = await sql.query<{ hold: string[] }>(HOLD_OF_ENTRY, [entryId]);
      const hidden = await sql.query<{ id: string }>(
        `UPDATE ib_catalog_entries
            SET status = 'hidden', status_at = now(), held_by = $1,
                hidden_reason = CASE WHEN id = $1 THEN $2 ELSE 'copy_of_hidden' END,
                hold = CASE WHEN id = $1 THEN $3::jsonb ELSE hold END
          WHERE id = $1 OR (status = 'listed' AND ($3::jsonb ? source_game OR ancestors ?| ARRAY(SELECT jsonb_array_elements_text($3::jsonb))))
          RETURNING id`,
        [entryId, reason, JSON.stringify(hold)],
      );
      alsoHidden = hidden.map((r) => r.id).filter((id) => id !== entryId);
    }
    await audit(sql, userId, 'catalog.report', entryId, { reason, hidden: hide, ...(alsoHidden.length ? { alsoHidden } : {}) });
    return { ok: true, hidden: hide };
  });
}
