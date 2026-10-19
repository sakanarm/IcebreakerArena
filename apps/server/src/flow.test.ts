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
  const b1 = await bob.state.until((s) => s.phase === 'reveal');
  assert.equal(b1.result?.correct, false);
  assert.equal(b1.result?.points, 0);
  assert.equal(b1.me.aboveNickname, 'Alice');
  assert.equal(b1.me.gapToAbove, a1.me.score);
  const c1 = await carol.state.until((s) => s.phase === 'reveal');
  assert.equal(c1.result?.answered, false);

  host.emit('host:next');
  const lb = await stage.until((s) => s.phase === 'leaderboard');
  assert.equal(lb.leaderboard[0]?.nickname, 'Alice');

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
  await stage.until((s) => s.phase === 'leaderboard');
  host.emit('host:next');
  await stage.until((s) => s.phase === 'round' && s.round?.index === 1);
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
