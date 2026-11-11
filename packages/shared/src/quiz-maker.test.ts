import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeTyped } from './answers';
import {
  BLANK,
  buildGame,
  buildQuestion,
  buildQuestions,
  EXAM_PER_PAGE,
  MAX_PER_PAGE,
  numberSpans,
  pickType,
  planFacts,
  scaleFor,
  termPool,
  termSpans,
  type FactPlan,
  type SourceFact,
} from './quiz-maker';
import type { Game, Question } from './types';
import { LIMITS, validateGame } from './validate';

const fact = (text: string, page = 'topics/arena.md', extra: Partial<SourceFact> = {}): SourceFact => ({ text, page, ...extra });

/** A set of facts the way a handful of pages would give them: every question type is reachable from it. */
const FACTS: SourceFact[] = [
  fact('ห้องเกมหนึ่งห้องรองรับผู้เล่นพร้อมกันได้สูงสุด 1,000 คน', 'topics/arena.md', { pageTitle: 'Pika Arena', cite: 'sources/arena-rules.md' }),
  fact('ผู้เล่นเข้าร่วมเกมได้โดยไม่ต้องสมัครสมาชิกก่อน', 'topics/arena.md', { pageTitle: 'Pika Arena' }),
  fact('ชื่อเล่นของทีมที่ดูแลระบบคือ ทีมน้ำแข็ง', 'topics/arena.md', { pageTitle: 'Pika Arena' }),
  fact('ระบบเก็บข้อมูลเกมไว้ใน PostgreSQL ทุกห้อง', 'systems/stack.md', { pageTitle: 'สถาปัตยกรรมระบบ' }),
  fact('กระบวนการบนเครื่องจริงถูกดูแลด้วย pm2 ตลอดเวลา', 'systems/stack.md', { pageTitle: 'สถาปัตยกรรมระบบ' }),
  fact('หน้าเว็บของผู้เล่นสร้างด้วย Next.js เป็นหลัก', 'systems/stack.md', { pageTitle: 'สถาปัตยกรรมระบบ' }),
  fact('การเชื่อมต่อระหว่างเล่นใช้ Socket.IO ตลอดทั้งเกม', 'systems/realtime.md', { pageTitle: 'การเชื่อมต่อแบบเรียลไทม์' }),
  fact('ระบบเปิดใช้งานจริงครั้งแรกเมื่อ 20 ตุลาคม 2026', 'topics/history.md', { pageTitle: 'ความเป็นมา' }),
  fact('ระบบย้ายมาใช้ฐานข้อมูลกลางเมื่อ 5 พฤศจิกายน 2026', 'topics/history.md', { pageTitle: 'ความเป็นมา' }),
  fact('เวอร์ชันแรกถูกสาธิตให้ผู้บริหารดูเมื่อ 1 กันยายน 2026', 'topics/history.md', { pageTitle: 'ความเป็นมา' }),
  fact('งานอบรมผู้ดูแลเกมจัดขึ้นเมื่อ 12 ธันวาคม 2026', 'topics/milestones.md', { pageTitle: 'หมุดหมายของปีนี้' }),
  fact('รายงานสรุปการใช้งานฉบับแรกออกเมื่อ 3 มกราคม 2027', 'topics/milestones.md', { pageTitle: 'หมุดหมายของปีนี้' }),
];

const PAGES = new Set(FACTS.map((f) => f.page)).size;

const build = () => {
  const { keep } = planFacts(FACTS);
  return buildGame(keep, { title: 'ทดสอบคลังความรู้' });
};

const allQuestions = (game: Game): Question[] => game.rounds.flatMap((r) => r.questions);

// ---------- reading numbers and terms out of a sentence ----------

test('a number that belongs to something else is not a number to ask about', () => {
  assert.deepEqual(numberSpans('ประชุมเริ่ม 09:30 ที่ห้องใหญ่').length, 0);
  assert.deepEqual(numberSpans('ดูได้ที่ /PikaArena/report ของระบบ').length, 0);
  assert.deepEqual(numberSpans('ดูแลด้วย pm2 ตลอดเวลา').length, 0);
  assert.deepEqual(numberSpans('ใช้ Node เวอร์ชัน 20.20.0 บนเครื่องจริง').length, 0);
});

