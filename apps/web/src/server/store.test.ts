import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { LIMITS, SAMPLE_GAMES, type Game } from '@icebreaker/shared';
import { requireUser, upsertUser } from './auth';
import { copyEntry, getEntry, listCatalog, reportEntry, shareGame, withdrawEntry } from './catalog';
import { authMode } from './config';
import { migrate, openPglite, type Db } from './db';
import {
  MAX_GAMES_PER_USER,
  TooLong,
  TooManyGames,
  clip,
  copyGame,
  createGame,
  deleteGame,
  findLocalGame,
  getGame,
  importLocalGame,
  listGames,
  normalizeDraft,
  saveGame,
} from './games';
import { HttpError, guardMutation, readJson } from './http';
import { IDLE_MS, createSession, findSession, parseCookies, sessionToken, type SessionUser } from './session';

let db: Db;
let n = 0;

before(async () => {
  db = await openPglite();
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

test('upgrading a v1 database fills in lineage and holds for takedowns made before', async () => {
  const old = await openPglite();
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

test('mock login is refused in production', () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { mode: env.AUTH_MODE, node: env.NODE_ENV };
  try {
    env.AUTH_MODE = 'mock';
    env.NODE_ENV = 'development';
    assert.equal(authMode(), 'mock');
    env.NODE_ENV = 'production';
    assert.equal(authMode(), 'off');
    env.AUTH_MODE = undefined;
    delete env.AUTH_MODE;
    assert.equal(authMode(), 'off', 'off unless asked');
  } finally {
    if (saved.mode === undefined) delete env.AUTH_MODE;
    else env.AUTH_MODE = saved.mode;
    if (saved.node === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved.node;
  }
});
