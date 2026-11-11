/**
 * "ให้ AI ออกข้อสอบ", end to end on the server: what a browser may send, how Claude's answer is read
 * (whole, cut short, wrapped in a code fence, or partly wrong), and the route's stream, quotas and
 * failures. The provider is a small http server started here that streams the Messages API's
 * server-sent events, so every way an answer can arrive is covered. The document itself must never
 * reach a log or the database, and the key never a browser.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { LIMITS, sheetGames, validateGame } from '@pika-arena/shared';
import { GET, POST } from '@/app/api/exam-ai/quiz/route';
import { AI_DEFAULTS, aiConfig } from './ai';
import { QUIZ_LIMITS, questionsSoFar, quizFromText, quizInstructions, quizMaxTokens, readQuizItem, readQuizRequest, scanQuiz } from './ai-quiz';
import { upsertUser } from './auth';
import { getDb, type Db } from './db';
import { HttpError } from './http';
import { createSession } from './session';

const DIR = mkdtempSync(path.join(tmpdir(), 'ib-ai-quiz-'));
process.env.IB_DATA_DIR = DIR;
process.env.AUTH_MODE = 'mock';
(process.env as Record<string, string>).NODE_ENV = 'test';
delete process.env.DATABASE_URL;
mkdirSync(path.join(DIR, 'secrets'), { recursive: true });

const KEY = 'sk-ant-TESTONLY-quiz-0123456789abcdef';
const aiFile = path.join(DIR, 'secrets', 'ai.json');

/** a document with a marker that must never show up anywhere but at the provider */
const MARK = 'DOC-MARKER-7f3a';
const DOC = `นโยบายการลาของบริษัท ${MARK}\n\n${'พนักงานมีสิทธิ์ลาพักร้อนปีละ 10 วันทำการ ต้องแจ้งหัวหน้าล่วงหน้าอย่างน้อย 3 วัน และบันทึกในระบบ HR ทุกครั้ง '.repeat(4)}\n\nค่าใช้จ่ายเดินทางเบิกได้ภายใน 30 วันพร้อมใบเสร็จ`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- what Claude writes ----------

const item = (i: number, extra: Record<string, unknown> = {}) => ({
  topic: i <= 3 ? 'การลาพักร้อน' : 'การเบิกค่าใช้จ่าย',
  question: `คำถามข้อที่ ${i} เรื่องนโยบายของบริษัทคืออะไร`,
  choices: [`คำตอบที่ถูก ${i}`, `ตัวลวงแรก ${i}`, `ตัวลวงสอง ${i}`, `ตัวลวงสาม ${i}`],
  answer: 'A',
  explanation: `เพราะนโยบายเขียนไว้ชัดเจนในข้อ ${i}`,
  quote: `ข้อความจากเอกสาร ${i}`,
  ...extra,
});
const paperJson = (n: number, title = 'ข้อสอบนโยบายบริษัท') => JSON.stringify({ title, questions: Array.from({ length: n }, (_, i) => item(i + 1)) });
/** an answer arrives in pieces, as it does from the API */
const pieces = (s: string, size = 90) => Array.from({ length: Math.ceil(s.length / size) }, (_, i) => s.slice(i * size, (i + 1) * size));

// ---------- the AI provider ----------