test('a number worth asking about keeps its unit', () => {
  const [n] = numberSpans('ห้องรองรับผู้เล่นได้ 1,000 คน');
  assert.equal(n.value, 1000);
  assert.equal(n.text, '1,000');
  assert.equal(n.unit, 'คน');
  assert.equal(numberSpans('งบรวม 25 ล้านบาท')[0].unit, 'ล้านบาท', 'the longest unit wins over บาท');
});

test('terms are the latin runs, the dates and the quoted phrases, and nothing else', () => {
  assert.deepEqual(termSpans('ระบบเก็บข้อมูลไว้ใน PostgreSQL ทุกห้อง').map((t) => [t.kind, t.text]), [['latin', 'PostgreSQL']]);
  assert.deepEqual(termSpans('เปิดใช้งานเมื่อ 20 ตุลาคม 2026').map((t) => [t.kind, t.text]), [['date', '20 ตุลาคม 2026']]);
  assert.deepEqual(termSpans('นโยบายนี้เรียกว่า “วันหยุดยืดหยุ่น” มาตั้งแต่ต้นปี').map((t) => [t.kind, t.text]), [['quoted', 'วันหยุดยืดหยุ่น']]);
  assert.deepEqual(
    termSpans('ส่งงาน in the morning of the day').map((t) => t.text).sort(),
    ['day', 'morning'],
    'stop words are never the point of a sentence',
  );
});

// ---------- choosing the question type ----------

test('the shape of the sentence chooses the question', () => {
  const pool = termPool(FACTS);
  const typeOf = (text: string) => pickType(fact(text), pool);
  assert.equal(typeOf('ห้องเกมหนึ่งห้องรองรับผู้เล่นพร้อมกันได้สูงสุด 1,000 คน'), 'slider', 'one clear number');
  assert.equal(typeOf('ระบบเก็บข้อมูลเกมไว้ใน PostgreSQL ทุกห้อง'), 'quiz', 'a term with three others to stand against');
  assert.equal(typeOf('ชื่อเล่นของทีมที่ดูแลระบบคือ ทีมน้ำแข็ง'), 'type', 'X คือ Y, with nothing to blank but the Y');
  assert.equal(typeOf('ผู้เล่นเข้าร่วมเกมได้โดยไม่ต้องสมัครสมาชิกก่อน'), 'truefalse', 'nothing to blank at all');
  assert.equal(typeOf('ทีมมีสมาชิก 6 คน และดูแลระบบ 3 ระบบ'), 'truefalse', 'two numbers: blanking one asks about neither');
});

// ---------- which facts are used at all ----------

test('facts are dropped for a reason the review screen can say out loud', () => {
  const { keep, dropped } = planFacts([
    fact('สั้นไป'),
    fact('ติดต่อทีมงานได้ที่ someone@mfec.co.th ทุกวันทำการ'),
    fact('โทร 02-123-4567 เพื่อสอบถามเรื่องการใช้งานระบบ'),
    fact('ห้องเกมหนึ่งห้องรองรับผู้เล่นพร้อมกันได้สูงสุด 1,000 คน'),
    fact('ห้องเกมหนึ่งห้องรองรับผู้เล่นพร้อมกันได้สูงสุด 1,000 คน.'),
    fact('ก'.repeat(200)),
  ]);
  assert.deepEqual(dropped.map((d) => d.why), ['short', 'contact', 'contact', 'duplicate', 'long']);
  assert.equal(keep.length, 1);
});

