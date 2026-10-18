import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SAMPLE_GAMES } from './sample-games';
import { validateGame } from './validate';

test('every sample game passes validation', () => {
  for (const game of SAMPLE_GAMES) {
    const res = validateGame(game);
    assert.equal(res.ok, true, res.ok ? '' : res.errors.join('\n'));
  }
});

test('validation reassigns unique question ids', () => {
  const res = validateGame(SAMPLE_GAMES[0]);
  assert.ok(res.ok);
  const ids = res.game.rounds.flatMap((r) => r.questions.map((q) => q.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('validation reports missing pieces in Thai, per round and question', () => {
  const res = validateGame({
    title: '',
    rounds: [{ title: 'A', questions: [{ type: 'quiz', prompt: '', options: ['x', ''], correct: [], timeLimitS: 2 }] }],
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.ok(res.errors.includes('ต้องตั้งชื่อเกม'));
  assert.ok(res.errors.some((e) => e.startsWith('ด่าน 1 ข้อ 1: ยังไม่ได้พิมพ์คำถาม')));
  assert.ok(res.errors.some((e) => e.includes('ตัวเลือกที่ 2 ยังว่างอยู่')));
  assert.ok(res.errors.some((e) => e.includes('ต้องเลือกคำตอบที่ถูก')));
  assert.ok(res.errors.some((e) => e.includes('เวลาตอบ')));
});

test('a poll never keeps a correct answer', () => {
  const res = validateGame({
    title: 'Poll',
    rounds: [{ title: 'R', questions: [{ type: 'poll', prompt: 'ชอบอะไร', options: ['a', 'b'], correct: [0], timeLimitS: 20 }] }],
  });
  assert.ok(res.ok);
  assert.deepEqual(res.game.rounds[0]!.questions[0]!.correct, []);
});
