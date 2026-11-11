import { buildExam, examSize, toRoomGame, validateGame, type ExamPaper, type Game } from '@pika-arena/shared';
import { dropBlankOptions } from '../lib/games';
import { audit } from './audit';
import { lockWrites, type Db, type Sql } from './db';
import { getGame } from './games';
import { newId, type SessionUser } from './session';

/**
 * Exam links. A game's owner opens one link for it; anyone holding the link sits the exam with no
 * account. The link serves a frozen copy made when it was opened or last updated, so editing the game
 * never changes a paper someone is in the middle of, and an unfinished edit never reaches them.
 *
 * The copy is the game as a room would get it (`toRoomGame`): a question made from a knowledge base
 * page goes out without its source and without the explanation written from that page, because
 * whoever holds the link is not necessarily a member of that project (ROADMAP 11.9).
 */

/** What the owner sees of their game's link. */
export interface ExamLink {
  /** the code in the link: /exam/<id> */
  id: string;
  /** goes up each time the owner updates the paper */
  rev: number;
  updatedAt: number;
  questionCount: number;
  topicCount: number;
}

/** What the link serves. */
export interface PublishedExam {
  id: string;
  rev: number;
  updatedAt: number;
  paper: ExamPaper;
}

export type PublishResult =
  | { ok: true; link: ExamLink; created: boolean }
  | { ok: false; reason: 'not_found' | 'under_review' | 'no_questions' }
  | { ok: false; reason: 'invalid'; errors: string[] };

type LinkRow = { id: string; rev: number; updated_at: Date; data: Game };

const toLink = (r: LinkRow): ExamLink => {
  const paper = buildExam(r.data);
  return { id: r.id, rev: r.rev, updatedAt: r.updated_at.getTime(), questionCount: examSize(paper), topicCount: paper.topics.length };
};

/**
 * Opens the game's exam link, or brings the open one up to the game as it is now. The link itself
 * stays the same across updates, so one that was already handed out keeps working.
 * Content a report took down gets no link until a curator clears it, the same as sharing.
 */
export async function publishExam(db: Db, user: SessionUser, gameId: string): Promise<PublishResult> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const rec = await getGame(sql, user.id, gameId);
    if (!rec) return { ok: false, reason: 'not_found' };
    if (rec.held || rec.sharedStatus === 'hidden') return { ok: false, reason: 'under_review' };
    const checked = validateGame(dropBlankOptions(rec.game));
    if (!checked.ok) return { ok: false, reason: 'invalid', errors: checked.errors };
    const snapshot = toRoomGame(checked.game);
    if (examSize(buildExam(snapshot)) === 0) return { ok: false, reason: 'no_questions' };

    const title = snapshot.title.trim();
    const data = JSON.stringify(snapshot);
    const updated = await sql.query<LinkRow>(
      `UPDATE ib_exams SET title = $3, data = $4, game_version = $5, rev = rev + 1, updated_at = now()
        WHERE game_id = $1 AND owner_id = $2 RETURNING id, rev, updated_at, data`,
      [gameId, user.id, title, data, rec.version],
    );
    if (updated[0]) {
      await audit(sql, user.id, 'exam.update', updated[0].id, { game: gameId, rev: updated[0].rev });
      return { ok: true, link: toLink(updated[0]), created: false };
    }
    const made = await sql.query<LinkRow>(
      `INSERT INTO ib_exams (id, game_id, owner_id, title, data, game_version) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, rev, updated_at, data`,
      [newId(), gameId, user.id, title, data, rec.version],
    );
    await audit(sql, user.id, 'exam.open', made[0]!.id, { game: gameId });
    return { ok: true, link: toLink(made[0]!), created: true };
  });
}

/** Closes the game's link: it stops working at once. Opening one again later makes a new link. */
export async function closeExam(db: Db, user: SessionUser, gameId: string): Promise<boolean> {
  return db.tx(async (sql) => {
    await lockWrites(sql);
    const rows = await sql.query<{ id: string }>('DELETE FROM ib_exams WHERE game_id = $1 AND owner_id = $2 RETURNING id', [gameId, user.id]);
    if (!rows[0]) return false;
    await audit(sql, user.id, 'exam.close', rows[0].id, { game: gameId });
    return true;
  });
}

/** The owner's view of their game's link, or null when there is none (or the game is not theirs). */
export async function getExamLink(sql: Sql, ownerId: string, gameId: string): Promise<ExamLink | null> {
  const rows = await sql.query<LinkRow>('SELECT id, rev, updated_at, data FROM ib_exams WHERE game_id = $1 AND owner_id = $2', [gameId, ownerId]);
  return rows[0] ? toLink(rows[0]) : null;
}

/**
 * The paper behind a link, for anyone who holds it. Null for a link that was closed, whose game was
 * deleted, or whose content a report has taken down since (the same hold that stops sharing).
 */
export async function readExam(sql: Sql, id: string): Promise<PublishedExam | null> {
  const rows = await sql.query<LinkRow>(
    `SELECT x.id, x.rev, x.updated_at, x.data
       FROM ib_exams x JOIN ib_games g ON g.id = x.game_id
      WHERE x.id = $1
        AND NOT EXISTS (SELECT 1 FROM ib_catalog_entries h
                         WHERE h.hold IS NOT NULL AND (h.hold ? g.id OR g.ancestors ?| ARRAY(SELECT jsonb_array_elements_text(h.hold))))`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  // cut again on the way out: whatever a row holds, a source or its explanation never leaves through a link
  return { id: row.id, rev: row.rev, updatedAt: row.updated_at.getTime(), paper: buildExam(toRoomGame(row.data)) };
}