test('one page cannot fill the whole game', () => {
  const many = Array.from({ length: 6 }, (_, i) => fact(`ข้อเท็จจริงลำดับที่ ${i + 1} ของหน้านี้ที่ยาวพอจะถาม`, 'topics/long.md'));
  const { keep, dropped } = planFacts([...many, fact('ข้อเท็จจริงจากอีกหน้าหนึ่งที่ยาวพอจะถาม', 'topics/other.md')]);
  assert.equal(keep.filter((k) => k.page === 'topics/long.md').length, MAX_PER_PAGE);
  assert.equal(keep.filter((k) => k.page === 'topics/other.md').length, 1, 'the quota is per page, not per game');
  assert.ok(dropped.every((d) => d.why === 'per-page'));
});

test('contact details never reach a question, not even as a wrong tile', () => {
  const { game } = buildGame(planFacts([...FACTS, fact('ติดต่อผู้ดูแลระบบได้ที่ admin@mfec.co.th ทุกวัน', 'topics/arena.md')]).keep, {
    title: 'ทดสอบ',
  });
  const text = JSON.stringify(game);
  assert.ok(!text.includes('admin@mfec.co.th'), 'the address is nowhere in the game');
  assert.ok(!text.includes('mfec.co.th'));
});

// ---------- the slider's scale ----------

test('a slider scale is always one a game can be played on', () => {
  const cases: [number, string | undefined][] = [
    [0, undefined],
    [1, 'ข้อ'],
    [3, 'ทีม'],
    [7, 'วัน'],
    [12, 'เดือน'],
    [45, '%'],
    [100, 'เปอร์เซ็นต์'],
    [365, 'วัน'],
    [1000, 'คน'],
    [1654, 'คน'],
    [25_000, 'บาท'],
    [1_200_000, 'บาท'],
    [2026, undefined],
    [1987, undefined],
    [-40, 'เมตร'],
  ];
  for (const [answer, unit] of cases) {
    const s = scaleFor(answer, unit);
    const where = `${answer}${unit ?? ''}`;
    for (const k of ['min', 'max', 'step', 'answer', 'margin'] as const) assert.ok(Number.isInteger(s[k]), `${where}: ${k} ต้องเป็นจำนวนเต็ม`);
    assert.ok(s.min < s.max, `${where}: min < max`);
    assert.ok(s.step >= 1, `${where}: step`);
    assert.equal((s.max - s.min) % s.step, 0, `${where}: the top of the scale is reachable`);
    assert.equal((s.answer - s.min) % s.step, 0, `${where}: the answer lands on a step`);
    assert.ok(s.answer >= s.min && s.answer <= s.max, `${where}: the answer is on the scale`);
    assert.ok(s.margin >= 0, `${where}: margin`);
    assert.ok((s.max - s.min) / s.step <= LIMITS.sliderSteps, `${where}: not too fine to slide`);
    assert.ok(s.margin * 4 < s.max - s.min, `${where}: a guess still has to be close`);
  }
});

test('a percentage gets the scale everyone expects, and a year gets a tight one', () => {
  assert.deepEqual(scaleFor(45, '%'), { min: 0, max: 100, step: 1, answer: 45, margin: 5, unit: '%' });
  const year = scaleFor(2026);
  assert.deepEqual([year.min, year.max, year.step], [2016, 2036, 1]);
  assert.equal(year.unit, undefined);
});

// ---------- the questions themselves ----------

test('every question says where it came from and why that is the answer', () => {
  const { game } = build();
  const questions = allQuestions(game);
  assert.ok(questions.length >= 8, `made ${questions.length} questions`);
  for (const q of questions) {
    assert.ok(q.source?.path, `${q.prompt}: ไม่มีที่มา`);
    assert.ok(q.explanation && q.explanation.length > 0, `${q.prompt}: ไม่มีคำอธิบาย`);
    assert.ok(q.explanation!.length <= LIMITS.explanationMax);
    assert.ok(q.prompt.length <= LIMITS.promptMax, `${q.prompt}: คำถามยาวเกิน`);
    assert.ok(FACTS.some((f) => f.page === q.source!.path), 'the path is one of the pages that were read');
  }
  const cited = questions.find((q) => q.source?.cite);
  assert.equal(cited?.source?.cite, 'sources/arena-rules.md', 'the document the page itself cited is kept');
  assert.equal(cited?.source?.title, 'Pika Arena');
});

