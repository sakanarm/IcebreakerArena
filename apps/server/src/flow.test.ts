import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { after, before, mock, test } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, Game, PlayerState, ServerToClientEvents, StageState } from '@icebreaker/shared';
import { startGameServer, type GameServer } from './server';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const GAME: Game = {
  id: 'flow',
  title: 'Flow test',
  rounds: [
    {
      id: 'r1',
      title: 'Warm-up',
      questions: [
        { id: 'a', type: 'quiz', prompt: 'Q1', options: ['A', 'B', 'C', 'D'], correct: [1], timeLimitS: 5 },
        { id: 'b', type: 'poll', prompt: 'P', options: ['x', 'y'], correct: [], timeLimitS: 5 },
      ],
    },
    {
      id: 'r2',
      title: 'Final',
      multiplier: 2,
      questions: [{ id: 'c', type: 'truefalse', prompt: 'T', options: ['จริง', 'เท็จ'], correct: [0], timeLimitS: 5 }],
    },
  ],
};

let server: GameServer;
const sockets: Client[] = [];

before(async () => {
  server = await startGameServer(0, '127.0.0.1');
});

after(async () => {
  for (const s of sockets) s.close();
  await server.close();
});

function connect(): Promise<Client> {
  const s: Client = io(`http://127.0.0.1:${server.port}`, { transports: ['websocket'], forceNew: true });
  sockets.push(s);
  return new Promise((resolve) => s.once('connect', () => resolve(s)));
}

/** Keeps the latest state pushed on `event` and lets a test wait for one that matches. */
function track<T>(socket: Client, event: 'stage:state' | 'player:state') {
  let latest: T | null = null;
  const waiters: { match: (s: T) => boolean; resolve: (s: T) => void }[] = [];
  (socket as unknown as Socket).on(event, (s: T) => {
    latest = s;
    for (const w of [...waiters]) {
      if (w.match(s)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(s);
      }
    }
  });
  return {
    get latest() {
      return latest;
    },
    until(match: (s: T) => boolean, timeoutMs = 10_000): Promise<T> {
      if (latest && match(latest)) return Promise.resolve(latest);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeoutMs);
        waiters.push({ match, resolve: (s) => (clearTimeout(timer), resolve(s)) });
      });
    },
  };
}

const sleepUntil = (epochMs: number) => new Promise((r) => setTimeout(r, Math.max(0, epochMs - Date.now()) + 30));

