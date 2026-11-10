import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askedCount, drawGame, isBank, toRoomGame } from './room-game';
import { SAMPLE_GAMES } from './sample-games';
import type { Game, Question, Round } from './types';

const q = (id: string, extra: Partial<Question> = {}): Question => ({
  id,
  type: 'quiz',
  prompt: `คำถาม ${id}`,
  options: ['ก', 'ข', 'ค', 'ง'],
  correct: [0],
  timeLimitS: 20,
  ...extra,
});

const game = (questions: Question[]): Game => ({
  id: 'g1',
  title: 'เกมทดสอบ',
  rounds: [{ id: 'r1', title: 'ด่าน 1', questions }],
});

test('a question built from a wiki page loses both its source and its explanation', () => {
  const made = q('q1', { source: { path: 'topics/arena.md', title: 'Pika Arena' }, explanation: 'ประโยคจากหน้าในคลังความรู้' });
  const [out] = toRoomGame(game([made])).rounds[0].questions;
  assert.equal(out.source, undefined);
  assert.equal(out.explanation, undefined);
  // the two keys are gone, not merely blank — nothing of the page rides along in the JSON
  assert.ok(!('source' in out) && !('explanation' in out));
  // and nothing else about the question changed
  const rest = { ...made };
  delete rest.source;
  delete rest.explanation;
  assert.deepEqual(out, rest);
});

test('a hand-written explanation stays: it is the sentence the reveal teaches with', () => {
  const mine = q('q1', { explanation: 'เพราะต้องกด Approve & Merge ก่อน' });
  const [out] = toRoomGame(game([mine])).rounds[0].questions;
  assert.equal(out.explanation, 'เพราะต้องกด Approve & Merge ก่อน');
});

test('the game itself is untouched: the editor keeps showing the source', () => {
  const made = q('q1', { source: { path: 'topics/arena.md' }, explanation: 'จากหน้าในคลัง' });
  const before = game([made]);
  const copy = structuredClone(before);
  toRoomGame(before);
  assert.deepEqual(before, copy);
});

test('every round and every question goes through the cut', () => {
  const g: Game = {
    id: 'g1',
    title: 'เกมทดสอบ',
    rounds: [
      { id: 'r1', title: 'ด่าน 1', questions: [q('q1', { source: { path: 'a.md' }, explanation: 'ก' }), q('q2', { explanation: 'ข' })] },
      { id: 'r2', title: 'ด่าน 2', questions: [q('q3', { source: { path: 'b.md' }, explanation: 'ค' })] },
    ],
  };
  const out = toRoomGame(g);
  const all = out.rounds.flatMap((r) => r.questions);
  assert.deepEqual(all.map((x) => x.source), [undefined, undefined, undefined]);
  assert.deepEqual(all.map((x) => x.explanation), [undefined, 'ข', undefined]);
});

test('the sample games carry explanations that reach the room', () => {
  const pika = SAMPLE_GAMES.find((g) => g.id === 'tpl-pika');
  assert.ok(pika, 'the Pika sample game is there');
  const questions = toRoomGame(pika).rounds.flatMap((r) => r.questions);
  assert.equal(questions.length, 12);
  assert.ok(
    questions.every((x) => (x.explanation ?? '').length > 20),
    'every question in the learner quiz explains its answer',
  );
});

// ---------- question banks ----------

const bank = (size: number, draw?: number): Round => ({
  id: 'r1',
  title: 'คลัง',
  ...(draw === undefined ? {} : { draw }),
  questions: Array.from({ length: size }, (_, i) => q(`q1-${i + 1}`)),
});
const one = (round: Round): Game => ({ id: 'g1', title: 'เกมทดสอบ', rounds: [round] });

/** a random source that gives the same numbers every time it is made from the same seed */
const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

test('a bank of 30 asks 10: that many, none twice, all from the bank, and the draw setting is gone', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const out = drawGame(one(bank(30, 10)), seeded(seed)).rounds[0];
    const ids = out.questions.map((x) => x.id);
    assert.equal(ids.length, 10);
    assert.equal(new Set(ids).size, 10);
    assert.ok(ids.every((id) => /^q1-([1-9]|[12]\d|30)$/.test(id)), ids.join(' '));
    assert.ok(!('draw' in out));
  }
});