interface Script {
  /** an HTTP error instead of a stream */
  status?: number;
  body?: unknown;
  chunks?: string[];
  stop?: string;
  delayMs?: number;
  /** a pause after the text, before the end: a slow model */
  holdMs?: number;
  thinking?: boolean;
  /** the stream breaks off with an error event */
  midError?: boolean;
  outTokens?: number;
}
let next: Script[] = [];
const seen: { url: string; headers: IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
let closedEarly = 0;

let provider: Server;
let baseUrl = '';
let db: Db;
const cookies: string[] = [];

before(async () => {
  provider = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      void (async () => {
        seen.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(raw || '{}') });
        const s = next.shift() ?? { chunks: pieces(paperJson(5)) };
        await sleep(s.delayMs ?? 0);
        if (s.status) {
          res.writeHead(s.status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
          res.end(JSON.stringify(s.body ?? {}));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'x-should-retry': 'false' });
        let gone = false;
        res.on('close', () => {
          if (!res.writableFinished) {
            gone = true;
            closedEarly++;
          }
        });
        const ev = (type: string, data: Record<string, unknown> = {}) => !gone && res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev('message_start', {
          message: { id: 'msg_quiz', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1 } },
        });
        let index = 0;
        if (s.thinking) {
          ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
          // thinking that looks like an answer must not count as one
          ev('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: '"quote": "not yet", "quote": "nor this"' } });
          ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig' } });
          ev('content_block_stop', { index: 0 });
          index = 1;
        }
        ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
        for (const text of s.chunks ?? pieces(paperJson(5))) {
          ev('content_block_delta', { index, delta: { type: 'text_delta', text } });
          await sleep(2);
        }
        if (s.holdMs) await sleep(s.holdMs);
        if (gone) return;
        if (s.midError) {
          ev('error', { error: { type: 'overloaded_error', message: `Overloaded ${KEY}` } });
          res.end();
          return;
        }
        ev('content_block_stop', { index });
        ev('message_delta', { delta: { stop_reason: s.stop ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: s.outTokens ?? 4000 } });
        ev('message_stop');
        res.end();
      })();
    });
  });
  await new Promise<void>((done) => provider.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

  db = await getDb();
  for (let i = 0; i < 5; i++) {
    const u = await upsertUser(db, { issuer: 'mock', subject: `quiz-${i}`, name: `Maker ${i}` });
    cookies.push(`ib_sid=${await createSession(db, u.id)}`);
  }
});

after(async () => {
  await db?.close();
  provider?.close();
  rmSync(DIR, { recursive: true, force: true });
});

const setAi = (c: Record<string, unknown> | null) => {
  if (c === null) rmSync(aiFile, { force: true });
  else writeFileSync(aiFile, JSON.stringify({ apiKey: KEY, baseUrl, ...c }));
};

beforeEach(async () => {
  setAi({});
  next = [];
  seen.length = 0;
  closedEarly = 0;
  await db.query('DELETE FROM ib_ai_usage');
  await db.query("DELETE FROM ib_audit_log WHERE action = 'ai_quiz'");
});

function write(a: { body?: Record<string, unknown>; cookie?: string | null; signal?: AbortSignal; headers?: Record<string, string> } = {}) {
  const cookie = a.cookie === undefined ? cookies[0] : a.cookie;
  return POST(
    new Request('http://localhost/api/exam-ai/quiz', {
      method: 'POST',
      headers: { 'x-ib-req': '1', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...a.headers },
      body: JSON.stringify({ text: DOC, name: 'นโยบาย.docx', count: 5, level: 'mixed', language: 'th', focus: '', ...a.body }),
      signal: a.signal,
    }),
  );
}

type Line = Record<string, unknown> & { t?: string };

async function lines(res: Response): Promise<{ status: number; type: string; text: string; lines: Line[]; last: Line }> {
  const text = await res.text();
  const all = text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text, lines: all, last: all.at(-1) ?? {} };
}

const status = (cookie: string | null = cookies[0]!) =>
  GET(new Request('http://localhost/api/exam-ai/quiz', { headers: cookie ? { cookie } : {} })).then((r) => r.json() as Promise<Record<string, unknown>>);

const usage = () => db.query<{ who: string; asks: number; tokens_in: string; tokens_out: string }>('SELECT who, asks, tokens_in, tokens_out FROM ib_ai_usage ORDER BY who');
const asks = async () => (await usage()).reduce((n, r) => n + r.asks, 0);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof HttpError ? `${e.status} ${e.code}` : String(e);
  }
  return 'ok';
};

// ---------- what a browser may send ----------

