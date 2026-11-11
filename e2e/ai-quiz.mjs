// "ให้ AI ออกข้อสอบ" in a real browser, against a stand-in for the AI provider on this machine that streams
// the way the Messages API does.
// With no var/secrets/ai.json there is no tab, and the AI way on /create says the admin has not turned it on. With
// one: /create opens the tab and says how many papers are left today, the form counts the text and holds the button until there is enough, a .docx opens into the box
// and a PDF says how to paste it instead, the writing shows its progress, the preview quotes the document
// under every question and a question taken out is not saved, going back keeps the form, the saved game is
// a real game (and is deleted at the end), a failure or an empty answer costs nothing, a stop costs one once
// the AI has started and nothing before, the daily allowance greys the button out, phones never scroll
// sideways, and the key and the provider's address never reach the browser.
//
// Local only: it writes <repo>/var/secrets/ai.json for the dev server (which reads it on every request),
// pointing at the stand-in, and removes it at the end. It will not run if that file is already there.
// It needs an account (the tab is for signed-in makers): --login is a file with "username: …" and
// "password: …" lines, as for ask-ai.mjs.
//   node ai-quiz.mjs --login=<file> [--base=http://localhost:3000] [--shots=<dir>]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

import { launchOptions } from './lib/rig.mjs';

const WEB = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? '';
const MOUNT = new URL(WEB).pathname.replace(/\/$/, '');
const LOGIN = process.argv.find((a) => a.startsWith('--login='))?.slice(8) ?? '';
if (!LOGIN) throw new Error('ai-quiz.mjs needs --login=<file> with "username: …" and "password: …" lines: the tab is for signed-in makers');
const who = Object.fromEntries(
  readFileSync(LOGIN, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*(username|password)\s*:\s*(.+?)\s*$/)?.slice(1))
    .filter(Boolean),
);
if (!(who.username && who.password)) throw new Error(`${LOGIN}: want a "username: …" line and a "password: …" line`);
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(WEB)) throw new Error('ai-quiz.mjs writes the AI settings file of the server it checks, so it runs against a dev server on this machine only');

const SECRETS = fileURLToPath(new URL('../var/secrets/', import.meta.url));
const AI_FILE = join(SECRETS, 'ai.json');
if (existsSync(AI_FILE)) throw new Error(`${AI_FILE} is already there: move it away first, this check will not overwrite it`);

const KEY = 'sk-e2e-not-a-real-key-quiz-0123456789';
const MARK = 'E2E-DOC-MARK-91c2';
const DOC = `นโยบายการลาของบริษัท ${MARK}\n\n${'พนักงานมีสิทธิ์ลาพักร้อนปีละ 10 วันทำการ ต้องแจ้งหัวหน้าล่วงหน้าอย่างน้อย 3 วัน และบันทึกในระบบ HR ทุกครั้ง '.repeat(4)}\n\nค่าใช้จ่ายเดินทางเบิกได้ภายใน 30 วันพร้อมใบเสร็จ`;
const FOCUS = 'การลาพักร้อน';
const gamesMade = [];

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (ok) passed++;
  else failed++;
  return ok;
};
const shoot = async (page, name, full = false) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full });
};

