import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Game } from '@icebreaker/shared';
import type { IO } from './io';
import { EMPTY_LIMIT_MS, Rooms } from './rooms';

const GAME: Game = {
  id: 'sweep',
  title: 'Sweep test',
  rounds: [{ id: 'r1', title: 'R', questions: [{ id: 'a', type: 'quiz', prompt: 'Q', options: ['A', 'B'], correct: [0], timeLimitS: 5 }] }],
};
const MINUTE = 60_000;

/** just enough of Socket.IO for the registry: who is in which channel, and nowhere to send to */
function fakeIo() {
  const channels = new Map<string, Set<string>>();
  const io = {
    to: () => ({ emit: () => true }),
    sockets: { adapter: { rooms: channels }, sockets: new Map() },
  } as unknown as IO;
  return { io, channels };
}

test('a room nobody is connected to closes after a while, unless it is finished or someone comes back', () => {
  const { io, channels } = fakeIo();
  const rooms = new Rooms(io);
  const t0 = Date.now();

  const left = rooms.create(GAME); // the Host closed the tab in the lobby
  const watched = rooms.create(GAME); // a screen still shows it
  channels.set(watched.stageChannel, new Set(['screen']));
  const back = rooms.create(GAME); // the Host's laptop slept, then came back
  const done = rooms.create(GAME);
  done.phase = 'podium';

  rooms.sweep(t0);
  rooms.sweep(t0 + EMPTY_LIMIT_MS / 2);
  channels.set(back.stageChannel, new Set(['host']));
  rooms.sweep(t0 + EMPTY_LIMIT_MS / 2 + MINUTE);
  channels.delete(back.stageChannel);
  rooms.sweep(t0 + EMPTY_LIMIT_MS - MINUTE);
  assert.equal(rooms.size, 4, 'nothing closes before the limit');

  rooms.sweep(t0 + EMPTY_LIMIT_MS);
  assert.equal(rooms.get(left.pin), undefined, 'empty for the whole limit: closed');
  assert.ok(rooms.get(watched.pin), 'a screen has it open');
  assert.ok(rooms.get(back.pin), 'the clock started again when the Host left the second time');
  assert.ok(rooms.get(done.pin), 'a finished game keeps its report');
  assert.equal(rooms.inUse, 2, 'the finished room nobody has open does not hold up a deploy');

  // first seen empty again at the sweep before the limit
  const backLeft = t0 + EMPTY_LIMIT_MS - MINUTE;
  rooms.sweep(backLeft + EMPTY_LIMIT_MS - MINUTE);
  assert.ok(rooms.get(back.pin));
  rooms.sweep(backLeft + EMPTY_LIMIT_MS);
  assert.equal(rooms.get(back.pin), undefined);
  assert.ok(rooms.get(watched.pin));
});
