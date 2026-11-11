import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { LIMITS, QUESTION_TYPES, SAMPLE_GAMES, TIME_CHOICES_S, buildExam, examSize, sliderStart, validateGame, type Game } from '@pika-arena/shared';
import { requireUser, upsertUser } from './auth';
import { copyEntry, getEntry, listCatalog, reportEntry, shareGame, withdrawEntry } from './catalog';
import { authMode, authModeProblem, authModeSource, dbSchema } from './config';
import { SCHEMA_VERSION, checkSchemaName, connectPostgres, migrate, openPglite, type Db } from './db';
import { DEMO_GAMES, SHARED_DEMO, addDemoGames } from './demo-games';
import { closeExam, getExamLink, publishExam, readExam } from './exams';
import {
  MAX_GAMES_PER_USER,
  TooLong,
  TooManyGames,
  clip,
  copyGame,
  createGame,
  createPikaGame,
  deleteGame,
  findLocalGame,
  getGame,
  importLocalGame,
  listGames,
  normalizeDraft,
  saveGame,
} from './games';
import { HttpError, guardMutation, readJson } from './http';
import { checkLocalLogin, createLocalUser, generatePassword, hashPassword, normalizeUsername, resetLoginThrottle, setLocalPassword, verifyPassword } from './local-users';
import { IDLE_MS, createSession, findSession, parseCookies, sessionToken, type SessionUser } from './session';

let db: Db;
let n = 0;

before(async () => {
  // in our own schema, made by migrate, as on the server
  db = await openPglite(undefined, 'icebreaker');
  await migrate(db);
  await migrate(db); // a second start changes nothing
});
after(() => db.close());

const newUser = (name = `user${++n}`): Promise<SessionUser> => upsertUser(db, { issuer: 'test', subject: `${name}-${++n}`, name });
const sample = (): Game => structuredClone(SAMPLE_GAMES[0]!);
const draft = (title: string): Game => ({ id: 'x', title, rounds: [{ id: 'r', title: '', questions: [] }] });

test('a game is private: another user can not see, save, copy or delete it', async () => {
  const [a, b] = [await newUser('A'), await newUser('B')];
  const g = await createGame(db, a.id, sample(), 'sample');
  assert.equal(g.game.id, g.id, 'the stored game carries the server id');
  assert.match(g.id, /^[\w-]{22}$/);

  assert.equal(await getGame(db, b.id, g.id), null);
  assert.deepEqual(await listGames(db, b.id), []);
  assert.deepEqual(await saveGame(db, b.id, g.id, sample(), 1), { ok: false, reason: 'not_found' });
  assert.equal(await copyGame(db, b.id, g.id), null);
  assert.equal(await deleteGame(db, b.id, g.id), false);
  assert.equal((await shareGame(db, b, g.id)).ok, false);
  assert.ok(await getGame(db, a.id, g.id), 'still there for the owner');
});

test('saving over an old version is a conflict, not a silent overwrite', async () => {
  const a = await newUser();
  const g = await createGame(db, a.id, draft('v1'), 'new');
  assert.deepEqual(await saveGame(db, a.id, g.id, draft('v2'), 1), { ok: true, version: 2 });
  assert.deepEqual(await saveGame(db, a.id, g.id, draft('from a stale tab'), 1), { ok: false, reason: 'conflict', version: 2 });
  assert.equal((await getGame(db, a.id, g.id))!.game.title, 'v2');
});

test('sharing needs a complete game, freezes a snapshot, and sharing again replaces it', async () => {
  const a = await newUser('Author');
  const viewer = await newUser();
  const half = await createGame(db, a.id, draft('half done'), 'new');
  const refused = await shareGame(db, a, half.id);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.reason, 'invalid');

  const g = await createGame(db, a.id, sample(), 'sample');
  const first = await shareGame(db, a, g.id);
  assert.ok(first.ok);
  assert.equal(first.entry.authorName, 'Author');
  assert.equal(first.entry.game.id, first.entry.id);

  // editing the game afterwards doesn't touch what others see
  const changed = { ...g.game, title: 'renamed later' };
  assert.ok((await saveGame(db, a.id, g.id, changed, g.version)).ok);
  const seen = await getEntry(db, viewer.id, first.entry.id);
  assert.equal(seen?.title, sample().title);
  assert.equal(seen?.mine, false);
  assert.equal((await getGame(db, a.id, g.id))!.sharedEntryId, first.entry.id);

  const second = await shareGame(db, a, g.id);
  assert.ok(second.ok);
  assert.equal(second.replaced, first.entry.id);
  assert.equal(await getEntry(db, viewer.id, first.entry.id), null, 'the old snapshot is gone');
  const listed = (await listCatalog(db, viewer.id)).filter((e) => e.id === first.entry.id || e.id === second.entry.id);
  assert.deepEqual(
    listed.map((e) => e.title),
    ['renamed later'],
  );

  // deleting the game leaves the shared snapshot until it is withdrawn
  assert.ok(await deleteGame(db, a.id, g.id));
  assert.ok(await getEntry(db, viewer.id, second.entry.id));
});

test('a game built from Pika content can not be shared, and its copies can not either', async () => {
  const a = await newUser();
  const g = await createGame(db, a.id, sample(), 'new');
  await db.query('UPDATE ib_games SET tainted = true WHERE id = $1', [g.id]);
  const res = await shareGame(db, a, g.id);
  assert.equal(!res.ok && res.reason, 'tainted');

  const copy = await copyGame(db, a.id, g.id);
  assert.equal(copy?.tainted, true);
  assert.equal(copy?.origin, 'copy');
  const res2 = await shareGame(db, a, copy!.id);
  assert.equal(!res2.ok && res2.reason, 'tainted');

  // saving the game keeps the flag: only the server sets or clears it
  assert.ok((await saveGame(db, a.id, g.id, sample(), g.version)).ok);
  assert.equal((await getGame(db, a.id, g.id))!.tainted, true);
});

test('anyone logged in can copy a listed entry; only the author withdraws it', async () => {
  const [a, b] = [await newUser(), await newUser()];
  const g = await createGame(db, a.id, sample(), 'sample');
  const shared = await shareGame(db, a, g.id);
  assert.ok(shared.ok);

  const copy = await copyEntry(db, b.id, shared.entry.id);
  assert.ok(copy);
  assert.equal(copy.origin, 'catalog');
  assert.equal(copy.tainted, false);
  assert.notEqual(copy.id, shared.entry.id);
  assert.equal(copy.game.title, sample().title);
  assert.equal((await listGames(db, b.id)).length, 1);

  assert.equal(await withdrawEntry(db, b, shared.entry.id), false, 'not the author');
  assert.equal(await withdrawEntry(db, { ...b, isCurator: true }, shared.entry.id), true, 'a curator may');
  assert.equal(await getEntry(db, b.id, shared.entry.id), null);
  assert.equal(await copyEntry(db, b.id, shared.entry.id), null, 'withdrawn entries can not be copied');
  assert.ok(await getGame(db, b.id, copy.id), 'copies already made stay');
});

test('a confidentiality report hides an entry at once; the author still sees it and can not re-share around it', async () => {
  const [a, b, c] = [await newUser(), await newUser(), await newUser()];
  const g = await createGame(db, a.id, sample(), 'sample');
  const shared = await shareGame(db, a, g.id);
  assert.ok(shared.ok);

  assert.deepEqual(await reportEntry(db, a.id, shared.entry.id, 'confidential', ''), { ok: false, reason: 'own_entry' });
  assert.deepEqual(await reportEntry(db, b.id, shared.entry.id, 'confidential', 'customer names'), { ok: true, hidden: true });

  assert.equal(await getEntry(db, c.id, shared.entry.id), null);
  assert.equal((await listCatalog(db, c.id)).some((e) => e.id === shared.entry.id), false);
  const own = await getEntry(db, a.id, shared.entry.id);
  assert.equal(own?.status, 'hidden');
  const again = await shareGame(db, a, g.id);
  assert.equal(!again.ok && again.reason, 'under_review');
});