test('a full game runs from lobby to podium with server-side scoring', async () => {
  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const pin = created.pin;
  assert.match(pin, /^\d{6}$/);

  const join = async (nickname: string) => {
    const s = await connect();
    const state = track<PlayerState>(s, 'player:state');
    const res = await s.emitWithAck('player:join', { pin, nickname, avatar: '🦊' });
    assert.ok(res.ok);
    return { s, state, res };
  };
  const alice = await join('Alice');
  const bob = await join('Bob');
  const carol = await join('alice');
  assert.equal(carol.res.nickname, 'alice 2', 'duplicate nicknames get a number');
  await stage.until((s) => s.playerCount === 3);

  // Start shows the round card; the Host skips it
  host.emit('host:next');
  await stage.until((s) => s.phase === 'round' && s.round?.index === 0);
  host.emit('host:next');
  const q1 = (await stage.until((s) => s.phase === 'question')).question!;
  assert.equal(q1.number, 1);
  assert.equal('correct' in q1, false, 'the correct answer never reaches clients before the reveal');

  const early = await alice.s.emitWithAck('player:answer', { questionId: q1.id, choice: 1 });
  assert.deepEqual(early, { ok: false, error: 'not_open' }, 'no answers during the lead-in');

  await sleepUntil(q1.startsAt);
  assert.ok((await alice.s.emitWithAck('player:answer', { questionId: q1.id, choice: 1 })).ok);
  assert.ok((await bob.s.emitWithAck('player:answer', { questionId: q1.id, choice: 0 })).ok);
  const twice = await bob.s.emitWithAck('player:answer', { questionId: q1.id, choice: 1 });
  assert.deepEqual(twice, { ok: false, error: 'already_answered' });

  // Carol stays quiet, so the Host closes the question
  host.emit('host:skip');
  const r1 = await stage.until((s) => s.phase === 'reveal');
  assert.deepEqual(r1.reveal?.counts, [1, 1, 0, 0]);
  assert.deepEqual(r1.reveal?.correct, [1]);

  const a1 = await alice.state.until((s) => s.phase === 'reveal');
  assert.equal(a1.result?.correct, true);
  assert.ok(a1.result!.points >= 900 && a1.result!.points <= 1000, `fast answer scores near 1,000, got ${a1.result!.points}`);
  assert.equal(a1.me.rank, 1);
  assert.equal(a1.me.prevRank, null, 'no place before the first reveal');
  const b1 = await bob.state.until((s) => s.phase === 'reveal');
  assert.equal(b1.result?.correct, false);
  assert.equal(b1.result?.points, 0);
  assert.equal(b1.me.aboveNickname, 'Alice');
  assert.equal(b1.me.gapToAbove, a1.me.score);
  const c1 = await carol.state.until((s) => s.phase === 'reveal');
  assert.equal(c1.result?.answered, false);
  const sentMs = [a1.result!.responseMs!, b1.result!.responseMs!];
  assert.equal(r1.reveal?.avgMs, Math.round((sentMs[0]! + sentMs[1]!) / 2), 'the average takes the wrong answer too, not only the right one');

  host.emit('host:next');
  const lb = await stage.until((s) => s.phase === 'leaderboard');
  assert.equal(lb.leaderboard[0]?.nickname, 'Alice');
  assert.equal(lb.nextIsLast, false);

  // Q2 is a poll in the same round: no round card, and it reveals by itself once everyone has voted
  host.emit('host:next');
  const q2 = (await stage.until((s) => s.phase === 'question' && s.question?.number === 2)).question!;
  await sleepUntil(q2.startsAt);
  for (const p of [alice, bob, carol]) {
    assert.ok((await p.s.emitWithAck('player:answer', { questionId: q2.id, choice: 0 })).ok);
  }
  await stage.until((s) => s.phase === 'reveal' && s.question?.number === 2);
  const b2 = await bob.state.until((s) => s.phase === 'reveal' && s.question?.number === 2);
  assert.equal(b2.result?.points, 100);
  assert.equal(b2.result?.correct, null);

  // Carol refreshes her phone: same player, same score
  carol.s.close();
  const carolAgain = await connect();
  const carolState = track<PlayerState>(carolAgain, 'player:state');
  assert.ok((await carolAgain.emitWithAck('player:resume', { pin, token: carol.res.token })).ok);
  assert.equal((await carolState.until((s) => s.phase === 'reveal')).me.score, 100);

  // Round 2 (×2): its card moves on by itself
  host.emit('host:next');
  const lb2 = await stage.until((s) => s.phase === 'leaderboard');
  assert.equal(lb2.nextIsLast, true, 'the board before the last question says so');
  host.emit('host:next');
  const r2 = await stage.until((s) => s.phase === 'round' && s.round?.index === 1);
  assert.equal(r2.nextIsLast, false, 'only the board says it');
  const q3 = (await stage.until((s) => s.phase === 'question' && s.question?.number === 3)).question!;
  assert.equal(q3.multiplier, 2);
  assert.equal(stage.latest?.isLastQuestion, true);
  await sleepUntil(q3.startsAt);
  assert.ok((await bob.s.emitWithAck('player:answer', { questionId: q3.id, choice: 0 })).ok);
  assert.ok((await alice.s.emitWithAck('player:answer', { questionId: q3.id, choice: 1 })).ok);
  assert.ok((await carolAgain.emitWithAck('player:answer', { questionId: q3.id, choice: 1 })).ok);
  await stage.until((s) => s.phase === 'reveal' && s.question?.number === 3);
  const b3 = await bob.state.until((s) => s.phase === 'reveal' && s.question?.number === 3);
  assert.ok(b3.result!.points >= 1800, `the final round doubles points, got ${b3.result!.points}`);
  assert.equal(b3.me.rank, 1, 'Bob overtakes Alice with the ×2 final');
  assert.equal(b3.me.prevRank, 2, 'and his phone knows he came up from second');

  // after the last question, Next goes straight to the podium
  host.emit('host:next');
  const podium = await stage.until((s) => s.phase === 'podium');
  assert.deepEqual(
    podium.podium.map((r) => r.nickname),
    ['Bob', 'Alice', 'alice 2'],
  );
  assert.ok(podium.awards.some((a) => a.kind === 'fastest'));

  const late = await alice.s.emitWithAck('player:answer', { questionId: q3.id, choice: 0 });
  assert.deepEqual(late, { ok: false, error: 'not_open' });

  const report = await host.emitWithAck('host:report');
  assert.ok(report.ok);
  assert.equal(report.report.questions.length, 3);
  assert.equal(report.report.questions[0]?.correctCount, 1);
  assert.equal(report.report.players[0]?.nickname, 'Bob');
  // the poll is in the answers sent but not in the questions that can be right or wrong
  const row = (n: string) => report.report.players.find((p) => p.nickname === n);
  assert.deepEqual(
    ['Bob', 'Alice', 'alice 2'].map((n) => [row(n)?.correctCount, row(n)?.gradedCount, row(n)?.answeredCount]),
    [[1, 2, 3], [1, 2, 3], [0, 2, 2]],
  );
  // a question's average time and a player's count the same answers: every one sent, right, wrong or a vote
  const [rq1, rq2] = report.report.questions;
  assert.equal(rq1?.avgMs, r1.reveal?.avgMs, 'the report says what the reveal said');
  assert.notEqual(rq2?.avgMs, null, 'a poll has an average time too');
  const total = (rows: { avgMs: number | null; n: number }[]) => rows.reduce((sum, r) => sum + (r.avgMs ?? 0) * r.n, 0);
  const byQuestion = total(report.report.questions.map((q) => ({ avgMs: q.avgMs, n: q.answered })));
  const byPlayer = total(report.report.players.map((p) => ({ avgMs: p.avgMs, n: p.answeredCount })));
  // each average is rounded to the ms: half a ms per answer on each side, 8 answers
  assert.ok(Math.abs(byQuestion - byPlayer) <= 8, `all answers' time, by question ${byQuestion} and by player ${byPlayer}`);
});