test('the request is checked: length, count, level, language, and one-line name and focus', () => {
  const base = { text: DOC, count: 10 };
  assert.equal(code(() => readQuizRequest({ ...base, text: 'สั้นไป' })), '400 quiz_text_short');
  // the length counts characters, not the blank lines and spaces around them
  assert.equal(code(() => readQuizRequest({ ...base, text: `${'ก'.repeat(150)}\n\n\n\n\n${' '.repeat(100)}` })), '400 quiz_text_short');
  assert.equal(code(() => readQuizRequest({ ...base, text: 'ก'.repeat(QUIZ_LIMITS.textMax + 1) })), '400 quiz_text_long');
  assert.equal(code(() => readQuizRequest({ ...base, text: 'ก'.repeat(QUIZ_LIMITS.textMax) })), 'ok');
  for (const count of [0, 7, 21, '10', null, 10.5]) assert.equal(code(() => readQuizRequest({ ...base, count })), '400 bad_request', String(count));
  assert.equal(code(() => readQuizRequest({ count: 10 })), '400 quiz_text_short');

  const r = readQuizRequest({
    text: `บรรทัดแรก\r\n\r\n\r\n\r\nบรรทัดสอง   \r\n${DOC}`,
    count: 15,
    level: 'impossible',
    language: 'fr',
    name: 'ชื่อ\u0000ไฟล์\nสอง   บรรทัด',
    focus: `  บทที่ 3\t${'ย'.repeat(400)}`,
  });
  assert.ok(r.text.startsWith('บรรทัดแรก\n\nบรรทัดสอง\n'));
  assert.equal(r.count, 15);
  assert.equal(r.level, 'mixed');
  assert.equal(r.language, 'th');
  assert.equal(r.name, 'ชื่อ ไฟล์ สอง บรรทัด');
  assert.equal(r.focus.length, QUIZ_LIMITS.focusMax);
  assert.ok(r.focus.startsWith('บทที่ 3 ย'));
  assert.equal(readQuizRequest({ ...base, level: 'hard', language: 'same' }).language, 'same');

  const told = quizInstructions(readQuizRequest({ ...base, level: 'easy', focus: 'การลา' }));
  assert.match(told, /Write 10 questions\./);
  assert.match(told, /easy/);
  assert.match(told, /Thai/);
  assert.match(told, /concentrate on: การลา/);
  assert.equal(quizMaxTokens(20), 26_000);
  assert.ok(quizMaxTokens(20) <= 32_000);
});

// ---------- reading what Claude wrote ----------

test('the answer is read whole, inside a code fence, or cut short: every finished question counts', () => {
  const whole = paperJson(3, 'ชื่อที่มี "คำพูด" และ \\ ทับ');
  const a = scanQuiz(whole);
  assert.equal(a.items.length, 3);
  assert.equal(a.title, 'ชื่อที่มี "คำพูด" และ \\ ทับ');

  assert.equal(scanQuiz(`นี่คือข้อสอบ\n\`\`\`json\n${paperJson(4)}\n\`\`\`\n`).items.length, 4);

  // cut in the middle of the third question: two survive
  const cut = paperJson(3).slice(0, paperJson(3).lastIndexOf('"explanation"'));
  assert.equal(scanQuiz(cut).items.length, 2);
  assert.equal(scanQuiz('').items.length, 0);
  assert.equal(scanQuiz('{"title": "x"}').title, 'x');

  // braces and brackets inside strings don't confuse it; a broken object is skipped, the next one kept
  const tricky = `{"title":"t","questions":[{"question":"ค่า { ไม่ปิด [ และ \\"}\\" ","x":1},{"question": oops},{"question":"ข้อสาม"}]}`;
  const t = scanQuiz(tricky);
  assert.deepEqual(
    t.items.map((i) => (i as { question: string }).question),
    ['ค่า { ไม่ปิด [ และ "}" ', 'ข้อสาม'],
  );
  // what comes after the questions array is not read as questions
  assert.equal(scanQuiz('{"questions":[{"a":1}],"more":[{"b":2}]}').items.length, 1);

  assert.equal(questionsSoFar(paperJson(6)), 6);
  assert.equal(questionsSoFar(cut), 2);
  assert.equal(questionsSoFar('"quote": "unfinished'), 0);
});

test('each question is checked against the editor\'s limits', () => {
  const ok = readQuizItem(item(1));
  assert.ok(ok);
  assert.equal(ok.correct, 0);
  assert.equal(ok.topic, 'การลาพักร้อน');

  const bad: [string, Record<string, unknown>][] = [
    ['three choices', { choices: ['ก', 'ข', 'ค'] }],
    ['five choices', { choices: ['ก', 'ข', 'ค', 'ง', 'จ'] }],
    ['an empty choice', { choices: ['ก', '  ', 'ค', 'ง'] }],
    ['same choice twice', { choices: ['Yes', 'yes', 'ค', 'ง'] }],
    ['a choice too long', { choices: ['ก'.repeat(LIMITS.optionMax + 1), 'ข', 'ค', 'ง'] }],
    ['a question too long', { question: 'ก'.repeat(LIMITS.promptMax + 1) }],
    ['a question too short', { question: 'ข้อ' }],
    ['no answer', { answer: '' }],
    ['answer E', { answer: 'E' }],
    ['answer AB', { answer: 'AB' }],
    ['answer as a number', { answer: 0 }],
    ['choices not a list', { choices: 'ก ข ค ง' }],
  ];
  for (const [why, extra] of bad) assert.equal(readQuizItem(item(1, extra)), null, why);
  for (const v of [null, 'text', [], 3]) assert.equal(readQuizItem(v), null);

  const fixed = readQuizItem(item(1, { answer: ' c ', topic: '', explanation: 'ย'.repeat(900), question: '  ข้อนี้\nมีสอง\u0007บรรทัด  ' }))!;
  assert.equal(fixed.correct, 2);
  assert.equal(fixed.topic, 'ทั่วไป');
  assert.ok(fixed.explanation.length <= LIMITS.explanationMax);
  assert.ok(fixed.explanation.endsWith('…'));
  assert.equal(fixed.prompt, 'ข้อนี้ มีสอง บรรทัด');
});

