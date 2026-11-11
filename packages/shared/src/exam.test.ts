import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allot, buildExam, drawExam, examSize, isExamQuestion, isRightChoice, scoreExam, type ExamItem, type ExamPaper } from './exam';
import { toRoomGame } from './room-game';
import { SAMPLE_GAMES } from './sample-games';
import type { Game, Question, Round } from './types';
import { validateGame } from './validate';

const q = (id: string, extra: Partial<Question> = {}): Question => ({
  id,
  type: 'quiz',
  prompt: `คำถาม ${id}`,
  options: ['ก', 'ข', 'ค', 'ง'],
  correct: [0],
  timeLimitS: 20,
  ...extra,
});

const round = (id: string, n: number, extra: Partial<Round> = {}): Round => ({
  id,
  title: `หมวด ${id}`,
  questions: Array.from({ length: n }, (_, i) => q(`${id}-q${i + 1}`)),
  ...extra,
});

const game = (rounds: Round[]): Game => ({ id: 'g1', title: ' ข้อสอบทดสอบ ', rounds });

/** a random source that gives the same numbers every time (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (items: ExamItem[]) => items.map((i) => i.question.id);

// ---------- which questions an exam can ask ----------

test('only quiz and true/false questions are exam questions', () => {
  assert.equal(isExamQuestion(q('a')), true);
  assert.equal(isExamQuestion(q('b', { type: 'truefalse', options: ['จริง', 'เท็จ'], correct: [1] })), true);
  assert.equal(isExamQuestion(q('c', { type: 'poll', correct: [] })), false);
  assert.equal(isExamQuestion(q('d', { type: 'puzzle', correct: [] })), false);
  assert.equal(isExamQuestion(q('e', { type: 'type', options: ['คำตอบ'], correct: [] })), false);
  assert.equal(isExamQuestion(q('f', { type: 'slider', options: [], correct: [], slider: { min: 0, max: 10, step: 1, answer: 5, margin: 0 } })), false);
});

test('an unfinished question is left out rather than asked', () => {
  assert.equal(isExamQuestion(q('a', { prompt: '   ' })), false, 'no prompt');
  assert.equal(isExamQuestion(q('b', { options: ['ก'] })), false, 'one option');
  assert.equal(isExamQuestion(q('c', { options: ['ก', ' ', 'ค'] })), false, 'a blank option');
  assert.equal(isExamQuestion(q('d', { correct: [] })), false, 'no right answer');
  assert.equal(isExamQuestion(q('e', { correct: [4] })), false, 'the right answer points past the options');
  assert.equal(isExamQuestion(q('f', { correct: [0.5] })), false, 'the right answer is not a position');
});

// ---------- the paper ----------

test('a paper keeps rounds as topics and drops what an exam cannot ask', () => {
  const g = game([
    { id: 'r1', title: ' พื้นฐาน ', questions: [q('q1'), q('q2', { type: 'poll', correct: [] }), q('q3', { explanation: 'เพราะอย่างนี้', imageUrl: 'https://example.com/a.png' })] },
    { id: 'r2', title: 'เรียงลำดับ', questions: [q('q4', { type: 'puzzle', correct: [] })] },
    { id: 'r3', title: 'จริงหรือเท็จ', questions: [q('q5', { type: 'truefalse', options: ['จริง', 'เท็จ'], correct: [1] })] },
  ]);
  const paper = buildExam(g);
  assert.equal(paper.title, 'ข้อสอบทดสอบ');
  assert.deepEqual(
    paper.topics.map((t) => [t.id, t.title, t.questions.map((x) => x.id)]),
    [
      ['r1', 'พื้นฐาน', ['q1', 'q3']],
      ['r3', 'จริงหรือเท็จ', ['q5']],
    ],
  );
  assert.deepEqual(paper.topics[0]!.questions[1], {
    id: 'q3',
    type: 'quiz',
    prompt: 'คำถาม q3',
    options: ['ก', 'ข', 'ค', 'ง'],
    correct: [0],
    imageUrl: 'https://example.com/a.png',
    explanation: 'เพราะอย่างนี้',
  });
  assert.equal(examSize(paper), 3);
  assert.equal(examSize(paper, ['r3']), 1);
  assert.equal(paper.suggested, undefined, 'no bank: one sitting is the whole paper');
});

test('a paper never carries anything but what the page shows: no time limits, points or sources', () => {
  const g = game([{ id: 'r1', title: 'ก', questions: [q('q1', { multiplier: 2, source: { path: 'topics/a.md' }, explanation: 'จากคลัง' })] }]);
  const [out] = buildExam(g).topics[0]!.questions;
  assert.deepEqual(Object.keys(out!).sort(), ['correct', 'explanation', 'id', 'options', 'prompt', 'type']);
});

test('through toRoomGame, an explanation written from a knowledge base page stays out of the paper', () => {
  const g = game([{ id: 'r1', title: 'ก', questions: [q('q1', { source: { path: 'topics/a.md' }, explanation: 'จากคลัง' }), q('q2', { explanation: 'พิมพ์เอง' })] }]);
  const [fromWiki, typed] = buildExam(toRoomGame(g)).topics[0]!.questions;
  assert.equal(fromWiki!.explanation, undefined);
  assert.ok(!JSON.stringify(buildExam(toRoomGame(g))).includes('topics/a.md'));
  assert.equal(typed!.explanation, 'พิมพ์เอง');
});

test('building a paper leaves the game as it was, and the paper shares nothing with it', () => {
  const g = game([round('r1', 3)]);
  const before = structuredClone(g);
  const paper = buildExam(g);
  paper.topics[0]!.questions[0]!.options.push('จ');
  paper.topics[0]!.questions[0]!.correct.push(1);
  assert.deepEqual(g, before);
});

test('a question bank says how many questions one sitting was meant to ask', () => {
  const g = game([round('r1', 30, { draw: 10 }), round('r2', 5)]);
  assert.equal(buildExam(g).suggested, 15);
  // a bank that asks all it has is no smaller than the paper: nothing to suggest
  assert.equal(buildExam(game([round('r1', 5, { draw: 5 })])).suggested, undefined);
  // a draw larger than the bank's exam questions is capped by them
  const mixed = game([{ ...round('r1', 4, { draw: 3 }), questions: [q('a'), q('b'), q('c', { type: 'poll', correct: [] }), q('d', { type: 'poll', correct: [] })] }]);
  assert.equal(buildExam(mixed).suggested, undefined);
});

test('a game with nothing an exam can ask makes an empty paper', () => {
  const paper = buildExam(game([{ id: 'r1', title: 'ก', questions: [q('q1', { type: 'poll', correct: [] })] }]));
  assert.deepEqual(paper.topics, []);
  assert.equal(examSize(paper), 0);
  assert.deepEqual(drawExam(paper), []);
});

test('every sample game that has exam questions makes a paper that can be sat', () => {
  let withExam = 0;
  for (const sample of SAMPLE_GAMES) {
    assert.ok(validateGame(sample).ok, sample.id);
    const paper = buildExam(toRoomGame(sample));
    const size = examSize(paper);
    if (size === 0) continue;
    withExam++;
    const items = drawExam(paper, {}, seeded(1));
    assert.equal(items.length, size, sample.id);
    assert.equal(new Set(items.map((i) => `${i.topicId}/${i.question.id}`)).size, size, sample.id);
    const perfect = scoreExam(
      items,
      items.map((i) => i.question.correct[0]!),
    );
    assert.equal(perfect.percent, 100, sample.id);
  }
  assert.ok(withExam >= 3, 'the samples give several exams to try');
});

// ---------- the draw ----------

test('allot shares places in proportion, one each first, never more than a group has', () => {
  assert.deepEqual(allot([10, 10, 10], 9), [3, 3, 3]);
  assert.deepEqual(allot([29, 1], 10), [9, 1], 'the small topic still comes up');
  assert.deepEqual(allot([30, 10], 20), [15, 5]);
  assert.deepEqual(allot([5, 5], 10), [5, 5]);
  assert.deepEqual(allot([3, 3, 3], 2), [1, 1, 0], 'fewer places than groups: the first ones get them');
  assert.deepEqual(allot([1, 1, 50], 2), [0, 0, 2], 'fewer places than groups: the large one gets them');
  assert.deepEqual(allot([7], 4), [4]);
  assert.deepEqual(allot([1, 1, 1], 3), [1, 1, 1]);
});

test('allot always hands out exactly n and stays within each group', () => {
  const rand = seeded(7);
  for (let round = 0; round < 500; round++) {
    const sizes = Array.from({ length: 1 + Math.floor(rand() * 6) }, () => 1 + Math.floor(rand() * 40));
    const sum = sizes.reduce((a, b) => a + b, 0);
    const n = 1 + Math.floor(rand() * sum);
    const shares = allot(sizes, n);
    assert.equal(
      shares.reduce((a, b) => a + b, 0),
      n,
      `${sizes} / ${n}`,
    );
    shares.forEach((s, i) => assert.ok(s >= 0 && s <= sizes[i]!, `${sizes} / ${n} → ${shares}`));
    if (n >= sizes.length) assert.ok(shares.every((s) => s >= 1), `${sizes} / ${n} → ${shares}`);
  }
});

const paper3: ExamPaper = buildExam(game([round('a', 30), round('b', 10), round('c', 5)]));

test('a draw asks the count, no question twice, each from a chosen topic', () => {
  const rand = seeded(42);
  for (let i = 0; i < 200; i++) {
    const count = 1 + Math.floor(rand() * 45);
    const items = drawExam(paper3, { count }, rand);
    assert.equal(items.length, count);
    assert.equal(new Set(ids(items)).size, count);
  }
  const onlyB = drawExam(paper3, { topicIds: ['b'], count: 7 }, seeded(3));
  assert.equal(onlyB.length, 7);
  assert.ok(onlyB.every((i) => i.topicId === 'b' && i.topicTitle === 'หมวด b'));
});

test('the count is kept within what there is, and an odd count falls back to everything', () => {
  assert.equal(drawExam(paper3, { count: 999 }).length, 45);
  assert.equal(drawExam(paper3, { count: 0 }).length, 1);
  assert.equal(drawExam(paper3, { count: -5 }).length, 1);
  assert.equal(drawExam(paper3, { count: 7.9 }).length, 7);
  assert.equal(drawExam(paper3, { count: NaN }).length, 45);
  assert.equal(drawExam(paper3, { topicIds: ['c'], count: 20 }).length, 5);
  assert.equal(drawExam(paper3, { topicIds: [] }).length, 45, 'no topic named = all topics');
  assert.equal(drawExam(paper3, { topicIds: ['nope'] }).length, 0);
});

test('each chosen topic gets its share of the count', () => {
  const items = drawExam(paper3, { count: 18 }, seeded(5));
  const per = (id: string) => items.filter((i) => i.topicId === id).length;
  assert.deepEqual([per('a'), per('b'), per('c')], allot([30, 10, 5], 18));
  assert.deepEqual([per('a'), per('b'), per('c')], [11, 4, 3]);
});

test('without shuffling, the questions come topic by topic in the order written', () => {
  const items = drawExam(paper3, { count: 20, shuffle: false }, seeded(9));
  const topicOrder = items.map((i) => i.topicId);
  assert.deepEqual(topicOrder, [...topicOrder].sort());
  const num = (id: string) => Number(id.split('-q')[1]);
  for (const t of ['a', 'b', 'c']) {
    const nums = items.filter((i) => i.topicId === t).map((i) => num(i.question.id));
    assert.deepEqual(
      nums,
      [...nums].sort((x, y) => x - y),
    );
  }
  // all of it, unshuffled, is the paper as written
  assert.deepEqual(
    ids(drawExam(paper3, { shuffle: false })),
    paper3.topics.flatMap((t) => t.questions.map((x) => x.id)),
  );
});

test('the same random numbers give the same sitting; other numbers give another', () => {
  const a = ids(drawExam(paper3, { count: 15 }, seeded(11)));
  const b = ids(drawExam(paper3, { count: 15 }, seeded(11)));
  const c = ids(drawExam(paper3, { count: 15 }, seeded(12)));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('over many sittings every question of a bank comes up, about equally often', () => {
  const seen = new Map<string, number>();
  const rand = seeded(2026);
  const sittings = 3000;
  for (let i = 0; i < sittings; i++) for (const id of ids(drawExam(paper3, { topicIds: ['a'], count: 10 }, rand))) seen.set(id, (seen.get(id) ?? 0) + 1);
  assert.equal(seen.size, 30);
  // each of 30 is expected in a third of the sittings
  for (const [id, n] of seen) assert.ok(n > sittings / 3 - 150 && n < sittings / 3 + 150, `${id}: ${n}`);
});

test('a shuffled sitting puts every position in play', () => {
  const firsts = new Set<string>();
  const rand = seeded(8);
  for (let i = 0; i < 400; i++) firsts.add(drawExam(paper3, { topicIds: ['c'] }, rand)[0]!.question.id);
  assert.equal(firsts.size, 5);
});

test('a random source that returns its extremes cannot break a draw', () => {
  for (const edge of [0, 0.999999999, 1]) {
    const items = drawExam(paper3, { count: 20 }, () => edge);
    assert.equal(items.length, 20);
    assert.equal(new Set(ids(items)).size, 20);
    assert.ok(items.every((i) => i.question));
  }
});

test('drawing leaves the paper as it was', () => {
  const before = structuredClone(paper3);
  drawExam(paper3, { count: 12 }, seeded(4));
  assert.deepEqual(paper3, before);
});

// ---------- marking ----------

test('any of the right options counts; nothing picked never does', () => {
  const two = { correct: [1, 3] };
  assert.equal(isRightChoice(two, 1), true);
  assert.equal(isRightChoice(two, 3), true);
  assert.equal(isRightChoice(two, 0), false);
  assert.equal(isRightChoice(two, null), false);
  assert.equal(isRightChoice(two, undefined), false);
});

test('a sitting is marked per question and per topic; a blank counts against the score', () => {
  const items = drawExam(paper3, { shuffle: false, topicIds: ['b', 'c'] });
  assert.equal(items.length, 15);
  // topic b: 6 right, 3 wrong, 1 blank. topic c: 5 right.
  const answers = items.map((it, i) => (it.topicId === 'c' ? 0 : i < 6 ? 0 : i < 9 ? 2 : null));
  const score = scoreExam(items, answers);
  assert.deepEqual(score, {
    total: 15,
    correct: 11,
    wrong: 3,
    skipped: 1,
    percent: 73,
    topics: [
      { id: 'b', title: 'หมวด b', total: 10, correct: 6, percent: 60 },
      { id: 'c', title: 'หมวด c', total: 5, correct: 5, percent: 100 },
    ],
  });
});

test('answers shorter than the sitting are blanks, and an empty sitting scores nothing', () => {
  const items = drawExam(paper3, { shuffle: false, topicIds: ['c'] });
  const score = scoreExam(items, [0, 0]);
  assert.deepEqual([score.correct, score.wrong, score.skipped, score.percent], [2, 0, 3, 40]);
  assert.deepEqual(scoreExam([], []), { total: 0, correct: 0, wrong: 0, skipped: 0, percent: 0, topics: [] });
});

test('topics are listed in the order they first come up in the sitting', () => {
  const items = drawExam(paper3, { count: 45 }, seeded(21));
  const order: string[] = [];
  for (const it of items) if (!order.includes(it.topicId)) order.push(it.topicId);
  assert.deepEqual(
    scoreExam(items, []).topics.map((t) => t.id),
    order,
  );
});