test('other reasons hide an entry only after three different people report it', async () => {
  const a = await newUser();
  const g = await createGame(db, a.id, sample(), 'sample');
  const shared = await shareGame(db, a, g.id);
  assert.ok(shared.ok);
  const reporters = [await newUser(), await newUser(), await newUser()];
  assert.deepEqual(await reportEntry(db, reporters[0]!.id, shared.entry.id, 'other', ''), { ok: true, hidden: false });
  assert.deepEqual(await reportEntry(db, reporters[0]!.id, shared.entry.id, 'other', 'again'), { ok: true, hidden: false }, 'one person counts once');
  assert.deepEqual(await reportEntry(db, reporters[1]!.id, shared.entry.id, 'inappropriate', ''), { ok: true, hidden: false });
  assert.deepEqual(await reportEntry(db, reporters[2]!.id, shared.entry.id, 'other', ''), { ok: true, hidden: true });
});

test('the demo games are complete, each shows every question type, and adding them again adds nothing', async () => {
  assert.equal(new Set(DEMO_GAMES.map((g) => g.id)).size, DEMO_GAMES.length);
  for (const g of DEMO_GAMES) {
    const res = validateGame(g);
    assert.equal(res.ok, true, res.ok ? '' : `${g.id}: ${res.errors.join('; ')}`);
    const questions = g.rounds.flatMap((r) => r.questions);
    assert.ok(g.description?.startsWith(`${g.rounds.length} ด่าน ${questions.length} ข้อ`), `${g.id}: ${g.description}`);
    assert.deepEqual([...new Set(questions.map((q) => q.type))].sort(), [...QUESTION_TYPES].sort(), g.id);
    for (const q of questions) {
      assert.ok((TIME_CHOICES_S as readonly number[]).includes(q.timeLimitS), `${g.id} ${q.id}: ${q.timeLimitS} s is not in the editor's list`);
      // a player who never touches the slider must not score
      if (q.slider) assert.ok(Math.abs(sliderStart(q.slider) - q.slider.answer) > q.slider.margin, `${g.id} ${q.id}: the slider starts inside the margin`);
    }
  }

  const a = await newUser('Demo maker');
  const first = await addDemoGames(db, a, { share: true });
  assert.deepEqual(first, { made: DEMO_GAMES.map((g) => g.title), kept: [], shared: 'listed' });
  assert.deepEqual(await addDemoGames(db, a, { share: true }), { made: [], kept: DEMO_GAMES.map((g) => g.title), shared: 'already' });
  const games = await listGames(db, a.id);
  assert.equal(games.length, DEMO_GAMES.length);
  assert.ok(games.every((g) => g.origin === 'sample' && validateGame(g.game).ok));
  assert.deepEqual(games.filter((g) => g.sharedStatus === 'listed').map((g) => g.game.title), [DEMO_GAMES.find((g) => g.id === SHARED_DEMO)!.title]);
  const listed = (await listCatalog(db, (await newUser()).id)).filter((e) => e.authorName === 'Demo maker');
  assert.equal(listed.length, 1, 'shared once, not once per run');

  // a game the account already has by a demo's title is left alone, and the rest still come in
  const b = await newUser();
  const mine = await createGame(db, b.id, { ...draft(DEMO_GAMES[0]!.title) }, 'new');
  const res = await addDemoGames(db, b);
  assert.deepEqual(res, { made: DEMO_GAMES.slice(1).map((g) => g.title), kept: [DEMO_GAMES[0]!.title], shared: null });
  assert.equal((await getGame(db, b.id, mine.id))!.version, 1);
});

test('moving browser games into the account is safe to repeat', async () => {
  const a = await newUser();
  const first = await importLocalGame(db, a.id, 'g-abc123', sample());
  const second = await importLocalGame(db, a.id, 'g-abc123', sample());
  assert.equal(first.created, true);
  assert.deepEqual(second, { id: first.id, created: false });
  const [both] = await Promise.all([importLocalGame(db, a.id, 'g-race', sample()), importLocalGame(db, a.id, 'g-race', sample())]);
  assert.ok(both.id);
  assert.equal((await listGames(db, a.id)).length, 2);
  // another person with the same browser game id gets their own copy
  const b = await newUser();
  assert.notEqual((await importLocalGame(db, b.id, 'g-abc123', sample())).id, first.id);
});

test('a browser game that changed after it was moved is kept as another game, once', async () => {
  const a = await newUser();
  const moved = await importLocalGame(db, a.id, 'g-tab', sample());
  const later = { ...sample(), title: 'แก้ต่อในแท็บเก่า' };
  const kept = await importLocalGame(db, a.id, 'g-tab', later);
  assert.equal(kept.created, true);
  assert.equal(kept.separate, true);
  assert.notEqual(kept.id, moved.id);
  const rec = (await getGame(db, a.id, kept.id))!;
  assert.equal(rec.game.title, 'แก้ต่อในแท็บเก่า (จากเบราว์เซอร์)');
  assert.deepEqual(rec.game.rounds, later.rounds);
  assert.equal((await getGame(db, a.id, moved.id))!.game.title, sample().title, 'the moved game is left as it was');
  // the answer got lost and the browser asks again
  assert.deepEqual(await importLocalGame(db, a.id, 'g-tab', later), { id: kept.id, created: false, separate: true });
  assert.equal((await listGames(db, a.id)).length, 2);
  // a long title still fits with the suffix
  const long = await importLocalGame(db, a.id, 'g-tab', { ...sample(), title: 'ก'.repeat(LIMITS.titleMax) });
  assert.ok((await getGame(db, a.id, long.id))!.game.title.length <= LIMITS.titleMax);
});

const shared = async (user: SessionUser, gameId: string) => {
  const res = await shareGame(db, user, gameId);
  assert.ok(res.ok, `share ${gameId}: ${JSON.stringify(res)}`);
  return res.entry.id;
};
const shareReason = async (user: SessionUser, gameId: string) => {
  const res = await shareGame(db, user, gameId);
  return res.ok ? 'ok' : res.reason;
};

test('an entry a report hid stays hidden: its author can not withdraw it, a curator can', async () => {
  const [a, b] = [await newUser(), await newUser()];
  const g = await createGame(db, a.id, sample(), 'sample');
  const e = await shared(a, g.id);
  assert.deepEqual(await reportEntry(db, b.id, e, 'confidential', ''), { ok: true, hidden: true });
  assert.equal(await withdrawEntry(db, a, e), false);
  assert.equal((await getEntry(db, a.id, e))?.status, 'hidden');
  assert.equal(await shareReason(a, g.id), 'under_review');
  assert.equal(await withdrawEntry(db, { ...b, isCurator: true }, e), true);
  assert.equal(await withdrawEntry(db, { ...b, isCurator: true }, e), false, 'already out');
  assert.equal(await shareReason(a, g.id), 'under_review', 'withdrawing does not clear the hold');
});