test('the paper: at most what was asked, no repeats, the answer moved around, one round a topic, saveable', () => {
  // seven written, five asked: the extra two are not counted as faults
  const seven = quizFromText(paperJson(7), 5);
  assert.equal(seven.count, 5);
  assert.equal(seven.dropped, 0);
  assert.equal(seven.title, 'ข้อสอบนโยบายบริษัท');
  assert.deepEqual(
    seven.rounds.map((r) => [r.id, r.title, r.questions.length]),
    [
      ['r1', 'การลาพักร้อน', 3],
      ['r2', 'การเบิกค่าใช้จ่าย', 2],
    ],
  );
  const qs = seven.rounds.flatMap((r) => r.questions);
  assert.deepEqual(
    qs.map((q) => q.id),
    ['ai1', 'ai2', 'ai3', 'ai4', 'ai5'],
  );
  assert.deepEqual(Object.keys(seven.quotes), ['ai1', 'ai2', 'ai3', 'ai4', 'ai5']);
  assert.equal(seven.quotes.ai2, 'ข้อความจากเอกสาร 2');
  for (const [i, q] of qs.entries()) {
    assert.equal(q.type, 'quiz');
    assert.equal(q.correct.length, 1);
    assert.equal(q.options[q.correct[0]!], `คำตอบที่ถูก ${i + 1}`, 'the right answer stays right after the shuffle');
    assert.equal(q.explanation, `เพราะนโยบายเขียนไว้ชัดเจนในข้อ ${i + 1}`);
  }

  // Claude put every answer at A; after the shuffle they are spread out
  const twenty = quizFromText(paperJson(20), 20);
  const places = new Set(twenty.rounds.flatMap((r) => r.questions.map((q) => q.correct[0])));
  assert.ok(places.size > 1, 'the answer is not always in the same place');

  // a repeat (spacing and question marks aside) and a broken one are dropped and counted
  const items = [item(1), item(1, { question: 'คำถามข้อที่  1 เรื่องนโยบายของบริษัทคืออะไร ?' }), item(2, { answer: 'Z' }), item(3)];
  const mixed = quizFromText(JSON.stringify({ title: 't', questions: items }), 10);
  assert.equal(mixed.count, 2);
  assert.equal(mixed.dropped, 2);

  // a choice that points at the others keeps its place
  const allOf = item(1, { choices: ['ข้อ ก และ ข', 'ถูกทุกข้อ', 'ไม่มีข้อใดถูก', 'เฉพาะข้อ ก'], answer: 'B' });
  for (let i = 0; i < 10; i++) {
    const q = quizFromText(JSON.stringify({ questions: [allOf] }), 5).rounds[0]!.questions[0]!;
    assert.deepEqual([q.options[1], q.correct], ['ถูกทุกข้อ', [1]]);
  }

  // more topics than a game holds rounds: the rest join the last round, nothing is lost
  const many = Array.from({ length: 20 }, (_, i) => item(i + 1, { topic: `หัวข้อที่ ${i + 1}` }));
  const wide = quizFromText(JSON.stringify({ title: 'กว้าง', questions: many }), 20);
  assert.ok(wide.rounds.length <= LIMITS.roundsMax);
  assert.equal(
    wide.rounds.reduce((n, r) => n + r.questions.length, 0),
    20,
  );

  // what comes back goes through the import screen's own save as it is
  for (const paper of [seven, twenty, wide]) {
    const saved = sheetGames(paper.rounds, { title: paper.title || 'ข้อสอบ' });
    assert.ok(saved.ok, JSON.stringify(!saved.ok && saved.errors));
    for (const g of saved.games) assert.equal(validateGame(g).ok, true);
  }

  // nothing usable at all
  assert.deepEqual(quizFromText('ขอโทษ ออกข้อสอบไม่ได้', 5), { title: '', rounds: [], count: 0, dropped: 0, quotes: {} });
});