test('bad games, unknown rooms, stolen host controls and junk payloads are refused', async () => {
  const s = await connect();
  const bad = await s.emitWithAck('host:create', { game: { title: '', rounds: [] } as unknown as Game });
  assert.equal(bad.ok, false);
  const noRoom = await s.emitWithAck('player:join', { pin: '000000', nickname: 'x', avatar: '🦊' });
  assert.deepEqual(noRoom, { ok: false, error: 'room_not_found' });

  const host = await connect();
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const intruder = await s.emitWithAck('host:attach', { pin: created.pin, hostToken: 'x'.repeat(created.hostToken.length) });
  assert.deepEqual(intruder, { ok: false, error: 'not_allowed' });

  const raw = s as unknown as { emit: (...args: unknown[]) => void };
  raw.emit('player:join', null);
  raw.emit('player:answer');
  raw.emit('host:create', 42, 'not a function');
  raw.emit('host:close', null);
  raw.emit('host:close', { pin: created.pin }, 'not a function');
  raw.emit('stage:leave', 'junk');
  const alive = await s.emitWithAck('room:check', created.pin);
  assert.ok(alive.ok, 'the server survives malformed events');
});

test('a kicked player is told, and cannot come back with the old token', async () => {
  const host = await connect();
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const p = await connect();
  const joined = await p.emitWithAck('player:join', { pin: created.pin, nickname: 'Spammer', avatar: '🐸' });
  assert.ok(joined.ok);
  const kicked = new Promise<void>((resolve) => p.once('player:kicked', () => resolve()));
  host.emit('host:kick', joined.playerId);
  await kicked;
  const back = await p.emitWithAck('player:resume', { pin: created.pin, token: joined.token });
  assert.deepEqual(back, { ok: false, error: 'not_allowed' });
});

test('leaving from the lobby takes the name off the big screen for good', async () => {
  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const p = await connect();
  const joined = await p.emitWithAck('player:join', { pin: created.pin, nickname: 'Typo', avatar: '🐸' });
  assert.ok(joined.ok);
  await stage.until((s) => s.players.some((x) => x.nickname === 'Typo'));
  assert.deepEqual(await p.emitWithAck('player:leave'), { ok: true });
  const after = await stage.until((s) => s.playerCount === 0);
  assert.equal(after.players.length, 0);
  const back = await p.emitWithAck('player:resume', { pin: created.pin, token: joined.token });
  assert.deepEqual(back, { ok: false, error: 'not_allowed' });
});