// ---------- what Claude writes
const item = (i) => ({
  topic: i <= 3 ? 'การลาพักร้อน' : 'การเบิกค่าใช้จ่าย',
  question: `คำถามทดสอบข้อที่ ${i} นโยบายของบริษัทกำหนดไว้อย่างไร`,
  choices: [`คำตอบที่ถูก ${i}`, `ตัวลวงแรก ${i}`, `ตัวลวงสอง ${i}`, `ตัวลวงสาม ${i}`],
  answer: 'A',
  explanation: `เพราะนโยบายเขียนไว้ชัดเจนในข้อ ${i}`,
  quote: `ข้อความจากเอกสารทดสอบ ${i}`,
});
const PAPER_TITLE = 'ข้อสอบนโยบายการลา (ทดสอบ)';
const paperJson = (n) => JSON.stringify({ title: PAPER_TITLE, questions: Array.from({ length: n }, (_, i) => item(i + 1)) });
const pieces = (s, size = 90) => Array.from({ length: Math.ceil(s.length / size) }, (_, i) => s.slice(i * size, (i + 1) * size));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the stand-in for the AI provider: an SSE stream like the Messages API's
const seen = [];
let next = [];
let closedEarly = 0;
const provider = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    void (async () => {
      seen.push({ url: req.url, headers: req.headers, body: JSON.parse(raw || '{}') });
      const s = next.shift() ?? {};
      let gone = false;
      res.on('close', () => {
        if (!res.writableFinished) {
          gone = true;
          closedEarly++;
        }
      });
      await sleep(s.delayMs ?? 0);
      if (gone) return;
      if (s.status) {
        res.writeHead(s.status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
        res.end(JSON.stringify(s.body ?? { type: 'error', error: { type: 'api_error', message: 'boom' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-should-retry': 'false' });
      const ev = (type, data = {}) => !gone && res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev('message_start', {
        message: { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1 } },
      });
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      for (const text of s.chunks ?? pieces(paperJson(s.n ?? 5))) {
        if (gone) return;
        ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
        await sleep(s.chunkMs ?? 40);
      }
      if (gone) return;
      ev('content_block_stop', { index: 0 });
      ev('message_delta', { delta: { stop_reason: s.stop ?? 'end_turn', stop_sequence: null }, usage: { output_tokens: 2500 } });
      ev('message_stop');
      res.end();
    })();
  });
});
await new Promise((done) => provider.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${provider.address().port}`;
const setAi = (extra = {}) => {
  mkdirSync(SECRETS, { recursive: true });
  writeFileSync(AI_FILE, JSON.stringify({ apiKey: KEY, baseUrl, perPersonPerDay: 1000, perDay: 100000, quizPerPersonPerDay: 200, ...extra }));
};

// ---------- a .docx, written the way Word writes one (only the parts that are read)
function zip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = new Uint8Array(deflateRawSync(raw));
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  return Buffer.concat([...locals, ...centrals, end]);
}
const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const DOCX_LINES = ['คู่มือความปลอดภัยไซเบอร์ DOCX-91c2', ...Array.from({ length: 6 }, (_, i) => `ข้อ ${i + 1}: ห้ามเปิดไฟล์แนบจากอีเมลที่ไม่รู้จัก และต้องรายงานทีม IT ภายใน 1 ชั่วโมงเมื่อพบอีเมลน่าสงสัย`)];
const DOCX = zip({
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${DOCX_LINES.map(para).join('')}</w:body></w:document>`,
});

// ---------- the browser
const browser = await chromium.launch(launchOptions);
const errors = [];
const leaks = [];
const watch = (page, name) => {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools/.test(m.text()) && errors.push(`${name}: ${m.text().slice(0, 160)}`));
  page.on('dialog', (d) => d.accept());
  page.on('response', async (r) => {
    if (!r.url().includes('/api/')) return;
    const text = await r.text().catch(() => '');
    if (text.includes(KEY) || text.includes(baseUrl)) leaks.push(r.url());
  });
};
/** from here on until `allowed()`, the browser logging a refused request is expected */
let failsFrom = -1;
const fails = () => (failsFrom = errors.length);
const allowed = () => {
  const after = errors.splice(failsFrom);
  errors.push(...after.filter((e) => !/Failed to load resource: the server responded with a status of (404|429)/.test(e)));
};
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (loc) => squash(await loc.first().innerText());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