test('the whole game passes the same check the editor uses', () => {
  const { game, failed } = build();
  assert.deepEqual(failed, [], 'no fact was left without a question');
  const result = validateGame(game);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join(' / '));
});

test('a blank falls on the term and nowhere else', () => {
  const { game } = build();
  for (const q of allQuestions(game)) {
    if (q.type === 'truefalse') {
      assert.ok(!q.prompt.includes(BLANK), 'a true/false question is a statement, not a gap');
      continue;
    }
    if (q.type === 'slider' || q.type === 'quiz' || q.type === 'type') {
      assert.equal(q.prompt.split(BLANK).length - 1, 1, `${q.prompt}: ต้องมีช่องว่างเดียว`);
    }
  }
});

test('a cloze question stands the answer against three real terms from the same set', () => {
  const { game } = build();
  const quizzes = allQuestions(game).filter((q) => q.type === 'quiz');
  assert.ok(quizzes.length >= 3, `made ${quizzes.length} quiz questions`);
  const pool = new Set(termPool(FACTS).map((t) => t.text.toLowerCase()));
  for (const q of quizzes) {
    assert.equal(q.options.length, 4, q.prompt);
    assert.equal(new Set(q.options.map((o) => o.toLowerCase())).size, 4, `${q.prompt}: ตัวเลือกซ้ำกัน`);
    assert.equal(q.correct.length, 1);
    const answer = q.options[q.correct[0]];
    assert.ok(q.explanation!.includes(answer), `${q.prompt}: คำอธิบายต้องมีคำตอบอยู่ด้วย`);
    for (const o of q.options) {
      assert.ok(pool.has(o.toLowerCase()), `${q.prompt}: "${o}" ไม่ได้มาจากข้อเท็จจริงในชุดนี้`);
      if (o !== answer) assert.ok(!q.explanation!.includes(o), `${q.prompt}: "${o}" อยู่ในประโยคอยู่แล้ว`);
    }
  }
});

test('a date is only ever guessed against other dates', () => {
  const { game } = build();
  const dated = allQuestions(game).filter((q) => q.type === 'quiz' && /\d{4}/.test(q.options[q.correct[0]]));
  assert.ok(dated.length >= 2, `made ${dated.length} date questions`);
  for (const q of dated) for (const o of q.options) assert.match(o, /^\d{1,2} \S+ \d{4}$/, `${q.prompt}: "${o}" ไม่ใช่วันที่`);
});

test('a typed answer is short enough to be typed', () => {
  const { game } = build();
  const typed = allQuestions(game).filter((q) => q.type === 'type');
  assert.ok(typed.length >= 1);
  for (const q of typed) {
    assert.equal(q.options.length, 1);
    assert.ok(q.options[0].length <= LIMITS.typedMax, `${q.options[0]}: ยาวเกินกว่าจะพิมพ์`);
    assert.ok(normalizeTyped(q.options[0]), 'the answer has something to compare');
    assert.ok(!q.options[0].includes(BLANK));
  }
});

test('a true/false question either states the fact or moves its number, and says which', () => {
  const plan: FactPlan = { ...fact('ห้องเกมหนึ่งห้องรองรับผู้เล่นพร้อมกันได้ 1,000 คน'), type: 'truefalse' };
  const seen = new Set<number>();
  for (let seed = 0; seed < 12; seed++) {
    const q = buildQuestion(plan, 'q1', [], seed)!;
    assert.deepEqual(q.options, ['จริง', 'เท็จ']);
    assert.equal(q.correct.length, 1);
    seen.add(q.correct[0]);
    if (q.correct[0] === 0) {
      assert.equal(q.prompt, plan.text, 'a true statement is the page’s own sentence');
      assert.equal(q.explanation, plan.text);
    } else {
      assert.notEqual(q.prompt, plan.text, 'a false statement has to differ from the fact');
      assert.match(q.explanation!, /^ที่ถูกคือ /, 'a false statement must say what the truth was');
      assert.ok(q.explanation!.includes(plan.text), 'and say it in full');
      assert.match(q.prompt, /\d,\d{3}/, 'the moved number is written the way the original was');
    }
  }
  assert.deepEqual([...seen].sort(), [0, 1], 'both a true and a false version are reachable');
});