test('the lobby waits for the head count the host sets; odd values, other sockets and a started game leave it be', async () => {
  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  assert.equal((await stage.until(() => true)).expected, null);
  const seen = new Set<number | null>();
  (host as unknown as Socket).on('stage:state', (s: StageState) => seen.add(s.expected));

  host.emit('host:expect', 3);
  await stage.until((s) => s.expected === 3);
  for (const odd of [-1, 1.5, '4', 1001, Number.NaN, null, { count: 6 }]) host.emit('host:expect', odd as unknown as number);
  host.emit('host:expect', 5);
  await stage.until((s) => s.expected === 5);
  assert.deepEqual([...seen].filter((n) => n !== 3 && n !== 5), [], 'only the two good counts ever showed');

  // a player, or a second screen, is no host
  const p = await connect();
  const joined = await p.emitWithAck('player:join', { pin: created.pin, nickname: 'Early', avatar: '🐸' });
  assert.ok(joined.ok);
  p.emit('host:expect', 9);
  const screen = await connect();
  const second = track<StageState>(screen, 'stage:state');
  assert.ok((await screen.emitWithAck('stage:attach', created.pin)).ok);
  screen.emit('host:expect', 9);
  await stage.until((s) => s.playerCount === 1);
  assert.equal((await second.until(() => true)).expected, 5);

  host.emit('host:expect', 0);
  await stage.until((s) => s.expected === null);
  host.emit('host:expect', 1);
  await stage.until((s) => s.expected === 1);

  host.emit('host:next');
  await stage.until((s) => s.phase !== 'lobby');
  host.emit('host:expect', 7);
  // events from one socket are handled in order, so the answer to this one comes after the count was dealt with
  assert.ok((await host.emitWithAck('room:check', created.pin)).ok);
  const late = await connect();
  const third = track<StageState>(late, 'stage:state');
  assert.ok((await late.emitWithAck('stage:attach', created.pin)).ok);
  assert.equal((await third.until(() => true)).expected, 1);
  assert.ok(![...seen].includes(9) && ![...seen].includes(7));
});

test('the big screens get the cover, cleaned; phones do not need it', async () => {
  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: { ...GAME, cover: { color: 'teal', emoji: '🎯', art: 'bogus' } } as unknown as Game });
  assert.ok(created.ok);
  assert.deepEqual((await stage.until(() => true)).cover, { color: 'teal', emoji: '🎯' });

  const screen = await connect();
  const second = track<StageState>(screen, 'stage:state');
  assert.ok((await screen.emitWithAck('stage:attach', created.pin)).ok);
  assert.deepEqual((await second.until(() => true)).cover, { color: 'teal', emoji: '🎯' });

  const p = await connect();
  const phone = track<PlayerState>(p, 'player:state');
  assert.ok((await p.emitWithAck('player:join', { pin: created.pin, nickname: 'Cover', avatar: '🐸' })).ok);
  assert.equal('cover' in (await phone.until(() => true)), false);

  const plain = await connect();
  const plainStage = track<StageState>(plain, 'stage:state');
  assert.ok((await plain.emitWithAck('host:create', { game: GAME })).ok);
  assert.equal((await plainStage.until(() => true)).cover, null, 'no cover: the screen draws one from the title');
});