const on = (page) => ({
  tab: (k) => page.getByTestId(`import-tab-${k}`),
  text: page.getByTestId('ai-text'),
  file: page.getByTestId('ai-file'),
  length: page.getByTestId('ai-length'),
  trim: page.getByTestId('ai-trim'),
  focus: page.getByTestId('ai-focus'),
  write: page.getByTestId('ai-write'),
  left: page.getByTestId('ai-left'),
  error: page.getByTestId('ai-error'),
  writing: page.getByTestId('ai-writing'),
  stop: page.getByTestId('ai-stop'),
  count: (n) => page.getByTestId('ai-count').getByRole('radio', { name: `${n} ข้อ`, exact: true }),
  level: (name) => page.getByRole('radiogroup', { name: 'ระดับความยาก' }).getByRole('radio', { name: new RegExp(`^${name}`) }),
  language: (name) => page.getByRole('radiogroup', { name: 'ภาษาของข้อสอบ' }).getByRole('radio', { name, exact: true }),
  review: page.getByTestId('ai-review'),
  summary: page.getByTestId('import-summary'),
  questions: page.getByTestId('import-question'),
  quotes: page.getByTestId('import-quote'),
  keep: page.getByTestId('import-keep'),
  title: page.getByTestId('import-title'),
  save: page.getByTestId('import-save'),
  done: page.getByTestId('import-done'),
  back: page.getByRole('button', { name: 'กลับไปแก้เนื้อหา' }),
});
/** what the server says to this browser's account */
const status = (page) => page.evaluate(async (u) => (await fetch(u, { cache: 'no-store' })).json(), `${MOUNT}/api/exam-ai/quiz`);
const leftNow = async (page) => (await status(page)).left;
const login = async (ctx, nextPath) => {
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login?next=${encodeURIComponent(nextPath)}`, { waitUntil: 'networkidle' });
  await page.locator('#login-user').fill(who.username);
  await page.locator('#login-password').fill(who.password);
  await page.locator('button[type=submit]').click();
  return page;
};
/** the rounds of a stored game, wherever the record keeps them */
const roundsOf = (o) => {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o.rounds)) return o.rounds;
  for (const v of Object.values(o)) {
    const r = roundsOf(v);
    if (r) return r;
  }
  return null;
};

try {
  // ============ AI off: no tab, no button
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await login(ctx, '/host');
  watch(page, 'desk');
  const R = on(page);
  await page.waitForURL(/\/host/, { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  check((await status(page)).enabled === false, 'with no settings file the server says AI is off');
  await page.goto(`${WEB}/create`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid=create-ai]:not([data-state=loading])').waitFor({ timeout: 15000 });
  check(
    (await page.getByTestId('create-ai').getAttribute('data-state')) === 'off' && (await page.getByTestId('create-ai-go').count()) === 0 &&
      (await textOf(page.getByTestId('create-ai-why'))).includes('ผู้ดูแลระบบยังไม่ได้เปิดใช้'),
    'the create page shows the AI card as not turned on yet, with no button',
  );
  await page.goto(`${WEB}/import?ai=1`, { waitUntil: 'networkidle' });
  await R.tab('file').waitFor({ timeout: 15000 });
  check((await R.tab('ai').count()) === 0 && (await R.tab('file').getAttribute('aria-selected')) === 'true', '/import?ai=1 opens on the file tab, with no AI tab');

  // a visitor is not offered it at all
  const visitor = await (await fetch(`${WEB}/api/exam-ai/quiz`)).json();
  check(visitor.enabled === false, 'a visitor hears the same');

  // ============ AI on
  setAi();
  const st = await status(page);
  check(st.enabled === true && st.needsLogin === false && st.perDay === 200 && typeof st.left === 'number', `with the file it is on for this maker (${st.left} of ${st.perDay} left)`);
  const anon = await (await fetch(`${WEB}/api/exam-ai/quiz`)).json();
  check(anon.enabled === true && anon.needsLogin === true && anon.left === undefined, 'a visitor is told to sign in, and hears no counts');
  const refused = await fetch(`${WEB}/api/exam-ai/quiz`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ib-req': '1', origin: new URL(WEB).origin }, body: JSON.stringify({ text: DOC, count: 5 }) });
  check(refused.status === 401 && seen.length === 0, 'and a visitor writing one is turned away before the AI is asked');

  await page.goto(`${WEB}/create`, { waitUntil: 'networkidle' });
  await page.getByTestId('create-ai-go').waitFor({ timeout: 15000 });
  check((await textOf(page.getByTestId('create-ai'))).includes(`วันนี้ใช้ได้อีก ${st.left} จาก 200 ครั้ง`), 'the create page offers the AI, with what is left today');
  await page.getByTestId('create-ai-go').click();
  await page.waitForURL(/\/import\?ai=1/, { timeout: 15000 });
  await R.text.waitFor({ timeout: 15000 });
  check((await R.tab('ai').getAttribute('aria-selected')) === 'true', 'it opens the import page on the AI tab');

  // ---- the form
  let left = await leftNow(page);
  check((await textOf(R.left)) === `วันนี้ใช้ได้อีก ${left} จาก 200 ครั้ง`, `it says how many are left today (${await textOf(R.left)})`);
  check(await R.write.isDisabled(), 'with nothing in the box the button waits');
  await R.text.fill('ก'.repeat(150));
  check((await textOf(R.length)).includes('150 / 40,000 ตัวอักษร · ต้องมีอย่างน้อย 200') && (await R.write.isDisabled()), 'too short: the count says so and the button waits');
  await R.text.fill('ข'.repeat(40_010));
  await R.trim.waitFor({ timeout: 5000 });
  check((await R.write.isDisabled()) && (await textOf(R.length)).startsWith('40,010 / 40,000'), 'too long: the count turns red, the button waits');
  await R.trim.click();
  check((await R.text.inputValue()).length === 40_000 && (await R.write.isEnabled()), '"ใช้ 40,000 ตัวอักษรแรก" cuts it to the limit');

  // a PDF is explained, a .docx opens into the box
  await R.file.setInputFiles({ name: 'policy.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%âãÏÓ\n') });
  await R.error.waitFor({ timeout: 5000 });
  check((await textOf(R.error)).startsWith('ยังอ่านไฟล์ PDF โดยตรงไม่ได้'), 'a PDF says to copy its text and paste it');
  await R.file.setInputFiles({ name: 'คู่มือความปลอดภัย.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: DOCX });
  await page.waitForFunction(() => document.querySelector('[data-testid=ai-text]')?.value.includes('DOCX-91c2'), null, { timeout: 5000 });
  const fromDocx = await R.text.inputValue();
  check(fromDocx === DOCX_LINES.join('\n'), 'a .docx opens into the box, a line a paragraph');
  check((await page.getByText('จากไฟล์ คู่มือความปลอดภัย').count()) === 1 && (await R.error.count()) === 0, 'with the file name shown, and the PDF message gone');
  await shoot(page, '01-docx');

  // the real content, and the choices
  await R.text.fill(DOC);
  await R.count(5).click();
  await R.level('ยาก').click();
  await R.language('ตามภาษาเนื้อหา').click();
  await R.focus.fill(FOCUS);
  check((await R.count(5).getAttribute('aria-checked')) === 'true' && (await R.level('ยาก').getAttribute('aria-checked')) === 'true', 'count and level are picked');
  check((await textOf(R.write)) === '✨ ให้ AI ออกข้อสอบ 5 ข้อ', 'the button says how many it asks for');

  // ---- writing
  next = [{ chunkMs: 120 }];
  const calls = seen.length;
  await R.write.click();
  await R.writing.waitFor({ timeout: 5000 });
  await page.waitForFunction(() => /AI เขียนแล้ว [1-5] จาก 5 ข้อ/.test(document.querySelector('[data-testid=ai-writing]')?.textContent ?? ''), null, { timeout: 15000 });
  check(true, 'while it writes, it counts the questions as they come');
  await shoot(page, '02-writing');
  await R.review.waitFor({ timeout: 30000 });
  check(seen.length === calls + 1, 'the AI was asked once');
  const ask = seen.at(-1);
  const sent = JSON.stringify(ask.body);
  check(ask.url === '/v1/messages' && ask.headers.authorization === `Bearer ${KEY}` && ask.body.stream === true, 'the server streams from the provider with the key from the file');
  check(sent.includes(MARK) && sent.includes(FOCUS), 'the AI got the document and what to focus on');
  check(!JSON.stringify(Object.values(ask.headers)).includes(MARK), 'the document is in the body only');

  check((await textOf(R.summary)).includes('5 ข้อที่จะบันทึก'), 'the preview has the 5 questions to save');
  check((await R.questions.count()) === 5 && (await R.quotes.count()) === 5, 'every question is shown, each with the words of the document it came from');
  check((await textOf(R.quotes)).includes('ข้อความจากเอกสารทดสอบ 1'), 'the quote is the one the AI gave');
  check((await R.title.inputValue()) === PAPER_TITLE, 'the title is the one the AI gave');
  left -= 1;
  check((await leftNow(page)) === left, `a paper written counts one (${left} left)`);
  // a question taken out
  const outPrompt = squash(await R.questions.first().locator('p').first().innerText());
  await R.keep.first().uncheck();
  check((await textOf(R.summary)).includes('4 ข้อที่จะบันทึก') && (await textOf(R.summary)).includes('1 ข้อที่เอาออก'), 'taking one out leaves 4 to save');
  check((await textOf(R.save)) === 'บันทึก 4 ข้อเป็นเกม', 'and the button says 4');
  await shoot(page, '03-preview', true);

  // back keeps the form
  await R.back.click();
  await R.text.waitFor({ timeout: 5000 });
  check((await R.text.inputValue()) === DOC && (await R.focus.inputValue()) === FOCUS && (await R.count(5).getAttribute('aria-checked')) === 'true', '"กลับไปแก้เนื้อหา" finds the form as it was');
  check((await textOf(R.left)) === `วันนี้ใช้ได้อีก ${left} จาก 200 ครั้ง`, 'with the count one less');

  // ---- failures cost nothing
  const failure = async (script, message, what) => {
    next = [script];
    await R.write.click();
    await R.error.waitFor({ timeout: 20000 });
    const said = await textOf(R.error);
    check(said.startsWith(message), `${what} (${said})`);
    check((await leftNow(page)) === left && (await textOf(R.left)).includes(`อีก ${left} จาก`), `  and costs nothing (${left} left)`);
    check((await R.text.inputValue()) === DOC, '  and the text stays');
  };
  await failure({ status: 500 }, 'ตอนนี้ต่อกับ AI ไม่ได้', 'the provider failing says so');
  await failure({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } } }, 'มีคนให้ AI ออกข้อสอบอยู่หลายคน', 'the provider busy says to wait');
  await failure({ chunks: ['ขอโทษครับ เนื้อหานี้ออกข้อสอบไม่ได้'] }, 'AI ยังออกข้อสอบจากเนื้อหานี้ไม่ได้', 'an answer with no questions says so');
  await shoot(page, '04-failure');

  // ---- stopping
  next = [{ chunkMs: 400 }];
  await R.write.click();
  await page.waitForFunction(() => /AI เขียนแล้ว/.test(document.querySelector('[data-testid=ai-writing]')?.textContent ?? ''), null, { timeout: 15000 });
  const early = closedEarly;
  await R.stop.click();
  await R.write.waitFor({ timeout: 5000 });
  left -= 1;
  await page.waitForFunction((k) => document.querySelector('[data-testid=ai-left]')?.textContent?.includes(`อีก ${k} จาก`), left, { timeout: 5000 });
  check((await R.error.count()) === 0, 'a stop after the AI started goes back to the form with no error');
  check((await leftNow(page)) === left, `  and counts one, as the note says (${left} left)`);
  await sleep(300);
  check(closedEarly === early + 1, '  and the server hung up on the provider');

  next = [{ delayMs: 4000 }];
  const before = seen.length;
  await R.write.click();
  await R.writing.waitFor({ timeout: 5000 });
  await sleep(600);
  await R.stop.click();
  await R.write.waitFor({ timeout: 5000 });
  await sleep(1500);
  check(seen.length === before + 1 && (await leftNow(page)) === left && (await textOf(R.left)).includes(`อีก ${left} จาก`), `a stop before the AI answered costs nothing (${left} left)`);

  // ---- the daily allowance
  const used = 200 - left;
  setAi({ quizPerPersonPerDay: used + 1 });
  next = [{}];
  await R.write.click();
  await R.review.waitFor({ timeout: 30000 });
  check((await leftNow(page)) === 0, 'the last paper of the day is written');
  await R.back.click();
  await R.text.waitFor({ timeout: 5000 });
  // (the page learnt the allowance when it loaded, 200; it was lowered behind its back to end the day)
  check((await textOf(R.left)) === 'วันนี้ใช้ครบ 200 ครั้งแล้ว พรุ่งนี้ใช้ต่อได้' && (await R.write.isDisabled()), `then it says the day is used up and the button greys out (${await textOf(R.left)})`);

  // the allowance lowered while the page was open: the server refuses, and the button greys out at once
  setAi({ quizPerPersonPerDay: used + 3 });
  await page.reload({ waitUntil: 'networkidle' });
  await R.tab('ai').click();
  await R.text.fill(DOC);
  await R.write.waitFor();
  check(await R.write.isEnabled(), 'with a higher allowance it opens up again');
  setAi({ quizPerPersonPerDay: used });
  fails();
  const asked = seen.length;
  await R.write.click();
  await R.error.waitFor({ timeout: 10000 });
  check((await textOf(R.error)) === `วันนี้ให้ AI ออกข้อสอบครบ ${used} ครั้งแล้ว พรุ่งนี้ใช้ต่อได้` && seen.length === asked, 'lowered under what was used, the server says so and the AI is not asked');
  check(await R.write.isDisabled(), '  and the button greys out at once');
  allowed();
  setAi();
  left = await leftNow(page);

  // ---- saving
  await page.reload({ waitUntil: 'networkidle' });
  await R.tab('ai').click();
  await R.text.fill(DOC);
  await R.count(5).click();
  next = [{}];
  await R.write.click();
  await R.review.waitFor({ timeout: 30000 });
  const out = squash(await R.questions.nth(1).locator('p').first().innerText());
  await R.keep.nth(1).uncheck();
  await R.title.fill('ข้อสอบ AI ทดสอบ e2e');
  await R.save.click();
  await R.done.waitFor({ timeout: 20000 });
  check((await textOf(R.done)).includes('บันทึกแล้ว 4 ข้อ'), 'saving says 4 questions were saved');
  const examLink = await R.done.getByRole('link', { name: /ทำข้อสอบ/ }).getAttribute('href');
  const id = examLink?.match(/\/exam\/([^/?#]+)/)?.[1];
  if (id) gamesMade.push(id);
  const rec = id ? await page.evaluate(async (u) => (await fetch(u)).json(), `${MOUNT}/api/games/${id}`) : null;
  const rounds = roundsOf(rec) ?? [];
  const prompts = rounds.flatMap((r) => r.questions.map((q) => q.prompt));
  check(prompts.length === 4 && !prompts.some((p) => out.includes(p)), 'the game holds the 4 kept, not the one taken out');
  check(rounds.length === 2 && rounds.every((r) => r.questions.every((q) => q.options.length === 4 && q.correct.length === 1 && q.explanation)), 'in its 2 topics, each with 4 choices, one answer and an explanation');
  check(!JSON.stringify(rec).includes('ข้อความจากเอกสารทดสอบ') && !JSON.stringify(rec).includes(MARK), 'the quotes and the document are not stored with the game');
  check(rounds.some((r) => r.questions.some((q) => q.correct[0] !== 0)), 'the right answers are not all A');
  await shoot(page, '05-done');

  // the exam page opens it
  fails(); // the exam page asks for the code as a link first, which is a 404
  await page.goto(`${WEB}${examLink.startsWith(MOUNT) ? examLink.slice(MOUNT.length) : examLink}`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'เริ่มทำข้อสอบ' }).waitFor({ timeout: 15000 });
  check(true, 'the saved game opens as an exam');
  allowed();
  await ctx.close();

  // ============ phones
  for (const width of [390, 360]) {
    const phone = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await login(phone, '/import?ai=1');
    watch(p, `phone ${width}`);
    const P = on(p);
    await P.text.waitFor({ timeout: 20000 });
    await P.text.fill(DOC);
    const formFits = await noSideScroll(p);
    const button = await P.write.boundingBox();
    next = [{}];
    await P.write.tap();
    await P.writing.waitFor({ timeout: 5000 });
    const writingFits = await noSideScroll(p);
    await P.review.waitFor({ timeout: 30000 });
    check(formFits && writingFits && (await noSideScroll(p)), `${width} px: the form, the writing and the preview fit with no sideways scroll`);
    check(Boolean(button) && button.height >= 44 && button.x + button.width <= width, `${width} px: the button is a full-size target inside the screen`);
    check((await textOf(p.locator('main, body'))).includes('ได้ 5 จาก 10 ข้อที่ขอ'), `${width} px: asked for 10 and given 5, it says so`);
    await shoot(p, `06-phone-${width}`, true);
    await phone.close();
  }

  // ============ off again
  rmSync(AI_FILE, { force: true });
  const after = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await login(after, '/import');
  watch(a, 'after');
  await on(a).tab('file').waitFor({ timeout: 20000 });
  await a.waitForLoadState('networkidle');
  check((await status(a)).enabled === false && (await on(a).tab('ai').count()) === 0, 'removing the file takes the tab away');
  // the games made: the one saved above
  for (const g of [...gamesMade]) {
    const gone = await a.evaluate(async (u) => (await fetch(u, { method: 'DELETE', headers: { 'x-ib-req': '1' } })).status, `${MOUNT}/api/games/${g}`);
    if (check(gone === 200, `the test game ${g} is deleted`)) gamesMade.splice(gamesMade.indexOf(g), 1);
  }
  await after.close();

  check(leaks.length === 0, `no answer to the browser carried the key or the provider's address${leaks.length ? `: ${leaks.join(', ')}` : ''}`);
  check(errors.length === 0, `no page errors${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`);
} catch (e) {
  failed++;
  console.log(`FAIL  ${e instanceof Error ? e.stack : e}`);
} finally {
  rmSync(AI_FILE, { force: true });
  await browser.close();
  provider.close();
}

console.log(`\n${passed} passed, ${failed} failed${gamesMade.length ? ` (left behind: games ${gamesMade.join(', ')})` : ''}`);
process.exit(failed ? 1 : 0);