test('a hedged sentence is never turned into a false one: it was never exact to begin with', () => {
  for (const text of ['ทีมงานใช้เวลาเตรียมงานประมาณ 30 วันต่อหนึ่งกิจกรรม', 'ห้องหนึ่งรับผู้เล่นได้ไม่เกิน 1,000 คนต่อรอบ']) {
    for (let seed = 0; seed < 8; seed++) {
      const q = buildQuestion({ ...fact(text), type: 'truefalse' }, 'q1', [], seed)!;
      assert.equal(q.prompt, text, `${text} (seed ${seed})`);
      assert.deepEqual(q.correct, [0]);
    }
  }
});

test('a type the rules cannot make falls back to one they always can', () => {
  // nothing to blank, so neither a quiz nor a typed answer can be built from it
  const plans: FactPlan[] = [{ ...fact('ผู้เล่นเข้าร่วมเกมได้โดยไม่ต้องสมัครสมาชิกก่อน'), type: 'quiz' }];
  const { questions, failed } = buildQuestions(plans);
  assert.deepEqual(failed, []);
  assert.equal(questions[0].type, 'truefalse');
});

test('a fact too long for a prompt is left out rather than cut in half', () => {
  const long = `ระบบนี้ ${'รองรับการใช้งานหลายรูปแบบ '.repeat(10)}ได้`;
  assert.ok(long.length > LIMITS.promptMax);
  const { keep, dropped } = planFacts([fact(long)]);
  assert.deepEqual(keep, [], 'it never even becomes a plan');
  assert.equal(dropped[0].why, 'long');
});

// ---------- the game around the questions ----------

test('a round is named after its page while a page can fill one', () => {
  const { game } = build();
  assert.ok(game.rounds.length >= 2, `made ${game.rounds.length} rounds`);
  for (const round of game.rounds) {
    assert.ok(round.questions.length >= 2, `${round.title}: a round of one question is not a round`);
    const pages = new Set(round.questions.map((q) => q.source!.path));
    if (pages.size === 1) {
      const title = FACTS.find((f) => f.page === [...pages][0])!.pageTitle;
      assert.equal(round.title, title, 'a round from one page carries that page’s name');
    } else assert.match(round.title, /^ด่านที่ \d+$/, 'a round from several pages is numbered, not named after one of them');
  }
});

test('a round falls back to the file name when the page has no title', () => {
  const plans = planFacts([
    fact('ข้อเท็จจริงข้อแรกของหน้านี้ที่ยาวพอจะถามได้', 'topics/leave-policy.md'),
    fact('ข้อเท็จจริงข้อที่สองของหน้านี้ที่ยาวพอจะถามได้', 'topics/leave-policy.md'),
    fact('ข้อเท็จจริงข้อที่สามของหน้านี้ที่ยาวพอจะถามได้', 'topics/leave-policy.md'),
  ]).keep;
  assert.equal(buildGame(plans, { title: 'ทดสอบ' }).game.rounds[0].title, 'leave policy');
});

test('the game says where it came from and that it still needs reading', () => {
  const { game } = build();
  assert.equal(game.title, 'ทดสอบคลังความรู้');
  assert.equal(game.description, `สร้างจากคลังความรู้ ${PAGES} หน้า ${allQuestions(game).length} คำถาม ตรวจและแก้ก่อนนำไปเล่น`);
  assert.equal(game.settings?.streakBonus, false);
  assert.ok(game.cover?.emoji);
  assert.ok(game.title.length <= LIMITS.titleMax);
  assert.ok(game.description!.length <= LIMITS.descriptionMax);
});