// ---------- the route ----------

test('the tab shows only when the admin turned AI on, and asks for a login first', async () => {
  setAi(null);
  assert.deepEqual(await status(), { enabled: false });
  assert.deepEqual([(await write()).status, seen.length], [404, 0]);
  setAi({});
  assert.deepEqual(await status(null), { enabled: true, needsLogin: true });
  assert.deepEqual(await status(), { enabled: true, needsLogin: false, left: AI_DEFAULTS.quizPerPersonPerDay, perDay: AI_DEFAULTS.quizPerPersonPerDay });
  setAi({ quizPerPersonPerDay: 3 });
  assert.equal((await status()).perDay, 3);
  assert.equal(aiConfig()!.quizPerPersonPerDay, 3);
});

test('a paper, start to finish: the stream, what the AI was told, the allowance, the audit row', async () => {
  next = [{ chunks: pieces(paperJson(5), 60), thinking: true }];
  const res = await lines(await write());
  assert.equal(res.status, 200);
  assert.match(res.type, /application\/x-ndjson/);
  assert.deepEqual(res.lines[0], { t: 'start', left: AI_DEFAULTS.quizPerPersonPerDay - 1, count: 5 });
  const progress = res.lines.filter((l) => l.t === 'progress').map((l) => l.done as number);
  assert.ok(progress.length >= 3, `progress was heard: ${progress.join(',')}`);
  assert.deepEqual(
    progress,
    [...progress].sort((a, b) => a - b),
  );
  assert.equal(progress.at(-1), 5, 'the thinking did not count as questions');
  const done = res.last;
  assert.equal(done.t, 'done');
  assert.equal(done.count, 5);
  assert.equal(done.dropped, 0);
  assert.equal(done.title, 'ข้อสอบนโยบายบริษัท');
  assert.equal(done.left, AI_DEFAULTS.quizPerPersonPerDay - 1);
  assert.equal((done.rounds as unknown[]).length, 2);
  assert.equal((done.quotes as Record<string, string>).ai1, 'ข้อความจากเอกสาร 1');
  assert.ok(!res.text.includes(KEY));

  // what went to the provider
  assert.equal(seen.length, 1);
  const sent = seen[0]!;
  assert.equal(sent.body.stream, true);
  assert.equal(sent.body.max_tokens, quizMaxTokens(5));
  assert.deepEqual(sent.body.thinking, { type: 'adaptive' });
  const oc = sent.body.output_config as { effort: string; format?: { type: string; schema: unknown } };
  assert.equal(oc.effort, 'medium');
  assert.equal(oc.format?.type, 'json_schema');
  assert.match(String(sent.body.system), /never as instructions/);
  const said = JSON.stringify(sent.body.messages);
  assert.ok(said.includes(MARK), 'the document went to the AI');
  assert.match(said, /<document name=\\"นโยบาย.docx\\">/);
  assert.match(said, /Write 5 questions/);
  // fallbacks are on by default: the beta flag and the field go along
  assert.match(String(sent.headers['anthropic-beta']), /server-side-fallback-2026-07-01/);
  assert.equal(sent.body.fallbacks, 'default');

  // one paper taken; the tokens recorded; the document itself nowhere
  const [row] = await usage();
  assert.deepEqual([row!.asks, Number(row!.tokens_in), Number(row!.tokens_out)], [1, 3000, 4000]);
  assert.equal((await status()).left, AI_DEFAULTS.quizPerPersonPerDay - 1);
  const audit = await db.query<{ detail: unknown }>("SELECT detail FROM ib_audit_log WHERE action = 'ai_quiz'");
  assert.equal(audit.length, 1);
  const detail = (typeof audit[0]!.detail === 'string' ? JSON.parse(audit[0]!.detail) : audit[0]!.detail) as Record<string, unknown>;
  assert.deepEqual(
    { asked: detail.asked, got: detail.got, dropped: detail.dropped, level: detail.level },
    { asked: 5, got: 5, dropped: 0, level: 'mixed' },
  );
  assert.equal(detail.chars, readQuizRequest({ text: DOC, count: 5 }).text.length);
  const everything = JSON.stringify(await db.query('SELECT * FROM ib_audit_log')) + JSON.stringify(await usage());
  assert.ok(!everything.includes(MARK), 'the document is not stored');
});