test('a round that is not a bank is asked whole and in order, next to one that is', () => {
  const plain: Round = { id: 'r2', title: 'ปกติ', questions: [q('q2-1'), q('q2-2'), q('q2-3')] };
  const g: Game = { id: 'g1', title: 'เกมทดสอบ', rounds: [bank(8, 3), plain] };
  const out = drawGame(g, seeded(7));
  assert.equal(out.rounds[0].questions.length, 3);
  assert.equal(out.rounds[1], plain);
  // a game with no bank at all comes back question for question
  assert.deepEqual(drawGame(one(plain)), one(plain));
});

test('the same random numbers give the same draw; different ones give a different set', () => {
  const g = one(bank(30, 10));
  const ids = (seed: number) => drawGame(g, seeded(seed)).rounds[0].questions.map((x) => x.id).join(' ');
  assert.equal(ids(42), ids(42));
  assert.equal(new Set(Array.from({ length: 50 }, (_, i) => ids(i + 1))).size, 50);
});

test('every question of a bank gets its turn, about equally often, and in any position', () => {
  const g = one(bank(30, 10));
  const random = seeded(2026);
  const asked = new Map<string, number>();
  const first = new Map<string, number>();
  const rooms = 6000;
  for (let i = 0; i < rooms; i++) {
    const picked = drawGame(g, random).rounds[0].questions;
    for (const x of picked) asked.set(x.id, (asked.get(x.id) ?? 0) + 1);
    first.set(picked[0].id, (first.get(picked[0].id) ?? 0) + 1);
  }
  assert.equal(asked.size, 30);
  // each is asked in a third of the rooms (2000 of 6000) and opens one room in 30 (200)
  for (const [id, n] of asked) assert.ok(n > 1800 && n < 2200, `${id} was asked ${n} times`);
  assert.equal(first.size, 30);
  for (const [id, n] of first) assert.ok(n > 130 && n < 270, `${id} came first ${n} times`);
});

test('asking for every question shuffles them; asking for more than there are asks them all', () => {
  const all = drawGame(one(bank(12, 12)), seeded(3)).rounds[0].questions.map((x) => x.id);
  assert.equal(new Set(all).size, 12);
  assert.notDeepEqual(all, bank(12).questions.map((x) => x.id));
  assert.equal(drawGame(one(bank(5, 40)), seeded(3)).rounds[0].questions.length, 5);
  assert.equal(drawGame(one(bank(1, 1)), seeded(3)).rounds[0].questions.length, 1);
});

test('the draw leaves the game it was given alone, and the questions themselves unchanged', () => {
  const g = one({ ...bank(6, 2), questions: bank(6).questions.map((x, i) => ({ ...x, explanation: `เพราะ ${i}` })) });
  const copy = structuredClone(g);
  const out = drawGame(g, seeded(5));
  assert.deepEqual(g, copy);
  for (const x of out.rounds[0].questions) assert.deepEqual(x, g.rounds[0].questions.find((y) => y.id === x.id));
});

test('a random source that returns its top value still picks inside the bank', () => {
  const out = drawGame(one(bank(4, 4)), () => 1).rounds[0].questions;
  assert.equal(new Set(out.map((x) => x.id)).size, 4);
  assert.ok(out.every(Boolean));
});

test('how many a round asks: the draw, never more than the round has; all of it when not a bank', () => {
  assert.equal(askedCount(bank(30, 10)), 10);
  assert.equal(askedCount(bank(4, 10)), 4);
  assert.equal(askedCount(bank(7)), 7);
  assert.equal(isBank(bank(7)), false);
  assert.equal(isBank(bank(7, 7)), true);
  // nonsense from an old draft is not a bank
  assert.equal(isBank({ draw: 0 }), false);
  assert.equal(askedCount({ ...bank(7), draw: Number.NaN }), 7);
});

test('a bank made from wiki pages is cut and drawn: no source or page explanation reaches the room', () => {
  const made = bank(10, 4);
  made.questions = made.questions.map((x) => ({ ...x, source: { path: 'topics/a.md' }, explanation: 'จากหน้าในคลัง' }));
  const out = drawGame(toRoomGame(one(made)), seeded(9)).rounds[0].questions;
  assert.equal(out.length, 4);
  assert.ok(out.every((x) => !('source' in x) && !('explanation' in x)));
});