test('an untitled request still gets a game with a name', () => {
  const { game } = buildGame(planFacts(FACTS).keep, { title: '   ' });
  assert.equal(game.title, 'ควิซจากคลังความรู้');
  assert.equal(validateGame(game).ok, true);
});

test('no facts means an empty game, not a broken one', () => {
  const { game, failed } = buildGame([], { title: 'ว่างเปล่า' });
  assert.deepEqual(failed, []);
  assert.equal(game.rounds.length, 1);
  assert.deepEqual(game.rounds[0].questions, []);
  assert.equal(validateGame(game).ok, false, 'and the caller is told, rather than saving a game nobody can play');
});

test('the same facts always make the same game', () => {
  assert.deepEqual(build().game, build().game);
  assert.deepEqual(buildGame(planFacts(FACTS).keep, { title: 'ก' }).game.rounds, build().game.rounds);
});

test('a question carries no more time than a game allows', () => {
  for (const q of allQuestions(build().game)) {
    assert.ok(q.timeLimitS >= LIMITS.timeMinS && q.timeLimitS <= LIMITS.timeMaxS, `${q.prompt}: ${q.timeLimitS}`);
  }
});

test('a game never comes out bigger than a room can open', () => {
  const many = Array.from({ length: 60 }, (_, i) =>
    fact(`ข้อเท็จจริงลำดับที่ ${i + 1} ที่ยาวพอจะตั้งเป็นคำถามได้จริง`, `topics/page-${Math.floor(i / 3)}.md`),
  );
  const { game } = buildGame(planFacts(many).keep, { title: 'ชุดใหญ่' });
  const result = validateGame(game);
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join(' / '));
  assert.ok(game.rounds.length <= LIMITS.roundsMax);
  assert.ok(allQuestions(game).length <= LIMITS.questionsMax);
});

// ---------- the exam style ----------

/** what the knowledge base gave for one test document (2026-11-11): the same facts on three pages */
const REAL: SourceFact[] = (
  [
    ['sources/policy.md', 'เอกสารทดสอบ นโยบายการใช้ Pika Arena', 'Pika Arena คือเว็บเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรมภายในบริษัท'],
    ['sources/policy.md', 'เอกสารทดสอบ นโยบายการใช้ Pika Arena', 'ห้องหนึ่งห้องรับผู้เล่นได้สูงสุด 200 คน'],
    ['sources/policy.md', 'เอกสารทดสอบ นโยบายการใช้ Pika Arena', 'ผู้เล่นเข้าร่วมด้วย PIN 6 หลัก โดยไม่ต้องเข้าสู่ระบบ'],
    ['sources/policy.md', 'เอกสารทดสอบ นโยบายการใช้ Pika Arena', 'เกมหนึ่งเกมมีคำถามได้ไม่เกิน 100 ข้อ และไม่เกิน 20 ด่าน'],
    ['sources/policy.md', 'เอกสารทดสอบ นโยบายการใช้ Pika Arena', 'เกมที่สร้างจากคลังความรู้ Pika แชร์เข้าคลังกลางไม่ได้'],
    ['sources/policy.md', 'เอกสารทดสอบ นโยบายการใช้ Pika Arena', 'ระบบเก็บรายงานผลการเล่นไว้ 90 วัน แล้วลบทิ้งอัตโนมัติ'],
    ['systems/pika-arena.md', 'Pika Arena', 'เป็นเว็บเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรมภายในบริษัท'],
    ['systems/pika-arena.md', 'Pika Arena', 'ห้องหนึ่งห้องรับผู้เล่นได้สูงสุด 200 คน'],
    ['systems/pika-arena.md', 'Pika Arena', 'มีโหมดข้อสอบที่ใช้ฝึกก่อนสอบจริง'],
    ['systems/pika-arena.md', 'Pika Arena', 'ระบบเก็บรายงานผลการเล่นไว้ 90 วัน'],
    ['topics/retention.md', 'การเก็บรายงานผลการเล่น Pika Arena 90 วัน', 'ระบบเก็บรายงานผลการเล่นไว้ 90 วัน แล้วลบทิ้งอัตโนมัติ'],
  ] as const
).map(([page, pageTitle, text]) => fact(text, page, { pageTitle, cite: 'sources/policy.md' }));

