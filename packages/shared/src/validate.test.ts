import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sliderStart } from './answers';
import { SAMPLE_GAMES } from './sample-games';
import { LIMITS, MESSAGE_MAX_BYTES, QUESTION_TYPES, TIME_CHOICES_S, gameBytes, validateGame } from './validate';

/** a game of one question, so a test only spells out what it checks */
const one = (q: Record<string, unknown>) =>
  validateGame({ title: 'T', rounds: [{ title: 'R', questions: [{ prompt: 'Q', options: [], correct: [], timeLimitS: 20, ...q }] }] });
const errorsOf = (q: Record<string, unknown>) => {
  const res = one(q);
  return res.ok ? [] : res.errors;
};
const flags = (q: Record<string, unknown>, want: string) => {
  const errors = errorsOf(q);
  assert.ok(errors.some((e) => e.includes(want)), `${JSON.stringify(q)}\n wanted: ${want}\n got: ${errors.join(' | ') || 'no errors'}`);
};

test('every sample game passes validation', () => {
  for (const game of SAMPLE_GAMES) {
    const res = validateGame(game);
    assert.equal(res.ok, true, res.ok ? '' : res.errors.join('\n'));
  }
});

test('sample games: the description counts match, times fit the editor, no slider starts on its answer', () => {
  assert.equal(new Set(SAMPLE_GAMES.map((g) => g.id)).size, SAMPLE_GAMES.length);
  for (const game of SAMPLE_GAMES) {
    const questions = game.rounds.flatMap((r) => r.questions);
    assert.ok(game.description?.startsWith(`${game.rounds.length} ด่าน ${questions.length} ข้อ: `), `${game.id}: ${game.description}`);
    for (const q of questions) {
      assert.ok((TIME_CHOICES_S as readonly number[]).includes(q.timeLimitS), `${game.id} ${q.id}: ${q.timeLimitS} s is not in the editor's list`);
      if (q.slider) assert.notEqual(sliderStart(q.slider), q.slider.answer, `${game.id} ${q.id}: the slider would start on the answer`);
    }
  }
});

test('the party sample shows off every question type', () => {
  const party = SAMPLE_GAMES.find((g) => g.id === 'tpl-party');
  assert.ok(party);
  const types = new Set(party.rounds.flatMap((r) => r.questions.map((q) => q.type)));
  assert.deepEqual([...types].sort(), [...QUESTION_TYPES].sort());
});

test('puzzle, typed and slider questions keep what they need and drop the rest', () => {
  const res = validateGame({
    title: 'T',
    rounds: [
      {
        title: 'R',
        questions: [
          { type: 'puzzle', prompt: 'เรียง', options: [' a ', 'b', 'c'], correct: [0], timeLimitS: 30 },
          { type: 'type', prompt: 'พิมพ์', options: ['ต้มยำ', 'tom yum'], correct: [1], timeLimitS: 30 },
          {
            type: 'slider',
            prompt: 'ทาย',
            options: ['x'],
            correct: [0],
            timeLimitS: 20,
            slider: { min: 0, max: 100, step: 5, answer: 35, margin: 5, unit: ' ปี ', extra: 1 },
          },
        ],
      },
    ],
  });
  assert.ok(res.ok, res.ok ? '' : res.errors.join('\n'));
  const [puzzle, typed, slider] = res.game.rounds[0]!.questions;
  assert.deepEqual([puzzle!.options, puzzle!.correct], [['a', 'b', 'c'], []]);
  assert.deepEqual([typed!.options, typed!.correct], [['ต้มยำ', 'tom yum'], []]);
  assert.deepEqual([slider!.options, slider!.correct], [[], []]);
  assert.deepEqual(slider!.slider, { min: 0, max: 100, step: 5, answer: 35, margin: 5, unit: 'ปี' });
  assert.equal(puzzle!.slider, undefined);
});