test('a takedown reaches every copy of the content, before or after it was reported', async () => {
  const [a, b, c] = [await newUser(), await newUser(), await newUser()];
  const g = await createGame(db, a.id, sample(), 'sample');
  const own = await copyGame(db, a.id, g.id);
  const e1 = await shared(a, g.id);
  const fromCatalog = (await copyEntry(db, b.id, e1))!;
  const e2 = await shared(b, fromCatalog.id); // b re-shares the copy before the report
  const chain1 = (await copyGame(db, b.id, fromCatalog.id))!;
  const chain2 = (await copyGame(db, b.id, chain1.id))!;
  assert.ok(await deleteGame(db, b.id, chain1.id), 'the middle of the chain is gone');

  assert.deepEqual(await reportEntry(db, c.id, e1, 'confidential', ''), { ok: true, hidden: true });

  assert.equal((await getEntry(db, b.id, e2))?.status, 'hidden', "b's re-share is hidden with it");
  assert.equal(await getEntry(db, c.id, e2), null);
  assert.equal(await withdrawEntry(db, b, e2), false);
  for (const [who, id] of [
    [a, g.id],
    [a, own!.id],
    [b, fromCatalog.id],
    [b, chain2.id],
  ] as const) {
    assert.equal((await getGame(db, who.id, id))!.held, true, `${id} is held`);
    assert.equal(await shareReason(who, id), 'under_review');
  }
  // a copy made from a held game is held too
  const later = (await copyGame(db, b.id, chain2.id))!;
  assert.equal(later.held, true);
  assert.equal(await shareReason(b, later.id), 'under_review');
  // other people's content is untouched
  const other = await createGame(db, b.id, sample(), 'sample');
  assert.equal(other.held, false);
  assert.equal(await shareReason(b, other.id), 'ok');
});

test('a takedown holds the copies the reported game was made from, back to the last catalog copy', async () => {
  const [a, b, c] = [await newUser(), await newUser(), await newUser()];
  // a's original, shared and listed
  const x = await createGame(db, a.id, sample(), 'sample');
  const ex = await shared(a, x.id);
  // b copies it, edits a copy of the copy, and shares that
  const y0 = (await copyEntry(db, b.id, ex))!;
  const y1 = (await copyGame(db, b.id, y0.id))!;
  const ey = await shared(b, y1.id);
  assert.deepEqual(await reportEntry(db, c.id, ey, 'confidential', ''), { ok: true, hidden: true });

  assert.equal((await getGame(db, b.id, y1.id))!.held, true);
  assert.equal((await getGame(db, b.id, y0.id))!.held, true, 'the copy it was made from');
  assert.equal(await shareReason(b, y0.id), 'under_review');
  // what came before the catalog copy is a's and was not reported
  assert.equal((await getGame(db, a.id, x.id))!.held, false);
  assert.equal((await getEntry(db, c.id, ex))?.status, 'listed');
  const z = (await copyEntry(db, c.id, ex))!;
  assert.equal(z.held, false, "someone else's copy of a's entry");
});

test('reports count across every snapshot of a game, so sharing again does not reset them', async () => {
  const a = await newUser();
  const g = await createGame(db, a.id, sample(), 'sample');
  const e1 = await shared(a, g.id);
  const [r1, r2, r3] = [await newUser(), await newUser(), await newUser()];
  assert.deepEqual(await reportEntry(db, r1.id, e1, 'other', ''), { ok: true, hidden: false });
  assert.deepEqual(await reportEntry(db, r2.id, e1, 'other', ''), { ok: true, hidden: false });
  const e2 = await shared(a, g.id);
  assert.deepEqual(await reportEntry(db, r1.id, e2, 'other', 'still'), { ok: true, hidden: false }, 'r1 counts once');
  assert.deepEqual(await reportEntry(db, r3.id, e2, 'inappropriate', ''), { ok: true, hidden: true });
  assert.equal(await shareReason(a, g.id), 'under_review');
});

test('a report note is cleaned and capped', async () => {
  const [a, b] = [await newUser(), await newUser()];
  const g = await createGame(db, a.id, sample(), 'sample');
  const e = await shared(a, g.id);
  assert.ok((await reportEntry(db, b.id, e, 'other', 'a\u0000b\uD800' + '😀'.repeat(400))).ok);
  const [{ note }] = await db.query<{ note: string }>('SELECT note FROM ib_catalog_reports WHERE entry_id = $1', [e]);
  assert.ok(note.startsWith('ab�😀'));
  assert.ok(note.length <= 500);
  assert.ok(note.endsWith('😀'), 'no half emoji at the cut');
});

test('drafts lose NULs and half emoji; fields over what is kept are refused, not cut', async () => {
  const g = normalizeDraft({ title: 'a\u0000b\uDC00c\uD83D', description: '😀', rounds: [{ title: 'r', questions: [{ prompt: 'p\u0000', options: ['x\uD800y'], imageUrl: '  ' }] }] })!;
  assert.equal(g.title, 'ab�c�');
  assert.equal(g.description, '😀');
  const q = g.rounds[0]!.questions[0]!;
  assert.equal(q.prompt, 'p');
  assert.deepEqual(q.options, ['x�y']);
  assert.equal('imageUrl' in q, true, 'spaces are kept as typed; the editor trims');

  const a = await newUser();
  const rec = await createGame(db, a.id, g, 'new');
  assert.equal((await getGame(db, a.id, rec.id))!.game.title, 'ab�c�', 'Postgres takes the cleaned text');

  assert.throws(() => normalizeDraft({ title: 'x'.repeat(301) }), TooLong);
  assert.throws(() => normalizeDraft({ rounds: Array.from({ length: 41 }, () => ({})) }), TooLong);
  const url = (n: number) => ({ rounds: [{ questions: [{ imageUrl: 'https://x/' + 'a'.repeat(n - 10) }] }] });
  assert.equal(normalizeDraft(url(LIMITS.imageUrlMax))!.rounds[0]!.questions[0]!.imageUrl!.length, LIMITS.imageUrlMax);
  assert.throws(() => normalizeDraft(url(LIMITS.imageUrlMax + 1)), TooLong);
  assert.equal(normalizeDraft({ rounds: [{ questions: [{ imageUrl: '' }] }] })!.rounds[0]!.questions[0]!.imageUrl, undefined);
});

test('a question bank: a draft keeps how many questions a room draws, drops a draw that is not a count, and saves and copies carry it', async () => {
  const round = (draw: unknown) => ({ rounds: [{ title: 'r', draw, questions: [{ prompt: 'a' }, { prompt: 'b' }, { prompt: 'c' }] }] });
  assert.equal(normalizeDraft(round(2))!.rounds[0]!.draw, 2);
  assert.equal(normalizeDraft(round(9))!.rounds[0]!.draw, 9, 'more than the round has stays as typed: validateGame holds it to the round');
  assert.equal(normalizeDraft(round(5000))!.rounds[0]!.draw, 200, 'never more than a round can keep');
  for (const junk of [0, -1, 1.5, '3', null, undefined, true, NaN, Infinity, {}, [2]]) {
    assert.equal('draw' in normalizeDraft(round(junk))!.rounds[0]!, false, String(JSON.stringify(junk)));
  }
  assert.equal('draw' in normalizeDraft({ rounds: [{ questions: [{ prompt: 'a' }] }] })!.rounds[0]!, false, 'a plain round stays plain');

  const a = await newUser();
  const banked = (draw: number) => ({ ...sample(), rounds: sample().rounds.map((r, i) => (i === 0 ? { ...r, draw } : r)) });
  const rec = await createGame(db, a.id, normalizeDraft(banked(1))!, 'new');
  assert.equal((await getGame(db, a.id, rec.id))!.game.rounds[0]!.draw, 1);
  assert.equal('draw' in (await getGame(db, a.id, rec.id))!.game.rounds[1]!, false);
  const saved = await saveGame(db, a.id, rec.id, normalizeDraft(banked(2))!, rec.version);
  assert.ok(saved.ok);
  assert.equal((await getGame(db, a.id, rec.id))!.game.rounds[0]!.draw, 2);
  assert.equal((await copyGame(db, a.id, rec.id))!.game.rounds[0]!.draw, 2);
});