test('a fact the page leaves without a subject gets the page name, and a number never rides in on one', () => {
  const { keep } = planFacts(REAL, { style: 'exam' });
  assert.ok(keep.some((k) => k.text === 'Pika Arena มีโหมดข้อสอบที่ใช้ฝึกก่อนสอบจริง'), keep.map((k) => k.text).join('\n'));
  assert.ok(!keep.some((k) => k.text.startsWith('เป็น') || k.text.startsWith('มี')));
  const titled = fact('เป็นเว็บที่ใช้งานง่ายสำหรับทุกคนในบริษัท', 'topics/a.md', { pageTitle: 'รายงาน 90 วัน' });
  assert.equal(planFacts([titled]).keep[0].text, titled.text);
});

test('the same fact said on three pages, or with a clause added, is asked once', () => {
  const { keep, dropped } = planFacts(REAL, { style: 'exam' });
  assert.equal(keep.length, 7, keep.map((k) => k.text).join('\n'));
  assert.equal(keep.filter((k) => k.text.includes('90 วัน')).length, 1);
  assert.equal(keep.filter((k) => k.text.includes('เว็บเกมตอบคำถาม')).length, 1);
  assert.ok(dropped.every((d) => d.why === 'duplicate'));
});

test('an exam keeps far more of a page than a party game does', () => {
  const many = Array.from({ length: 20 }, (_, i) => fact(`ข้อเท็จจริงลำดับที่ ${i + 1} ของหน้านี้ที่ยาวพอจะถาม`, 'topics/long.md'));
  assert.equal(planFacts(many).keep.length, MAX_PER_PAGE);
  assert.equal(planFacts(many, { style: 'exam' }).keep.length, EXAM_PER_PAGE);
  assert.equal(planFacts(many, { perPage: 7 }).keep.length, 7);
});

test('an exam is four choices or true/false, never a slider or a typed answer', () => {
  for (const facts of [REAL, FACTS]) {
    const { keep } = planFacts(facts, { style: 'exam' });
    assert.ok(keep.every((k) => k.type === 'quiz' || k.type === 'truefalse'));
    const { game, failed } = buildGame(keep, { title: '', style: 'exam' });
    assert.equal(failed.length, 0);
    const result = validateGame(game);
    assert.equal(result.ok, true, result.ok ? '' : result.errors.join(' / '));
    for (const q of allQuestions(game)) {
      assert.ok(q.type === 'quiz' || q.type === 'truefalse', q.type);
      if (q.type === 'quiz') {
        assert.equal(q.options.length, 4, q.prompt);
        assert.equal(new Set(q.options).size, 4, q.prompt);
        assert.equal(q.correct.length, 1);
      }
      assert.ok(q.explanation && q.source, q.prompt);
    }
    assert.equal(game.cover?.emoji, '📝');
    assert.equal(game.title, 'ข้อสอบจากคลังความรู้');
  }
});