test('the host can close the room: everyone in it is told, and the PIN stops working', async () => {
  const host = await connect();
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const screen = await connect();
  assert.ok((await screen.emitWithAck('stage:attach', created.pin)).ok);
  const p = await connect();
  const joined = await p.emitWithAck('player:join', { pin: created.pin, nickname: 'Stayer', avatar: '🐸' });
  assert.ok(joined.ok);

  // only with the token of the host who made it
  const forged = { pin: created.pin, hostToken: 'x'.repeat(created.hostToken.length) };
  assert.deepEqual(await p.emitWithAck('host:close', forged), { ok: false, error: 'not_allowed' });
  assert.deepEqual(await screen.emitWithAck('host:close', { pin: created.pin, hostToken: '' }), { ok: false, error: 'not_allowed' });
  assert.ok((await p.emitWithAck('room:check', created.pin)).ok);

  // a reconnect can send it before the host attaches again: the new connection only has the token
  const reconnected = await connect();
  const told = (s: Client) => new Promise<void>((resolve) => s.once('room:closed', () => resolve()));
  const everyone = Promise.all([told(host), told(screen), told(p)]);
  assert.deepEqual(await reconnected.emitWithAck('host:close', { pin: created.pin, hostToken: created.hostToken }), { ok: true });
  await everyone;
  assert.deepEqual(await p.emitWithAck('room:check', created.pin), { ok: false, error: 'room_not_found' });
  assert.deepEqual(await p.emitWithAck('player:resume', { pin: created.pin, token: joined.token }), { ok: false, error: 'room_not_found' });
  const again = await host.emitWithAck('host:close', { pin: created.pin, hostToken: created.hostToken });
  assert.deepEqual(again, { ok: false, error: 'room_not_found' }, 'twice says it is gone, not a crash');
});

test('a PIN handed out again after its room closed belongs to the new room alone', async () => {
  // the next two rooms get the same PIN, as a busy server eventually would
  const pins = mock.method(crypto, 'randomInt', (() => 424_242) as typeof crypto.randomInt, { times: 2 });
  syncBuiltinESMExports();
  try {
    const oldHost = await connect();
    const first = await oldHost.emitWithAck('host:create', { game: GAME });
    assert.ok(first.ok);
    const oldScreen = await connect();
    assert.ok((await oldScreen.emitWithAck('stage:attach', first.pin)).ok);
    const oldPlayer = await connect();
    assert.ok((await oldPlayer.emitWithAck('player:join', { pin: first.pin, nickname: 'Old', avatar: '🐸' })).ok);
    assert.deepEqual(await oldHost.emitWithAck('host:close', { pin: first.pin, hostToken: first.hostToken }), { ok: true });

    const newHost = await connect();
    const second = await newHost.emitWithAck('host:create', { game: GAME });
    assert.ok(second.ok);
    assert.equal(second.pin, first.pin);

    const leaked: string[] = [];
    oldScreen.on('stage:state', () => leaked.push('old screen saw the new room'));
    oldPlayer.on('player:state', () => leaked.push('old player saw the new room'));
    const p = await connect();
    assert.ok((await p.emitWithAck('player:join', { pin: second.pin, nickname: 'New', avatar: '🦊' })).ok);

    assert.deepEqual(await oldHost.emitWithAck('host:report'), { ok: false, error: 'not_allowed' });
    assert.deepEqual(await oldHost.emitWithAck('host:close', { pin: first.pin, hostToken: first.hostToken }), { ok: false, error: 'not_allowed' });
    assert.deepEqual(await oldPlayer.emitWithAck('player:answer', { questionId: 'a', choice: 1 }), { ok: false, error: 'not_allowed' });
    assert.ok((await p.emitWithAck('room:check', second.pin)).ok, 'the new room is still open');
    assert.deepEqual(leaked, []);
  } finally {
    pins.mock.restore();
    syncBuiltinESMExports();
  }
});

test('a finished room nobody has open does not hold up a deploy; anything else does', async () => {
  const health = async () => {
    const h = (await (await fetch(`http://127.0.0.1:${server.port}/health`)).json()) as { rooms: number; inUse: number };
    return { rooms: h.rooms, inUse: h.inUse };
  };
  const eventually = async (want: { rooms: number; inUse: number }, what: string) => {
    const end = Date.now() + 5000;
    let got = await health();
    while (JSON.stringify(got) !== JSON.stringify(want) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 50));
      got = await health();
    }
    assert.deepEqual(got, want, what);
  };
  const before = await health();

  // a lobby nobody is in still counts: the Host may be on the way back with the PIN already handed out
  const idle = await connect();
  assert.ok((await idle.emitWithAck('host:create', { game: GAME })).ok);
  idle.close();
  await eventually({ rooms: before.rooms + 1, inUse: before.inUse + 1 }, 'an empty lobby');

  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const p = await connect();
  assert.ok((await p.emitWithAck('player:join', { pin: created.pin, nickname: 'Last', avatar: '🐸' })).ok);
  host.emit('host:next');
  await stage.until((s) => s.phase === 'round');
  host.emit('host:end');
  await stage.until((s) => s.phase === 'podium');
  await eventually({ rooms: before.rooms + 2, inUse: before.inUse + 2 }, 'the podium is on screen');
  host.emit('stage:leave'); // the host page went elsewhere in the same tab
  p.emit('stage:leave'); // not a screen: ignored
  await eventually({ rooms: before.rooms + 2, inUse: before.inUse + 2 }, 'a player still looks at the podium');
  p.close();
  await eventually({ rooms: before.rooms + 2, inUse: before.inUse + 1 }, 'the host left the page, the tab still open');
  assert.ok((await host.emitWithAck('host:attach', { pin: created.pin, hostToken: created.hostToken })).ok);
  await eventually({ rooms: before.rooms + 2, inUse: before.inUse + 2 }, 'the host came back to the podium');
  host.close();
  await eventually({ rooms: before.rooms + 2, inUse: before.inUse + 1 }, 'a finished room nobody has open');
});