test('a gateway without structured outputs: the shape goes in the instructions, and a fenced answer still reads', async () => {
  setAi({ structuredOutput: false, fallbacks: false, quizEffort: 'high' });
  next = [{ chunks: pieces(`ได้เลย\n\`\`\`json\n${paperJson(5)}\n\`\`\``) }];
  const res = await lines(await write({ body: { count: 10 } }));
  assert.equal(res.last.t, 'done');
  assert.equal(res.last.count, 5);
  const sent = seen[0]!;
  const oc = sent.body.output_config as { effort: string; format?: unknown };
  assert.deepEqual(oc, { effort: 'high' });
  assert.match(String(sent.body.system), /Answer with one JSON object only/);
  assert.equal(sent.headers['anthropic-beta'], undefined);
  assert.equal(sent.body.fallbacks, undefined);
  assert.equal(sent.body.max_tokens, quizMaxTokens(10));
});

test('refusals before the AI is asked are plain JSON errors and take nothing', async () => {
  const plain = async (res: Response) => [res.status, ((await res.json()) as { error: string }).error];
  assert.deepEqual(await plain(await write({ cookie: null })), [401, 'login_required']);
  assert.deepEqual(await plain(await write({ headers: { 'x-ib-req': '' } })), [403, 'forbidden']);
  const short = await write({ body: { text: 'สั้น' } });
  assert.equal(short.status, 400);
  assert.deepEqual(await short.json(), { error: 'quiz_text_short', min: QUIZ_LIMITS.textMin });
  assert.deepEqual(await plain(await write({ body: { count: 50 } })), [400, 'bad_request']);
  assert.equal(seen.length, 0);
  assert.equal(await asks(), 0);
  // and none of them left the maker marked as busy
  assert.equal((await lines(await write())).last.t, 'done');
});

test('each maker has a daily allowance of papers, and the site has its ceiling', async () => {
  setAi({ quizPerPersonPerDay: 2, perDay: 3 });
  const outcome = async (cookie: string) => {
    const res = await write({ cookie });
    if (res.status !== 200) {
      const body = (await res.json()) as Record<string, unknown>;
      return `${res.status} ${body.error}:${body.scope}:${body.perDay}:${body.left}`;
    }
    return (await lines(res)).last.left;
  };
  assert.equal(await outcome(cookies[0]!), 1);
  assert.equal(await outcome(cookies[0]!), 0);
  assert.equal(await outcome(cookies[0]!), '429 ai_limit:person:2:0');
  assert.equal((await status()).left, 0);
  assert.equal(await outcome(cookies[1]!), 1);
  assert.equal(await outcome(cookies[2]!), '429 ai_limit:site:2:0');
  assert.equal(seen.length, 3);
});

test('one paper at a time for a maker, and a few at once for the whole site', async () => {
  next = [{ delayMs: 250 }];
  const first = await write();
  assert.equal(first.status, 200, 'the stream starts at once');
  const again = await write();
  assert.deepEqual([again.status, ((await again.json()) as { error: string }).error], [429, 'quiz_running']);
  assert.equal((await lines(first)).last.t, 'done');

  next = [{ delayMs: 300 }, { delayMs: 300 }, { delayMs: 300 }];
  const three = await Promise.all([0, 1, 2].map((i) => write({ cookie: cookies[i] })));
  const fourth = await write({ cookie: cookies[3] });
  assert.deepEqual([fourth.status, ((await fourth.json()) as { error: string }).error], [503, 'ai_busy']);
  for (const r of three) assert.equal((await lines(r)).last.t, 'done');
  // the places are given back once they finish, including the refused one's
  assert.equal((await lines(await write({ cookie: cookies[3] }))).last.t, 'done');
  assert.equal(await asks(), 5);
});