test('a number is asked among its neighbours on its own scale', () => {
  const ask = (text: string) => {
    const [q] = buildQuestions([{ ...fact(text), type: 'quiz' }], { style: 'exam' }).questions;
    assert.equal(q.type, 'quiz', text);
    return { options: q.options, answer: q.options[q.correct[0]], prompt: q.prompt };
  };
  const room = ask('ห้องหนึ่งห้องรับผู้เล่นได้สูงสุด 200 คน');
  assert.equal(room.answer, '200');
  assert.ok(room.prompt.endsWith(`สูงสุด ${BLANK} คน`), room.prompt);
  assert.ok(room.options.every((o) => Number(o) > 0 && Number(o) % 50 === 0), room.options.join());
  assert.deepEqual(room.options.map(Number), room.options.map(Number).sort((a, b) => a - b));
  assert.ok(ask('ทีมเริ่มใช้งานระบบนี้จริงในปี 2026 เป็นต้นมา').options.every((y) => Math.abs(Number(y) - 2026) <= 3));
  assert.ok(ask('ผู้ใช้ส่วนใหญ่พอใจกับระบบนี้ถึง 98% จากแบบสอบถาม').options.every((o) => Number(o) <= 100));
  assert.ok(ask('ทีมดูแลระบบนี้มีสมาชิกทั้งหมด 1 คนในตอนเริ่มต้น').options.every((o) => Number(o) >= 1));
  assert.ok(ask('ระบบรองรับผู้เล่นรวมกันได้ถึง 1,000 คนต่อวัน').options.some((o) => o.includes(',')));
  assert.ok(ask('ค่าความหน่วงเฉลี่ยของระบบอยู่ที่ 0.5 วินาทีต่อคำขอ').options.every((o) => /^\d+\.\d$/.test(o)));
});

test('where the right number sits among the four changes from fact to fact', () => {
  const texts = Array.from({ length: 24 }, (_, i) => `ระบบนี้มีผู้ใช้งานประจำทั้งหมด ${(i + 3) * 40} คนในทุกแผนก`);
  const { questions } = buildQuestions(texts.map((t) => ({ ...fact(t), type: 'quiz' as const })), { style: 'exam' });
  assert.ok(new Set(questions.map((q) => q.correct[0])).size >= 3, questions.map((q) => q.correct[0]).join());
});

test('"X คือ Y" is asked as "X คืออะไร" against the other things the pages define', () => {
  const defs = [
    'Pika Arena คือเว็บเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรม',
    'โหมดข้อสอบคือหน้าฝึกทำข้อสอบแบบสี่ตัวเลือกพร้อมเฉลย',
    'คลังกลางคือที่รวมเกมที่ทุกคนในบริษัทนำไปใช้ต่อได้',
    'รายงานผลคือสรุปคะแนนของผู้เล่นทุกคนหลังจบเกม',
  ].map((t) => fact(t));
  const { keep } = planFacts(defs, { style: 'exam' });
  const { questions } = buildQuestions(keep, { style: 'exam' });
  const q = questions[0];
  assert.equal(q.prompt, 'Pika Arena คืออะไร');
  assert.equal(q.options[q.correct[0]], 'เว็บเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรม');
  assert.equal(q.options.length, 4);
});

test('an exam true/false is sometimes the fact made false, and then says what is true', () => {
  const texts = [
    'เกมที่สร้างจากคลังความรู้ Pika แชร์เข้าคลังกลางไม่ได้',
    'ผู้เล่นเข้าร่วมเกมได้โดยไม่ต้องสมัครสมาชิกก่อน',
    'ผู้ดูแลระบบไม่สามารถลบรายงานของผู้อื่นได้เลย',
    'คนที่ไม่ได้ล็อกอินยังเปิดลิงก์ข้อสอบได้ตามปกติ',
  ];
  const all = texts.flatMap((t) =>
    Array.from({ length: 6 }, (_, seed) => buildQuestion({ ...fact(t), type: 'truefalse' }, 'q', [], seed, { style: 'exam' })!),
  );
  const lies = all.filter((q) => q.correct[0] === 1);
  assert.ok(lies.length > 0 && lies.length < all.length, `${lies.length}/${all.length}`);
  for (const q of lies) {
    assert.ok(!q.prompt.includes('ไม่'), q.prompt);
    assert.match(q.explanation!, /^ที่ถูกคือ /);
  }
  // a sentence with two negatives is never turned around: which one would be the lie?
  const twice = 'ระบบไม่เก็บข้อมูลที่ไม่จำเป็นต่อการเล่นเกมเลย';
  for (let seed = 0; seed < 6; seed++) {
    assert.deepEqual(buildQuestion({ ...fact(twice), type: 'truefalse' }, 'q', [], seed, { style: 'exam' })!.correct, [0]);
  }
});
