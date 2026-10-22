import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitingLines, waitMood } from './waiting-lines';

const q = (seconds: number, type: 'quiz' | 'poll' = 'quiz') => ({ type, startsAt: 100_000, endsAt: 100_000 + seconds * 1000 });

test('a 20-second question: fast in the first 2.5 s, close in the last 3 s', () => {
  const twenty = q(20);
  assert.equal(waitMood(twenty, twenty.startsAt + 400), 'fast');
  assert.equal(waitMood(twenty, twenty.startsAt + 2500), 'fast');
  assert.equal(waitMood(twenty, twenty.startsAt + 2600), 'any');
  assert.equal(waitMood(twenty, twenty.endsAt - 3100), 'any');
  assert.equal(waitMood(twenty, twenty.endsAt - 3000), 'close');
  assert.equal(waitMood(twenty, twenty.endsAt + 200), 'close', 'an answer let in just after time ran out');
});

test('the shortest question keeps a stretch between fast and close', () => {
  const five = q(5);
  assert.equal(waitMood(five, five.startsAt + 1000), 'fast');
  assert.equal(waitMood(five, five.startsAt + 1100), 'any');
  assert.equal(waitMood(five, five.endsAt - 1600), 'any');
  assert.equal(waitMood(five, five.endsAt - 1500), 'close');
});

test('a long question calls nothing with half a minute left a close call', () => {
  const four = q(240);
  assert.equal(waitMood(four, four.startsAt + 2500), 'fast');
  assert.equal(waitMood(four, four.startsAt + 3000), 'any');
  assert.equal(waitMood(four, four.endsAt - 30_000), 'any');
  assert.equal(waitMood(four, four.endsAt - 4000), 'close');
});

test('a poll is a poll however fast, and an answer this phone did not see go is neither fast nor close', () => {
  const poll = q(20, 'poll');
  assert.equal(waitMood(poll, poll.startsAt + 300), 'poll');
  assert.equal(waitMood(q(20), null), 'any');
});

test('the lines start with one for the mood, then the ones said in turn', () => {
  assert.equal(waitingLines('fast', () => 0)[0], 'ไวยิ่งกว่าแสง! ⚡');
  assert.equal(waitingLines('fast', () => 0.999)[0], 'คิดไว ตอบไว!');
  assert.ok(waitingLines('any').length >= 3);
  assert.ok(!waitingLines('poll').some((l) => l.includes('เฉลย')), 'a poll has no right answer to see');
  assert.ok(waitingLines('close').slice(1).includes('ดูเฉลยบนจอใหญ่ได้เลย'));
});