test('a Next pressed just as the game moved on by itself is dropped, not spent on the screen that came up', async () => {
  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const p = await connect();
  assert.ok((await p.emitWithAck('player:join', { pin: created.pin, nickname: 'Solo', avatar: '🐼' })).ok);
  const lobby = await stage.until((s) => s.playerCount === 1);
  // a socket handles its events in order: once this comes back, the presses sent before it have been dealt with
  const phase = async () => {
    const r = await host.emitWithAck('room:check', created.pin);
    assert.ok(r.ok);
    return r.phase;
  };

  host.emit('host:next', { step: lobby.step });
  const round = await stage.until((s) => s.phase === 'round');
  assert.equal(round.step, lobby.step + 1, 'every change of phase is a new step');

  // the round's intro ends by itself while the host's press on it is on the way: the question it opened stays
  const question = await stage.until((s) => s.phase === 'question');
  host.emit('host:next', { step: round.step });
  host.emit('host:skip', { step: round.step });
  assert.equal(await phase(), 'question');

  // a double press on the reveal moves on once, to the leaderboard, not on past it to the next question
  host.emit('host:next', { step: question.step });
  const reveal = await stage.until((s) => s.phase === 'reveal');
  host.emit('host:next', { step: reveal.step });
  host.emit('host:next', { step: reveal.step });
  await stage.until((s) => s.phase === 'leaderboard');
  assert.equal(await phase(), 'leaderboard');

  // a page from before the step came along sends none, and moves the game on as it always did
  host.emit('host:next');
  await stage.until((s) => s.phase === 'question' && s.question?.number === 2);
  host.emit('host:skip');
  await stage.until((s) => s.phase === 'reveal' && s.question?.number === 2);
  assert.ok((await host.emitWithAck('host:close', { pin: created.pin, hostToken: created.hostToken })).ok);
});

test('a player kicked while answering is open comes off the count, and when they were the last to answer the reveal comes', async () => {
  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const players: { s: Client; id: string }[] = [];
  for (const nickname of ['Early', 'Late', 'Idle']) {
    const s = await connect();
    const joined = await s.emitWithAck('player:join', { pin: created.pin, nickname, avatar: '🐼' });
    if (!joined.ok) throw new Error(`${nickname} could not join: ${joined.error}`);
    players.push({ s, id: joined.playerId });
  }
  const [early, late, idle] = players;
  await stage.until((s) => s.playerCount === 3);
  host.emit('host:next');
  const open = await stage.until((s) => s.phase === 'question');
  const q = open.question!;
  await sleepUntil(q.startsAt);

  assert.ok((await early.s.emitWithAck('player:answer', { questionId: q.id, choice: 1 })).ok);
  await stage.until((s) => s.answeredCount === 1);
  // the one who answered goes: their answer goes with them, so the big screen does not count 1 of 2 as everyone
  host.emit('host:kick', early.id);
  const after = await stage.until((s) => s.playerCount === 2);
  assert.equal(after.answeredCount, 0);
  assert.equal(after.phase, 'question');

  assert.ok((await late.s.emitWithAck('player:answer', { questionId: q.id, choice: 0 })).ok);
  await stage.until((s) => s.answeredCount === 1);
  // the one still to answer goes: everyone left has answered, so the reveal comes as after the last answer
  host.emit('host:kick', idle.id);
  const reveal = await stage.until((s) => s.phase === 'reveal');
  assert.ok(Date.now() < q.endsAt, 'the reveal came before time ran out');
  assert.equal(reveal.reveal?.answered, 1);
  assert.equal(reveal.reveal?.totalPlayers, 1);
  assert.ok((await host.emitWithAck('host:close', { pin: created.pin, hostToken: created.hostToken })).ok);
});