test('a cover keeps only known colors, pictures and one emoji, and goes along with saves, shares and copies', async () => {
  assert.deepEqual(normalizeDraft({ cover: { color: 'sky', emoji: ' 🚀 ', art: 'nope' } })!.cover, { color: 'sky', emoji: '🚀' });
  assert.deepEqual(normalizeDraft({ cover: { emoji: '👩🏽\u{200D}💻', art: 'party' } })!.cover, { emoji: '👩🏽\u{200D}💻', art: 'party' });
  for (const junk of ['sky', [], {}, { color: 'SKY', emoji: 'a', art: 1 }, { emoji: '🚀🚀' }, { emoji: '🚀x' }]) {
    assert.equal('cover' in normalizeDraft({ cover: junk })!, false, JSON.stringify(junk));
  }
  assert.deepEqual(sample().cover, { art: 'icebreaker' }, 'the built-in games come with a drawing');

  const [a, b] = [await newUser(), await newUser()];
  const g = await createGame(db, a.id, { ...sample(), cover: { color: 'pink', emoji: '🎉' } }, 'new');
  assert.deepEqual((await getGame(db, a.id, g.id))!.game.cover, { color: 'pink', emoji: '🎉' });
  const saved = await saveGame(db, a.id, g.id, { ...g.game, cover: { art: 'thailand' } }, g.version);
  assert.ok(saved.ok);
  assert.deepEqual((await getGame(db, a.id, g.id))!.game.cover, { art: 'thailand' });
  assert.deepEqual((await copyGame(db, a.id, g.id))!.game.cover, { art: 'thailand' });

  const shared = await shareGame(db, a, g.id);
  assert.ok(shared.ok);
  assert.deepEqual(shared.entry.game.cover, { art: 'thailand' });
  assert.deepEqual((await copyEntry(db, b.id, shared.entry.id))!.game.cover, { art: 'thailand' });

  // taking the cover off leaves no trace of it
  const { cover: _, ...bare } = g.game;
  assert.ok((await saveGame(db, a.id, g.id, bare, saved.version)).ok);
  assert.equal('cover' in (await getGame(db, a.id, g.id))!.game, false);
});

test('clip cuts between characters', () => {
  assert.equal(clip('abc', 5), 'abc');
  assert.equal(clip('a😀b', 2), 'a');
  assert.equal(clip('กำ', 1), '', 'a Thai vowel stays with its consonant');
});

test("a copy's title stays within the editor's limit", async () => {
  const a = await newUser();
  const long = { ...sample(), title: '😀'.repeat(LIMITS.titleMax / 2) };
  const g = await createGame(db, a.id, long, 'new');
  const copy = (await copyGame(db, a.id, g.id))!;
  assert.ok(copy.game.title.length <= LIMITS.titleMax, `${copy.game.title.length}`);
  assert.ok(copy.game.title.endsWith(' (สำเนา)'));
  assert.ok(!/[\uD800-\uDBFF]$/.test(copy.game.title.replace(' (สำเนา)', '')));
});