test('when the AI fails the paper is given back; a refusal counts; nothing usable is given back', async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(' '));
  try {
    const outcome = async (s: Script) => {
      next = [s];
      const res = await lines(await write());
      assert.equal(res.status, 200);
      assert.ok(!res.text.includes(KEY), res.text);
      return `${res.last.t} ${res.last.error ?? res.last.count}`;
    };
    const err = (type: string, message: string) => ({ type: 'error', error: { type, message } });
    assert.equal(await outcome({ status: 500, body: err('api_error', `boom ${KEY}`) }), 'error ai_unavailable');
    assert.equal(await outcome({ status: 529, body: err('overloaded_error', 'busy') }), 'error ai_unavailable');
    assert.equal(await outcome({ status: 429, body: err('rate_limit_error', 'slow down') }), 'error ai_busy');
    assert.equal(await outcome({ status: 401, body: err('authentication_error', 'invalid key') }), 'error ai_unavailable');
    assert.equal(await outcome({ status: 400, body: err('invalid_request_error', 'output_config: Extra inputs are not permitted') }), 'error ai_unavailable');
    assert.equal(await outcome({ chunks: pieces(paperJson(2)), midError: true }), 'error ai_unavailable');
    assert.equal(await asks(), 0, 'none of these took a paper');

    // the AI ran but wrote nothing usable: the paper is given back, the tokens still recorded
    assert.equal(await outcome({ chunks: ['ขออภัย เนื้อหานี้ไม่พอสำหรับออกข้อสอบ'] }), 'error quiz_empty');
    assert.equal(await asks(), 0);
    assert.equal(Number((await usage())[0]!.tokens_in), 3000);

    // a refusal used the AI, so it counts
    assert.equal(await outcome({ chunks: [], stop: 'refusal' }), 'error ai_declined');
    assert.equal(await asks(), 1);

    // cut off at the length limit: the finished questions are the paper
    const cut = paperJson(5);
    assert.equal(await outcome({ chunks: pieces(cut.slice(0, cut.indexOf('"question":"คำถามข้อที่ 4'))), stop: 'max_tokens' }), 'done 3');
    assert.equal(await asks(), 2);
  } finally {
    console.error = original;
  }
  assert.ok(logged.length > 0, 'failures are logged for the admin');
  for (const line of logged) {
    assert.ok(!line.includes(KEY), line);
    assert.ok(!line.includes(MARK), line);
  }
  assert.ok(logged.some((l) => l.includes('refused the key')));
});

/** starts a paper, reads until `until` shows up in the stream, then leaves */
async function leaveAfter(until: string) {
  const leave = new AbortController();
  const res = await write({ signal: leave.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let got = '';
  while (!got.includes(until)) {
    const { value, done } = await reader.read();
    if (done) break;
    got += decoder.decode(value);
  }
  assert.match(got, /"t":"start"/);
  leave.abort();
  await reader.cancel().catch(() => {});
}

test('stopping once the AI has read the document counts; the AI is told to stop', async () => {
  next = [{ chunks: pieces(paperJson(1)), holdMs: 3000 }];
  await leaveAfter('"progress"');
  // the provider hears the connection close, well before it would have finished
  for (let i = 0; i < 50 && closedEarly === 0; i++) await sleep(20);
  assert.equal(closedEarly, 1);
  for (let i = 0; i < 50 && (await asks()) !== 1; i++) await sleep(20);
  const [row] = await usage();
  assert.deepEqual([row!.asks, Number(row!.tokens_in)], [1, 3000], 'the tokens were paid for, so the paper counts');
  // nothing was handed out, so no audit row; and the maker may start again straight away
  assert.equal((await db.query("SELECT 1 FROM ib_audit_log WHERE action = 'ai_quiz'")).length, 0);
  next = [];
  assert.equal((await lines(await write())).last.t, 'done');
  assert.equal(await asks(), 2);
});

test('stopping before the AI has started is free', async () => {
  next = [{ delayMs: 1500 }];
  await leaveAfter('"start"');
  for (let i = 0; i < 100 && (await usage()).some((r) => r.asks > 0); i++) await sleep(20);
  await sleep(100);
  assert.equal(await asks(), 0);
  assert.equal((await status()).left, AI_DEFAULTS.quizPerPersonPerDay);
  await sleep(1500); // let the provider's late answer go nowhere
  next = [];
  assert.equal((await lines(await write())).last.t, 'done');
});

test('an unreachable provider is a failure the maker can retry', async () => {
  setAi({ baseUrl: 'http://127.0.0.1:9' });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await lines(await write());
    assert.deepEqual([res.last.t, res.last.error], ['error', 'ai_unavailable']);
  } finally {
    console.error = original;
  }
  assert.equal(await asks(), 0);
});