test('the reveal waits a second while the big screen stamps time up or everyone answering, and comes at once on a skip', async () => {
  const host = await connect();
  const stage = track<StageState>(host, 'stage:state');
  const created = await host.emitWithAck('host:create', { game: GAME });
  assert.ok(created.ok);
  const players: Client[] = [];
  for (const nickname of ['One', 'Two', 'Three']) {
    const s = await connect();
    const joined = await s.emitWithAck('player:join', { pin: created.pin, nickname, avatar: '🐼' });
    if (!joined.ok) throw new Error(`${nickname} could not join: ${joined.error}`);
    players.push(s);
  }
  const [one, two, three] = players;
  await stage.until((s) => s.playerCount === 3);
  const at = (epochMs: number) => new Promise((r) => setTimeout(r, Math.max(0, epochMs - Date.now())));
  const answer = (s: Client, questionId: string) => s.emitWithAck('player:answer', { questionId, choice: 0 });

  // time runs out: an answer still on its way is let in, a later one is not, and the reveal waits its second
  host.emit('host:next');
  await stage.until((s) => s.phase === 'round');
  host.emit('host:skip');
  const q1 = (await stage.until((s) => s.phase === 'question')).question!;
  await sleepUntil(q1.startsAt);
  assert.ok((await answer(one, q1.id)).ok);
  await at(q1.endsAt + 150);
  assert.ok((await answer(two, q1.id)).ok, 'an answer 150 ms after time ran out is let in');
  await at(q1.endsAt + 450);
  assert.deepEqual(await answer(three, q1.id), { ok: false, error: 'too_late' });
  const r1 = await stage.until((s) => s.phase === 'reveal');
  const timeUp = Date.now() - q1.endsAt;
  assert.ok(timeUp >= 950 && timeUp <= 1400, `the reveal came ${timeUp} ms after time ran out, not about a second`);
  assert.equal(r1.reveal?.answered, 2);

  // everyone answers: the big screen hears of the last answer at once, and the reveal waits its second
  host.emit('host:next');
  await stage.until((s) => s.phase === 'leaderboard');
  host.emit('host:next');
  const q2 = (await stage.until((s) => s.phase === 'question' && s.question?.number === 2)).question!;
  await sleepUntil(q2.startsAt);
  assert.ok((await answer(one, q2.id)).ok);
  assert.ok((await answer(two, q2.id)).ok);
  const lastSent = Date.now();
  assert.ok((await answer(three, q2.id)).ok);
  await stage.until((s) => s.phase === 'question' && s.answeredCount === 3);
  const heard = Date.now() - lastSent;
  assert.ok(heard < 150, `the big screen heard of the last answer ${heard} ms after it was sent, held back like the others`);
  await stage.until((s) => s.phase === 'reveal' && s.question?.number === 2);
  const allIn = Date.now() - lastSent;
  assert.ok(allIn >= 950 && allIn <= 1400, `the reveal came ${allIn} ms after everyone had answered, not about a second`);

  // the host skips: nothing is stamped, so nothing waits
  host.emit('host:next');
  await stage.until((s) => s.phase === 'leaderboard');
  host.emit('host:next');
  await stage.until((s) => s.phase === 'round' && s.round?.index === 1);
  host.emit('host:skip');
  const q3 = (await stage.until((s) => s.phase === 'question' && s.question?.number === 3)).question!;
  await sleepUntil(q3.startsAt);
  assert.ok((await answer(one, q3.id)).ok);
  const skipped = Date.now();
  host.emit('host:skip');
  await stage.until((s) => s.phase === 'reveal' && s.question?.number === 3);
  const onSkip = Date.now() - skipped;
  assert.ok(onSkip < 150, `the reveal came ${onSkip} ms after the skip, not at once`);
  assert.ok((await host.emitWithAck('host:close', { pin: created.pin, hostToken: created.hostToken })).ok);
});