test('nobody passes the game quota by sending two requests at once', async () => {
  const a = await newUser();
  await db.query(
    `INSERT INTO ib_games (id, owner_id, title, data, origin)
     SELECT 'q-' || $1 || '-' || i, $1, 't', '{"title":"t","rounds":[]}'::jsonb, 'new' FROM generate_series(1, $2::int) i`,
    [a.id, MAX_GAMES_PER_USER - 1],
  );
  const results = await Promise.allSettled([createGame(db, a.id, draft('one'), 'new'), createGame(db, a.id, draft('two'), 'new')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  assert.ok(failed.reason instanceof TooManyGames);
  await assert.rejects(copyGame(db, a.id, `q-${a.id}-1`), TooManyGames);
});

test('an old editor link to a moved browser game finds the saved game', async () => {
  const [a, b] = [await newUser(), await newUser()];
  assert.equal(await findLocalGame(db, a.id, 'g-moved'), null);
  const { id } = await importLocalGame(db, a.id, 'g-moved', sample());
  assert.equal(await findLocalGame(db, a.id, 'g-moved'), id);
  assert.equal(await findLocalGame(db, b.id, 'g-moved'), null, "only the owner's");
});

test('the tables live in our own schema, never in public, and only a safe schema name is used', async () => {
  const where = await db.query<{ table_schema: string; n: number }>(
    "SELECT table_schema, count(*)::int AS n FROM information_schema.tables WHERE table_name LIKE 'ib\\_%' GROUP BY 1",
  );
  assert.deepEqual(where, [{ table_schema: 'icebreaker', n: 10 }]);
  const [owner] = await db.query<{ owner: string }>("SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'icebreaker'");
  assert.ok(owner, 'migrate made the schema');

  // a schema someone already made (the server's) is used as it is, without needing the right to create one
  const other = await openPglite(undefined, 'icebreaker_other');
  try {
    await other.exec('CREATE SCHEMA icebreaker_other; CREATE TABLE public.not_ours (x int)');
    await migrate(other);
    assert.deepEqual(await other.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"), [{ table_name: 'not_ours' }]);
    assert.equal((await other.query('SELECT * FROM ib_schema'))[0]?.version, SCHEMA_VERSION);
  } finally {
    await other.close();
  }

  for (const bad of ['public', 'pg_temp', 'information_schema', 'Icebreaker', 'ice-breaker', 'x;DROP TABLE y', '', '1st']) {
    assert.throws(() => checkSchemaName(bad), /use our own/, bad);
    await assert.rejects(openPglite(undefined, bad), /use our own/, bad);
  }
  await withEnv({ IB_DB_SCHEMA: 'public' }, () => assert.rejects(connectPostgres('postgres://nobody@127.0.0.1:1/none'), /use our own/));
  withEnv({ IB_DB_SCHEMA: undefined }, () => assert.equal(dbSchema(), 'icebreaker'));
  withEnv({ IB_DB_SCHEMA: ' ib_demo ' }, () => assert.equal(dbSchema(), 'ib_demo'));
});

test('upgrading a v1 database fills in lineage and holds for takedowns made before', async () => {
  const old = await openPglite(undefined, 'icebreaker');
  try {
    await migrate(old, 1);
    await old.exec(`
      INSERT INTO ib_users (id, issuer, subject, display_name) VALUES ('ua', 't', 'a', 'A'), ('ub', 't', 'b', 'B');
      INSERT INTO ib_games (id, owner_id, title, data, origin, origin_ref) VALUES
        ('g0', 'ua', 't', '{}', 'new', NULL),
        ('g1', 'ua', 't', '{}', 'copy', 'g0'),
        ('g2', 'ub', 't', '{}', 'catalog', 'e1'),
        ('g3', 'ub', 't', '{}', 'copy', 'g2'),
        ('g4', 'ub', 't', '{}', 'copy', 'gone'),
        ('h0', 'ua', 't', '{}', 'sample', NULL);
      INSERT INTO ib_catalog_entries (id, game_id, author_id, author_name, title, data, status, hidden_reason) VALUES
        ('e1', 'g1', 'ua', 'A', 't', '{}', 'hidden', 'confidential'),
        ('e3', 'g3', 'ub', 'B', 't', '{}', 'listed', NULL),
        ('eh', 'h0', 'ua', 'A', 't', '{}', 'listed', NULL);
    `);
    await migrate(old);
    const games = Object.fromEntries(
      (await old.query<{ id: string; ancestors: string[] }>('SELECT id, ancestors FROM ib_games')).map((r) => [r.id, r.ancestors]),
    );
    assert.deepEqual(games, { g0: [], g1: ['g0'], g2: ['g0', 'g1', 'e1'], g3: ['g0', 'g1', 'e1', 'g2'], g4: ['gone'], h0: [] });
    const entries = Object.fromEntries(
      (await old.query<{ id: string; source_game: string; ancestors: string[]; hold: string[] | null }>('SELECT id, source_game, ancestors, hold FROM ib_catalog_entries')).map(
        (r) => [r.id, { source: r.source_game, ancestors: r.ancestors, hold: r.hold }],
      ),
    );
    assert.deepEqual(entries, {
      e1: { source: 'g1', ancestors: ['g0'], hold: ['e1', 'g1', 'g0'] },
      e3: { source: 'g3', ancestors: ['g0', 'g1', 'e1', 'g2'], hold: null },
      eh: { source: 'h0', ancestors: [], hold: null },
    });
    // a copy that was still listed comes down with the takedown it descends from
    const status = Object.fromEntries(
      (await old.query<{ id: string; status: string; hidden_reason: string | null; held_by: string | null }>(
        'SELECT id, status, hidden_reason, held_by FROM ib_catalog_entries',
      )).map((r) => [r.id, [r.status, r.hidden_reason, r.held_by]]),
    );
    assert.deepEqual(status, {
      e1: ['hidden', 'confidential', 'e1'],
      e3: ['hidden', 'copy_of_hidden', 'e1'],
      eh: ['listed', null, null],
    });
    for (const [owner, id, held] of [
      ['ua', 'g0', true],
      ['ua', 'g1', true],
      ['ub', 'g2', true],
      ['ub', 'g3', true],
      ['ub', 'g4', false],
      ['ua', 'h0', false],
    ] as const) {
      assert.equal((await getGame(old, owner, id))!.held, held, id);
    }
    await migrate(old); // nothing left to do
  } finally {
    await old.close();
  }
});

test('drafts are coerced into the game shape; junk is refused', () => {
  assert.equal(normalizeDraft(null), null);
  assert.equal(normalizeDraft([1, 2]), null);
  assert.equal(normalizeDraft('game'), null);
  const g = normalizeDraft({ title: 5, rounds: [{ questions: [{ type: 'evil', options: [1, 'b'], correct: [0, 9, 'x'], timeLimitS: 'NaN' }] }, 'junk'] })!;
  assert.equal(g.title, '');
  assert.equal(g.rounds.length, 1);
  const q = g.rounds[0]!.questions[0]!;
  assert.equal(q.type, 'quiz');
  assert.deepEqual(q.options, ['', 'b']);
  assert.deepEqual(q.correct, [0]);
  assert.equal(q.timeLimitS, 20);
});

test('sessions end after 8 idle hours or 7 days, and only a hash is stored', async () => {
  const a = await newUser('Sess');
  const t0 = new Date('2026-01-01T09:00:00Z');
  const token = await createSession(db, a.id, t0);
  const rows = await db.query<{ id_hash: string }>('SELECT id_hash FROM ib_sessions WHERE user_id = $1', [a.id]);
  assert.notEqual(rows[0]!.id_hash, token);

  assert.equal((await findSession(db, token, new Date(t0.getTime() + 60_000)))?.name, 'Sess');
  // used every 7 hours, it lasts until day 7 and no longer
  let t = t0.getTime();
  for (let i = 0; i < 23; i++) {
    t += 7 * 3600_000;
    assert.ok(await findSession(db, token, new Date(t)), `still valid at +${(t - t0.getTime()) / 3600_000} h`);
  }
  assert.equal(await findSession(db, token, new Date(t0.getTime() + 7 * 24 * 3600_000)), null);

  const idle = await createSession(db, a.id, t0);
  assert.equal(await findSession(db, idle, new Date(t0.getTime() + IDLE_MS)), null);
  assert.equal(await findSession(db, 'not-a-token', t0), null);

  await db.query('UPDATE ib_users SET disabled = true WHERE id = $1', [a.id]);
  const late = await createSession(db, a.id, t0);
  assert.equal(await findSession(db, late, t0), null, 'a disabled user is logged out');
});

test('two session cookies with our name mean nobody is logged in', () => {
  const req = (cookie: string) => new Request('http://x/api', { headers: { cookie } });
  assert.deepEqual(parseCookies('a=1; b=2; a=3').get('a'), ['1', '3']);
  assert.deepEqual(sessionToken(req('ib_sid=abc; other=1')), { token: 'abc', duplicate: false });
  assert.deepEqual(sessionToken(req('ib_sid=abc; ib_sid=planted')), { token: null, duplicate: true });
});

test('changes need our header and same-origin fetch metadata; bodies are JSON and capped', async () => {
  const req = (headers: Record<string, string>, body = '{}') => new Request('http://x/api', { method: 'POST', headers, body });
  const code = (fn: () => unknown) => {
    try {
      fn();
      return 'ok';
    } catch (e) {
      return e instanceof HttpError ? e.code : 'other';
    }
  };
  assert.equal(code(() => guardMutation(req({}))), 'forbidden');
  assert.equal(code(() => guardMutation(req({ 'x-ib-req': '1', 'sec-fetch-site': 'cross-site' }))), 'forbidden');
  assert.equal(code(() => guardMutation(req({ 'x-ib-req': '1', 'sec-fetch-site': 'same-site' }))), 'forbidden');
  assert.equal(code(() => guardMutation(req({ 'x-ib-req': '1', 'sec-fetch-site': 'same-origin' }))), 'ok');

  await assert.rejects(readJson(req({ 'content-type': 'text/plain' })), (e: HttpError) => e.code === 'json_required');
  await assert.rejects(readJson(req({ 'content-type': 'application/json' }, '[1]')), (e: HttpError) => e.code === 'bad_json');
  await assert.rejects(readJson(req({ 'content-type': 'application/json' }, JSON.stringify({ a: 'x'.repeat(2000) })), 1000), (e: HttpError) => e.code === 'too_large');
  assert.deepEqual(await readJson(req({ 'content-type': 'application/json' }, '{"a":1}')), { a: 1 });
});

test('a page bound to one account is refused once another login replaced the session', async () => {
  const env = process.env as Record<string, string | undefined>;
  const g = globalThis as { __ibDb?: Promise<Db> };
  const saved = { mode: env.AUTH_MODE, node: env.NODE_ENV, db: g.__ibDb };
  try {
    env.AUTH_MODE = 'mock';
    env.NODE_ENV = 'development';
    g.__ibDb = Promise.resolve(db);
    const [a, b] = [await newUser('A'), await newUser('B')];
    const token = await createSession(db, b.id); // b logged in from another tab
    const req = (headers: Record<string, string>) => new Request('http://x/api', { headers: { cookie: `ib_sid=${token}`, ...headers } });
    assert.equal((await requireUser(req({}))).id, b.id, 'a request without a page user acts as the session');
    assert.equal((await requireUser(req({ 'x-ib-user': b.id }))).id, b.id);
    await assert.rejects(requireUser(req({ 'x-ib-user': a.id })), (e: HttpError) => e.status === 409 && e.code === 'wrong_user');
    await assert.rejects(requireUser(new Request('http://x/api', { headers: { 'x-ib-user': a.id } })), (e: HttpError) => e.code === 'login_required');
  } finally {
    g.__ibDb = saved.db;
    if (saved.mode === undefined) delete env.AUTH_MODE;
    else env.AUTH_MODE = saved.mode;
    if (saved.node === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved.node;
  }
});

/** Runs `fn` with these env values (undefined deletes one), then puts the old ones back. */
/** Runs fn with these environment variables (undefined: unset), then puts them back, after the promise if fn returns one. */
function withEnv<R>(values: Record<string, string | undefined>, fn: () => R): R {
  const env = process.env as Record<string, string | undefined>;
  const saved = Object.fromEntries(Object.keys(values).map((k) => [k, env[k]]));
  const put = (vals: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(vals)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  };
  put(values);
  let result: R;
  try {
    result = fn();
  } catch (e) {
    put(saved);
    throw e;
  }
  if (result instanceof Promise) return result.finally(() => put(saved)) as R;
  put(saved);
  return result;
}

/** A fresh data folder, holding var/auth-mode when `mode` is given. */
const dataFolders: string[] = [];
function dataFolder(mode?: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ib-var-'));
  dataFolders.push(dir);
  if (mode !== undefined) writeFileSync(path.join(dir, 'auth-mode'), mode);
  return dir;
}
after(() => dataFolders.forEach((d) => rmSync(d, { recursive: true, force: true })));

test('mock login is refused in production', () => {
  withEnv({ AUTH_MODE: 'mock', NODE_ENV: 'development', IB_DATA_DIR: dataFolder() }, () => {
    assert.equal(authMode(), 'mock');
    (process.env as Record<string, string>).NODE_ENV = 'production';
    assert.equal(authMode(), 'off');
    delete process.env.AUTH_MODE;
    assert.equal(authMode(), 'off', 'off unless asked');
    assert.deepEqual(authModeSource(), { raw: 'off', from: 'default' });
  });
});

test('the login mode can come from var/auth-mode, and AUTH_MODE wins over it', () => {
  const local = dataFolder(' Local\n');
  withEnv({ AUTH_MODE: undefined, NODE_ENV: 'production', IB_DATA_DIR: local }, () => {
    assert.equal(authMode(), 'local');
    assert.deepEqual(authModeSource(), { raw: 'Local', from: 'var/auth-mode' });
    process.env.AUTH_MODE = 'off';
    assert.equal(authMode(), 'off', 'the environment wins');
    delete process.env.AUTH_MODE;
    // read once per process: a change applies after a restart
    writeFileSync(path.join(local, 'auth-mode'), 'off');
    assert.equal(authMode(), 'local');

    process.env.IB_DATA_DIR = dataFolder('mock');
    assert.equal(authMode(), 'off', 'mock is refused in production from the file too');
    assert.match(authModeProblem(authModeSource()) ?? '', /^var\/auth-mode=mock is refused in production$/);
    process.env.IB_DATA_DIR = dataFolder('lcoal');
    assert.equal(authMode(), 'off', 'a typo turns accounts off rather than on');
    assert.match(authModeProblem(authModeSource()) ?? '', /^unknown var\/auth-mode "lcoal"/);
    process.env.IB_DATA_DIR = dataFolder('');
    assert.deepEqual(authModeSource(), { raw: 'off', from: 'default' }, 'an empty file is no file');
    assert.equal(authModeProblem(authModeSource()), null);
  });
});

test('mock login: the old env-only checks still hold', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { mode: env.AUTH_MODE, node: env.NODE_ENV };
  try {
    env.AUTH_MODE = 'mock';
    env.NODE_ENV = 'development';
    assert.equal(authMode(), 'mock');
    env.NODE_ENV = 'production';
    assert.equal(authMode(), 'off');
  } finally {
    if (saved.mode === undefined) delete env.AUTH_MODE;
    else env.AUTH_MODE = saved.mode;
    if (saved.node === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved.node;
  }
});

test('local passwords: scrypt hashes that differ every time, and a generated password reads clearly', async () => {
  const h1 = await hashPassword('correct horse battery');
  const h2 = await hashPassword('correct horse battery');
  assert.match(h1, /^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
  assert.notEqual(h1, h2, 'a fresh salt each time');
  assert.equal(await verifyPassword('correct horse battery', h1), true);
  assert.equal(await verifyPassword('correct horse batterY', h1), false);
  assert.equal(await verifyPassword('x', 'garbage'), false);
  const p = generatePassword();
  assert.match(p, /^[a-km-np-zA-HJ-KM-NP-Z2-9]{16}$/);
  assert.equal(normalizeUsername('  Admin.Test '), 'admin.test');
  for (const bad of ['ab', '-x1', 'มีไทย', 'a b c', 'x'.repeat(33), 42]) assert.equal(normalizeUsername(bad), null, String(bad));
});

test('local login: right password in any username case, one answer for wrong name or password, a lockout, and disabled accounts', async () => {
  resetLoginThrottle();
  const made = await db.tx((sql) => createLocalUser(sql, { username: 'Tester1', name: 'คุณทดสอบ', password: 'a-good-password', curator: true }));
  assert.equal(made.isCurator, true);
  await assert.rejects(db.tx((sql) => createLocalUser(sql, { username: 'tester1', name: 'อีกคน', password: 'a-good-password' })), (e: HttpError) => e.code === 'username_taken');
  await assert.rejects(db.tx((sql) => createLocalUser(sql, { username: 'tester2', name: 'สั้น', password: 'short' })), (e: HttpError) => e.code === 'password_too_short');

  const ok = await checkLocalLogin(db, 'TESTER1', 'a-good-password');
  assert.deepEqual(ok, { ...made, email: null });
  for (const [u, p] of [['tester1', 'wrong-password'], ['nobody-here', 'a-good-password'], ['tester1', ''], [null, 'x']] as const) {
    await assert.rejects(checkLocalLogin(db, u, p), (e: HttpError) => e.status === 401 && e.code === 'bad_login', `${u}/${p}`);
  }
  // 5 wrong tries (one above), then even the right password waits
  for (let i = 0; i < 4; i++) await assert.rejects(checkLocalLogin(db, 'tester1', 'wrong'), (e: HttpError) => e.code === 'bad_login');
  await assert.rejects(checkLocalLogin(db, 'tester1', 'a-good-password'), (e: HttpError) => e.status === 429 && e.code === 'too_many_tries');
  // 15 minutes later it lets the right password in again
  assert.equal((await checkLocalLogin(db, 'tester1', 'a-good-password', Date.now() + 16 * 60_000)).id, made.id);

  // a reset ends every session and only the new password works
  const token = await createSession(db, made.id);
  assert.ok(await findSession(db, token));
  assert.equal(await db.tx((sql) => setLocalPassword(sql, 'Tester1', 'the-new-password')), true);
  assert.equal(await findSession(db, token), null, 'logged out everywhere');
  await assert.rejects(checkLocalLogin(db, 'tester1', 'a-good-password'), (e: HttpError) => e.code === 'bad_login');
  assert.equal((await checkLocalLogin(db, 'tester1', 'the-new-password')).id, made.id);
  assert.equal(await db.tx((sql) => setLocalPassword(sql, 'nobody-here', 'the-new-password')), false);

  await db.query('UPDATE ib_users SET disabled = true WHERE id = $1', [made.id]);
  await assert.rejects(checkLocalLogin(db, 'tester1', 'the-new-password'), (e: HttpError) => e.status === 403 && e.code === 'account_disabled');
  // a mock or company login with the same name is someone else
  const other = await upsertUser(db, { issuer: 'mock', subject: 'tester1', name: 'tester1' });
  assert.notEqual(other.id, made.id);
  resetLoginThrottle();
});

test('local login is allowed in production, unlike mock', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { mode: env.AUTH_MODE, node: env.NODE_ENV };
  try {
    env.AUTH_MODE = ' Local ';
    env.NODE_ENV = 'production';
    assert.equal(authMode(), 'local');
  } finally {
    if (saved.mode === undefined) delete env.AUTH_MODE;
    else env.AUTH_MODE = saved.mode;
    if (saved.node === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved.node;
  }
});

test('password hashing runs at most 2 at a time and still answers every caller', async () => {
  const hashes = await Promise.all(Array.from({ length: 7 }, (_, i) => hashPassword(`password-number-${i}`)));
  assert.equal(new Set(hashes).size, 7);
  const checks = await Promise.all(hashes.map((h, i) => verifyPassword(`password-number-${i}`, h)));
  assert.deepEqual(checks, Array(7).fill(true));
});

// ---------- exam links ----------

/** a complete game with two topics an exam can ask from, and questions an exam leaves out */
const examGame = (title = 'ข้อสอบความปลอดภัย'): Game => ({
  id: 'x',
  title,
  rounds: [
    {
      id: 'r1',
      title: 'พื้นฐาน',
      questions: [
        { id: 'q1', type: 'quiz', prompt: 'รหัสผ่านแบบไหนปลอดภัยที่สุด', options: ['123456', 'ชื่อตัวเอง', 'วลียาวที่เดายาก', 'วันเกิด'], correct: [2], timeLimitS: 20, explanation: 'ยิ่งยาวยิ่งเดายาก' },
        { id: 'q2', type: 'truefalse', prompt: 'ควรใช้รหัสผ่านเดียวกันทุกเว็บ', options: ['จริง', 'เท็จ'], correct: [1], timeLimitS: 10 },
        { id: 'q3', type: 'poll', prompt: 'คุณใช้ password manager ไหม', options: ['ใช้', 'ไม่ใช้'], correct: [], timeLimitS: 20 },
      ],
    },
    {
      id: 'r2',
      title: 'ขั้นตอน',
      questions: [
        { id: 'q4', type: 'puzzle', prompt: 'เรียงขั้นตอนเมื่อเจออีเมลหลอกลวง', options: ['หยุดก่อน', 'ตรวจผู้ส่ง', 'แจ้งทีม'], correct: [], timeLimitS: 30 },
        { id: 'q5', type: 'type', prompt: 'MFA ย่อมาจากอะไร', options: ['multi-factor authentication'], correct: [], timeLimitS: 30 },
        { id: 'q6', type: 'quiz', prompt: 'เจอ USB ตกอยู่ควรทำอย่างไร', options: ['เสียบดู', 'ส่งให้ทีม IT'], correct: [1], timeLimitS: 20 },
      ],
    },
  ],
});

const linkOf = async (user: SessionUser, gameId: string) => {
  const res = await publishExam(db, user, gameId);
  assert.ok(res.ok, `publish refused: ${!res.ok && res.reason}`);
  return res;
};
const examReason = async (user: SessionUser, gameId: string) => {
  const res = await publishExam(db, user, gameId);
  return res.ok ? 'ok' : res.reason;
};

test('an exam link serves a frozen copy: edits wait for an update, and the link survives it', async () => {
  const a = await newUser();
  const g = await createGame(db, a.id, examGame(), 'new');
  assert.equal(g.exam, null);
  assert.equal(await getExamLink(db, a.id, g.id), null);

  const opened = await linkOf(a, g.id);
  assert.equal(opened.created, true);
  assert.match(opened.link.id, /^[\w-]{22}$/);
  assert.notEqual(opened.link.id, g.id, 'the link is not the game id: knowing one gives nothing of the other');
  assert.deepEqual([opened.link.rev, opened.link.questionCount, opened.link.topicCount], [1, 3, 2]);
  assert.deepEqual(await getExamLink(db, a.id, g.id), opened.link);
  assert.deepEqual((await getGame(db, a.id, g.id))!.exam, { id: opened.link.id, stale: false });
  assert.deepEqual((await listGames(db, a.id)).find((x) => x.id === g.id)!.exam, { id: opened.link.id, stale: false });

  // anyone holding the link reads the paper: only what an exam asks, topic by topic
  const first = (await readExam(db, opened.link.id))!;
  assert.equal(first.paper.title, 'ข้อสอบความปลอดภัย');
  assert.deepEqual(
    first.paper.topics.map((t) => [t.title, t.questions.map((q) => q.id)]),
    [
      // validateGame names questions by where they stand: round 1 question 1, …
      ['พื้นฐาน', ['q1-1', 'q1-2']],
      ['ขั้นตอน', ['q2-3']],
    ],
  );
  assert.equal(first.paper.topics[0]!.questions[0]!.explanation, 'ยิ่งยาวยิ่งเดายาก');
  const out = JSON.stringify(first);
  for (const hidden of ['password manager', 'หยุดก่อน', 'multi-factor', g.id, a.id]) assert.ok(!out.includes(hidden), `"${hidden}" stays out of the paper`);

  // the owner edits the game: the link keeps serving the copy and says it is behind
  const edited = examGame('ข้อสอบความปลอดภัย v2');
  edited.rounds[0]!.questions[0]!.prompt = 'แก้แล้ว';
  const saved = await saveGame(db, a.id, g.id, edited, g.version);
  assert.ok(saved.ok);
  assert.deepEqual((await getGame(db, a.id, g.id))!.exam, { id: opened.link.id, stale: true });
  assert.deepEqual((await readExam(db, opened.link.id))!.paper, first.paper);

  // an update brings the copy up to date behind the same link
  const updated = await linkOf(a, g.id);
  assert.equal(updated.created, false);
  assert.equal(updated.link.id, opened.link.id);
  assert.equal(updated.link.rev, 2);
  const second = (await readExam(db, opened.link.id))!;
  assert.equal(second.rev, 2);
  assert.equal(second.paper.title, 'ข้อสอบความปลอดภัย v2');
  assert.equal(second.paper.topics[0]!.questions[0]!.prompt, 'แก้แล้ว');
  assert.deepEqual((await getGame(db, a.id, g.id))!.exam, { id: opened.link.id, stale: false });
  assert.equal((await db.query('SELECT 1 FROM ib_exams WHERE game_id = $1', [g.id])).length, 1, 'one link per game');

  // closing ends it at once; opening again gives a new link, so an old one never comes back to life
  assert.equal(await closeExam(db, a, g.id), true);
  assert.equal(await readExam(db, opened.link.id), null);
  assert.equal((await getGame(db, a.id, g.id))!.exam, null);
  assert.equal(await closeExam(db, a, g.id), false, 'nothing left to close');
  const reopened = await linkOf(a, g.id);
  assert.equal(reopened.created, true);
  assert.notEqual(reopened.link.id, opened.link.id);
  assert.equal(await readExam(db, opened.link.id), null);

  const log = await db.query<{ action: string }>("SELECT action FROM ib_audit_log WHERE user_id = $1 AND action LIKE 'exam.%' ORDER BY id", [a.id]);
  assert.deepEqual(
    log.map((r) => r.action),
    ['exam.open', 'exam.update', 'exam.close', 'exam.open'],
  );
});

test("only the owner opens, updates or closes a game's exam link", async () => {
  const [a, b] = [await newUser(), await newUser()];
  const g = await createGame(db, a.id, examGame(), 'new');
  assert.equal(await examReason(b, g.id), 'not_found');
  const { link } = await linkOf(a, g.id);
  assert.equal(await examReason(b, g.id), 'not_found');
  assert.equal(await closeExam(db, b, g.id), false);
  assert.equal(await getExamLink(db, b.id, g.id), null);
  assert.equal((await readExam(db, link.id))!.rev, 1, 'untouched by the other user');
  // a game id, a made-up id and junk are no links
  for (const nope of [g.id, 'A'.repeat(22), '', "x' OR '1'='1"]) assert.equal(await readExam(db, nope), null, nope);
});

test('a link needs a complete game with at least one question an exam can ask', async () => {
  const a = await newUser();
  const half = await createGame(db, a.id, draft('half done'), 'new');
  const refused = await publishExam(db, a, half.id);
  assert.equal(!refused.ok && refused.reason, 'invalid');
  assert.ok(!refused.ok && refused.reason === 'invalid' && refused.errors.length > 0);

  const pollsOnly = examGame('แบบสำรวจ');
  pollsOnly.rounds = [{ id: 'r1', title: 'ถามความเห็น', questions: [pollsOnly.rounds[0]!.questions[2]!] }];
  assert.ok(validateGame(pollsOnly).ok, 'a complete game, just not an exam');
  const g = await createGame(db, a.id, pollsOnly, 'new');
  assert.equal(await examReason(a, g.id), 'no_questions');
  assert.equal((await getGame(db, a.id, g.id))!.exam, null);

  // an open link is left as it was when the game later stops being complete
  const good = await createGame(db, a.id, examGame(), 'new');
  const { link } = await linkOf(a, good.id);
  const broken = examGame();
  broken.rounds[0]!.questions[0]!.prompt = '';
  assert.ok((await saveGame(db, a.id, good.id, broken, good.version)).ok);
  assert.equal(await examReason(a, good.id), 'invalid');
  const still = (await readExam(db, link.id))!;
  assert.equal(still.rev, 1);
  assert.equal(still.paper.topics[0]!.questions[0]!.prompt, 'รหัสผ่านแบบไหนปลอดภัยที่สุด');
});

test('a paper from a Pika game goes out without the page it came from or the explanation written from it', async () => {
  const a = await newUser();
  const fromWiki = examGame('ควิซจากคลังความรู้');
  fromWiki.rounds[0]!.questions[0] = {
    ...fromWiki.rounds[0]!.questions[0]!,
    explanation: 'ประโยคลับจากหน้าในคลังความรู้',
    source: { path: 'topics/secret-policy.md', title: 'นโยบายภายใน', cite: 'เอกสารภายใน 2026' },
  };
  fromWiki.rounds[0]!.questions[1] = { ...fromWiki.rounds[0]!.questions[1]!, explanation: 'พิมพ์เองกับมือ' };
  const g = await createPikaGame(db, a.id, normalizeDraft(fromWiki)!, 'project-1');
  assert.equal(g.tainted, true);
  assert.equal(g.game.rounds[0]!.questions[0]!.source?.path, 'topics/secret-policy.md', 'the owner keeps it');

  // unlike the public catalog, a link is allowed: it shows what a room would see, to whoever was handed it
  const { link } = await linkOf(a, g.id);
  const exam = (await readExam(db, link.id))!;
  const [q1, q2] = exam.paper.topics[0]!.questions;
  assert.equal(q1!.explanation, undefined);
  assert.equal(q2!.explanation, 'พิมพ์เองกับมือ');
  // neither in what is served nor in what is stored
  const [row] = await db.query<{ data: unknown }>('SELECT data FROM ib_exams WHERE id = $1', [link.id]);
  for (const text of [JSON.stringify(exam), JSON.stringify(row!.data)]) {
    for (const secret of ['ประโยคลับ', 'secret-policy', 'นโยบายภายใน', 'เอกสารภายใน']) assert.ok(!text.includes(secret), secret);
  }
  // and a row that somehow held them would still be cut on the way out
  await db.query('UPDATE ib_exams SET data = $2 WHERE id = $1', [link.id, JSON.stringify(g.game)]);
  const again = JSON.stringify(await readExam(db, link.id));
  for (const secret of ['ประโยคลับ', 'secret-policy', 'นโยบายภายใน', 'เอกสารภายใน']) assert.ok(!again.includes(secret), secret);
});

test('a link goes with its game, and with its owner', async () => {
  const a = await newUser();
  const g = await createGame(db, a.id, examGame(), 'new');
  const { link } = await linkOf(a, g.id);
  assert.ok(await readExam(db, link.id));
  assert.ok(await deleteGame(db, a.id, g.id));
  assert.equal(await readExam(db, link.id), null);
  assert.deepEqual(await db.query('SELECT 1 FROM ib_exams WHERE id = $1', [link.id]), []);

  const gone = await newUser();
  const g2 = await createGame(db, gone.id, examGame(), 'new');
  const second = await linkOf(gone, g2.id);
  await db.query('DELETE FROM ib_users WHERE id = $1', [gone.id]);
  assert.equal(await readExam(db, second.link.id), null);
});

test('a takedown closes the way through a link too: no new link, and an open one stops answering', async () => {
  const [a, b] = [await newUser(), await newUser()];
  const g = await createGame(db, a.id, examGame(), 'new');
  const copy = (await copyGame(db, a.id, g.id))!;
  const { link } = await linkOf(a, g.id);
  const copyLink = await linkOf(a, copy.id);
  const other = await createGame(db, b.id, examGame(), 'new');
  const otherLink = await linkOf(b, other.id);
  const entry = await shareGame(db, a, copy.id);
  assert.ok(entry.ok);

  assert.deepEqual(await reportEntry(db, b.id, entry.entry.id, 'confidential', ''), { ok: true, hidden: true });
  // the reported game and the game it was copied from are both held
  assert.equal(await readExam(db, copyLink.link.id), null);
  assert.equal(await readExam(db, link.id), null);
  assert.equal(await examReason(a, copy.id), 'under_review');
  assert.equal(await examReason(a, g.id), 'under_review');
  // someone else's exam is untouched
  assert.ok(await readExam(db, otherLink.link.id));
  assert.equal(await examReason(b, other.id), 'ok');
});

test('copying a game does not copy its link, and a copy can have its own', async () => {
  const a = await newUser();
  const g = await createGame(db, a.id, examGame(), 'new');
  const { link } = await linkOf(a, g.id);
  const copy = (await copyGame(db, a.id, g.id))!;
  assert.equal(copy.exam, null);
  const own = await linkOf(a, copy.id);
  assert.notEqual(own.link.id, link.id);
  assert.equal((await readExam(db, own.link.id))!.paper.title, copy.game.title);
});

test('every sample game with exam questions can be opened as a link, and many links open at once', async () => {
  const a = await newUser();
  const games = await Promise.all(SAMPLE_GAMES.map((s) => createGame(db, a.id, structuredClone(s), 'sample')));
  const results = await Promise.all(games.map((g) => publishExam(db, a, g.id)));
  let open = 0;
  for (const [i, res] of results.entries()) {
    const size = examSize(buildExam(SAMPLE_GAMES[i]!));
    if (size === 0) {
      assert.equal(!res.ok && res.reason, 'no_questions', SAMPLE_GAMES[i]!.id);
      continue;
    }
    assert.ok(res.ok, SAMPLE_GAMES[i]!.id);
    open++;
    assert.equal(res.link.questionCount, size);
    assert.equal(examSize((await readExam(db, res.link.id))!.paper), size);
  }
  assert.ok(open >= 3);
  // two requests for the same game at once end as one link, not two
  const g = await createGame(db, a.id, examGame(), 'new');
  const both = await Promise.all([publishExam(db, a, g.id), publishExam(db, a, g.id)]);
  assert.ok(both[0].ok && both[1].ok);
  assert.equal(both[0].ok && both[1].ok && both[0].link.id === both[1].link.id, true);
  assert.deepEqual(both.map((r) => r.ok && r.created).sort(), [false, true]);
});

test('upgrading a database from before exam links keeps its games and gives them no link', async () => {
  const old = await openPglite(undefined, 'icebreaker');
  try {
    // v3: the last schema before exam links (v4)
    await migrate(old, 3);
    assert.deepEqual(await old.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'ib_exams'"), []);
    const u = await upsertUser(old, { issuer: 'test', subject: 'before-exams', name: 'Before' });
    await old.query("INSERT INTO ib_games (id, owner_id, title, data, origin) VALUES ($1, $2, 'เกมเก่า', $3, 'new')", ['g'.repeat(22), u.id, JSON.stringify(examGame('เกมเก่า'))]);
    await migrate(old);
    assert.equal((await old.query<{ version: number }>('SELECT version FROM ib_schema'))[0]!.version, SCHEMA_VERSION);
    const [rec] = await listGames(old, u.id);
    assert.equal(rec!.game.title, 'เกมเก่า');
    assert.equal(rec!.exam, null);
    const res = await publishExam(old, u, rec!.id);
    assert.ok(res.ok && res.created);
  } finally {
    await old.close();
  }
});
