import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toRoomGame } from './room-game';
import { SAMPLE_GAMES } from './sample-games';
import type { Game, Question } from './types';

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