test('a slider is whole numbers whose steps land exactly on the top and on the answer', () => {
  const base = { min: 0, max: 100, step: 5, answer: 35, margin: 5 };
  const slider = (patch: Record<string, unknown>) => ({ type: 'slider', slider: { ...base, ...patch } });
  assert.equal(one(slider({})).ok, true);
  assert.equal(one(slider({ min: -20, answer: -5, margin: 0 })).ok, true);
  flags({ type: 'slider' }, 'ค่าน้อยสุด, ค่ามากสุด, เลื่อนทีละ, คำตอบที่ถูก, ระยะได้คะแนน ต้องเป็นจำนวนเต็ม');
  flags(slider({ answer: undefined }), 'คำตอบที่ถูก ต้องเป็นจำนวนเต็ม');
  flags(slider({ min: '0', margin: 1.5 }), 'ค่าน้อยสุด, ระยะได้คะแนน ต้องเป็นจำนวนเต็ม');
  flags(slider({ max: null }), 'ค่ามากสุด ต้องเป็นจำนวนเต็ม');
  flags(slider({ max: 2_000_000_000 }), 'ค่ามากสุด ต้องเป็นจำนวนเต็ม ไม่เกิน ±1,000,000,000');
  flags(slider({ max: 0 }), 'ค่ามากสุดต้องมากกว่าค่าน้อยสุด');
  flags(slider({ step: 0 }), 'เลื่อนทีละต้องเป็น 1 ขึ้นไป');
  flags(slider({ max: 100_001, step: 1 }), 'ละเอียดเกินไป');
  flags(slider({ max: 99 }), 'จาก 0 เพิ่มทีละ 5 ต้องไปถึง 99 พอดี');
  flags(slider({ answer: 33 }), 'ลงขั้นของสไลเดอร์พอดี');
  flags(slider({ answer: 105 }), 'คำตอบต้องอยู่ระหว่าง 0–100');
  flags(slider({ margin: -1 }), 'ระยะได้คะแนนต้องเป็น 0 ขึ้นไป');
  flags(slider({ unit: 'ก'.repeat(21) }), 'หน่วยยาวเกิน 20 ตัวอักษร');
});

test('a puzzle needs 3–4 different items', () => {
  flags({ type: 'puzzle', options: ['a', 'b'] }, 'ต้องมีรายการ 3–4 ข้อ');
  flags({ type: 'puzzle', options: ['a', 'b', 'c', 'd', 'e'] }, 'ต้องมีรายการ 3–4 ข้อ');
  flags({ type: 'puzzle', options: ['Git', 'git', 'svn'] }, 'รายการซ้ำกัน');
  flags({ type: 'puzzle', options: ['a', ' ', 'c'] }, 'รายการที่ 2 ยังว่างอยู่');
  flags({ type: 'puzzle', options: ['a', 'b', 'x'.repeat(76)] }, 'รายการที่ 3 ยาวเกิน 75 ตัวอักษร');
});

test('typed answers need a letter or digit, fit 40 characters, and differ from each other', () => {
  flags({ type: 'type', options: [] }, 'ต้องมีคำตอบที่ยอมรับ 1–4 ข้อ');
  flags({ type: 'type', options: ['a', 'b', 'c', 'd', 'e'] }, 'ต้องมีคำตอบที่ยอมรับ 1–4 ข้อ');
  flags({ type: 'type', options: ['ok', '?!'] }, 'คำตอบที่ยอมรับที่ 2 ต้องมีตัวอักษรหรือตัวเลข');
  flags({ type: 'type', options: ['x'.repeat(41)] }, 'คำตอบที่ยอมรับที่ 1 ยาวเกิน 40 ตัวอักษร');
  flags({ type: 'type', options: ['Tom Yum', 'ต้มยำ', 'tom-yum!'] }, 'คำตอบที่ยอมรับที่ 3 ซ้ำกับที่ 1');
  assert.equal(one({ type: 'type', options: ['x'.repeat(40)] }).ok, true);
  assert.equal(one({ type: 'type', options: ['42'] }).ok, true);
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

test('a game that passes fits in one message to the game server, and one too big says so', () => {
  const question = (url: string) => ({ type: 'quiz', prompt: 'ก'.repeat(LIMITS.promptMax), options: ['ข'.repeat(LIMITS.optionMax), 'ค'.repeat(LIMITS.optionMax), 'ง'.repeat(LIMITS.optionMax), 'จ'.repeat(LIMITS.optionMax)], correct: [0], timeLimitS: 20, imageUrl: url });
  const game = (url: string) => ({ title: 'ใหญ่', rounds: Array.from({ length: 5 }, () => ({ title: 'r', questions: Array.from({ length: LIMITS.questionsMax / 5 }, () => question(url)) })) });
  const full = validateGame(game('https://x.example/' + 'a'.repeat(LIMITS.imageUrlMax - 18)));
  assert.equal(full.ok, false);
  if (!full.ok) assert.match(full.errors[0]!, /^เกมนี้ใหญ่ \d+ KB เกินที่เปิดห้องได้ \(448 KB\)/);
  // the most the editor allows without long links still opens, with room to spare in the message
  const most = validateGame(game('https://x.example/a.png'));
  assert.equal(most.ok, true);
  if (most.ok) assert.ok(gameBytes({ game: most.game }) < MESSAGE_MAX_BYTES && gameBytes(most.game) <= LIMITS.gameBytesMax);
  assert.ok(LIMITS.gameBytesMax < MESSAGE_MAX_BYTES);
});
