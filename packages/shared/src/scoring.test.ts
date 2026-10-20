import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scoreAnswer, speedPoints, type ScoreInput } from './scoring';

const quiz: ScoreInput = {
  type: 'quiz',
  answered: true,
  correct: true,
  responseMs: 2000,
  timeLimitS: 30,
  timed: true,
  multiplier: 1,
  streakBefore: 0,
  streakBonus: false,
};

test('speed score matches the spec example: 2 s of 30 s gives 967', () => {
  assert.equal(speedPoints(2000, 30), 967);
});

test('answers within 0.5 s get the full 1,000', () => {
  assert.equal(speedPoints(0, 20), 1000);
  assert.equal(speedPoints(500, 20), 1000);
});

test('a correct answer never drops below half', () => {
  assert.equal(speedPoints(30_000, 30), 500);
  assert.equal(speedPoints(99_000, 30), 500);
});

test('a correct answer starts a streak; a wrong one scores 0 and resets it', () => {
  assert.deepEqual(scoreAnswer(quiz), { points: 967, streak: 1 });
  assert.deepEqual(scoreAnswer({ ...quiz, correct: false, streakBefore: 4 }), { points: 0, streak: 0 });
  assert.deepEqual(scoreAnswer({ ...quiz, answered: false, correct: null, streakBefore: 4 }), { points: 0, streak: 0 });
});

test('multipliers: double points, no points, Final Round', () => {
  assert.equal(scoreAnswer({ ...quiz, multiplier: 2 }).points, 1934);
  assert.equal(scoreAnswer({ ...quiz, multiplier: 0 }).points, 0);
  assert.equal(scoreAnswer({ ...quiz, multiplier: 4 }).points, 3868);
});

test('accuracy mode ("ไม่นับเวลา") gives 1,000 for every correct answer', () => {
  assert.equal(scoreAnswer({ ...quiz, timed: false, responseMs: 29_000 }).points, 1000);
});

test('poll gives 100 to everyone who votes and keeps the streak', () => {
  const poll = { ...quiz, type: 'poll' as const, correct: null, streakBefore: 3 };
  assert.deepEqual(scoreAnswer(poll), { points: 100, streak: 3 });
  assert.deepEqual(scoreAnswer({ ...poll, answered: false }), { points: 0, streak: 3 });
});

test('puzzle and typed answers score like a quiz', () => {
  assert.deepEqual(scoreAnswer({ ...quiz, type: 'puzzle' }), { points: 967, streak: 1 });
  assert.deepEqual(scoreAnswer({ ...quiz, type: 'type', correct: false, streakBefore: 2 }), { points: 0, streak: 0 });
});

test('a slider guess scores by closeness, and the streak bonus is not cut by it', () => {
  const slider: ScoreInput = { ...quiz, type: 'slider', timed: false };
  assert.deepEqual(scoreAnswer({ ...slider, closeness: 1 }), { points: 1000, streak: 1 });
  assert.deepEqual(scoreAnswer({ ...slider, closeness: 0.5 }), { points: 500, streak: 1 });
  assert.equal(scoreAnswer({ ...slider, timed: true, closeness: 0.75 }).points, Math.round(967 * 0.75));
  assert.equal(scoreAnswer({ ...slider, closeness: 0.5, multiplier: 2 }).points, 1000);
  assert.equal(scoreAnswer({ ...slider, closeness: 0.5, streakBefore: 2, streakBonus: true }).points, 700);
});

test('streak bonus is off by default, and capped at +500 when the Host turns it on', () => {
  assert.equal(scoreAnswer({ ...quiz, streakBefore: 5 }).points, 967);
  assert.equal(scoreAnswer({ ...quiz, streakBefore: 1, streakBonus: true }).points, 1067);
  assert.equal(scoreAnswer({ ...quiz, streakBefore: 9, streakBonus: true }).points, 1467);
});
