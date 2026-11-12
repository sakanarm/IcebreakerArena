// "ถาม AI" in exam mode, in a real browser, against a stand-in for the AI provider on this machine.
// With no var/secrets/ai.json there is no button. With one: the button sits under the explanation, the panel
// opens with the cursor in it, a suggestion or a typed question gets a reply, Shift+Enter is a new line,
// a failure gives the question back, hiding and going to another question keep the conversation, a wrong
// answer is asked about as wrong, six questions fill a thread, the daily allowance and "signed-in" say so,
// a mock sitting shows it only on the result, typing in the box never answers the paper, and phones never
// scroll sideways. The key stays on the server.
//
// Local only: it writes <repo>/var/secrets/ai.json for the dev server (which reads it on every request),
// pointing at the stand-in, and removes it at the end. It will not run if that file is already there.
// --login (a file with "username: …" and "password: …" lines, as for exam.mjs) also checks a game of the
// account's own and its exam link for a guest; the game it imports is deleted at the end.
//   node ask-ai.mjs [--base=http://localhost:3000] [--login=<file>] [--shots=<dir>]
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchOptions } from './lib/rig.mjs';

const WEB = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? '';
const MOUNT = new URL(WEB).pathname.replace(/\/$/, '');
const LOGIN = process.argv.find((a) => a.startsWith('--login='))?.slice(8) ?? '';
const who = LOGIN
  ? Object.fromEntries(
      readFileSync(LOGIN, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*(username|password)\s*:\s*(.+?)\s*$/)?.slice(1))
        .filter(Boolean),
    )
  : null;
if (who && !(who.username && who.password)) throw new Error(`${LOGIN}: want a "username: …" line and a "password: …" line`);
let gameId = null;
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(WEB)) throw new Error('ask-ai.mjs writes the AI settings file of the server it checks, so it runs against a dev server on this machine only');

const SECRETS = fileURLToPath(new URL('../var/secrets/', import.meta.url));
const AI_FILE = join(SECRETS, 'ai.json');
if (existsSync(AI_FILE)) throw new Error(`${AI_FILE} is already there: move it away first, this check will not overwrite it`);

const SAMPLE = 'tpl-pika';
const KEY = 'sk-e2e-not-a-real-key-0123456789';
const REPLY = 'คำอธิบายจาก AI ตัวทดสอบ';

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

// ---------- the stand-in for the AI provider
const seen = [];
let next = [];
const message = (text) => ({
  id: 'msg_e2e',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 900, output_tokens: 60 },
});
const provider = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    seen.push({ url: req.url, headers: req.headers, body });
    const r = next.shift() ?? {};
    const n = body.messages?.filter((m) => m.role === 'user').length ?? 0;
    setTimeout(() => {
      res.writeHead(r.status ?? 200, { 'content-type': 'application/json', 'x-should-retry': 'false' });
      res.end(JSON.stringify(r.body ?? message(`${REPLY} (${n})`)));
    }, r.delayMs ?? 150);
  });
});
await new Promise((done) => provider.listen(0, '127.0.0.1', done));
const baseUrl = `http://127.0.0.1:${provider.address().port}`;
const setAi = (extra = {}) => {
  mkdirSync(SECRETS, { recursive: true });
  writeFileSync(AI_FILE, JSON.stringify({ apiKey: KEY, baseUrl, perPersonPerDay: 1000, perDay: 100000, ...extra }));
};
const status = async () => (await fetch(`${WEB}/api/exam-ai`)).json();

const browser = await chromium.launch(launchOptions);
const errors = [];
const leaks = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools/.test(m.text()) && errors.push(`${who}: ${m.text().slice(0, 160)}`));
  page.on('dialog', (d) => d.accept());
  page.on('response', async (r) => {
    if (!r.url().includes('/api/exam-ai')) return;
    const text = await r.text().catch(() => '');
    if (text.includes(KEY) || text.includes(baseUrl)) leaks.push(r.url());
  });
};
/** from here on until `allowed()`, the browser logging a failed request is expected: the provider was told to fail */
let failsFrom = -1;
const fails = () => (failsFrom = errors.length);
const allowed = () => {
  const after = errors.splice(failsFrom);
  errors.push(...after.filter((e) => !/Failed to load resource: the server responded with a status of (404|429|502|503)/.test(e)));
};
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (loc) => squash(await loc.first().innerText());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), `ib.exam.${SAMPLE}`);
const letters = 'ABCDEFGH';

const on = (page) => ({
  heading: page.locator('#exam-prompt'),
  options: page.locator('[data-choice]'),
  status: page.locator('main [role=status]').first(),
  button: (name) => page.locator('main').getByRole('button', { name, exact: true }),
  cell: (n) => page.getByRole('navigation', { name: 'ทุกข้อ' }).getByRole('button', { name: new RegExp(`^ข้อ ${n}:`) }),
  ask: page.locator('[data-ask-ai]'),
  panel: page.locator('[data-ask-ai-panel]'),
  replies: page.locator('[data-ai-reply]'),
  chips: page.getByRole('group', { name: 'คำถามตัวอย่าง' }).getByRole('button'),
  box: page.getByRole('textbox', { name: 'พิมพ์คำถามถึง AI' }),
  alert: page.locator('[data-ask-ai-panel] [role=alert]'),
  thinking: page.getByText('AI กำลังคิด…'),
  flag: page.locator('main article').getByRole('button', { name: /ติดธง/ }),
});
const begin = async (page, { count, mode = 'practice' }) => {
  await page.getByRole('textbox', { name: 'จำนวนข้อ' }).fill(String(count));
  await page.getByRole('textbox', { name: 'จำนวนข้อ' }).blur();
  await page.locator(`input[name=exam-mode][value=${mode}]`).check();
  await page.getByRole('button', { name: 'เริ่มทำข้อสอบ' }).click();
  await on(page).heading.waitFor({ timeout: 10000 });
};
/** waits for the n-th reply on the page */
const replyCount = (page, n) => page.waitForFunction((k) => document.querySelectorAll('[data-ai-reply]').length >= k, n, { timeout: 15000 });

try {
  // ============ AI off: no file, no button
  check((await status()).enabled === false, 'with no settings file the server says AI is off');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'desk');
  const R = on(page);
  await page.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
  await begin(page, { count: 4 });
  const sitting = await stored(page);
  const right = (i) => sitting.items[i].question.correct[0];
  const wrong = (i) => (right(i) + 1) % sitting.items[i].question.options.length;
  await R.options.nth(right(0)).click();
  await R.button('ตรวจคำตอบ').click();
  await R.status.waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  check((await R.ask.count()) === 0, 'the answer shows, and no "ถาม AI" button');

  // ============ AI on
  setAi();
  const st = await status();
  check(st.enabled === true && st.needsLogin === false, 'with the file the server says AI is on, for anyone');
  await page.reload({ waitUntil: 'networkidle' });
  await R.ask.waitFor({ timeout: 10000 });
  check((await R.ask.count()) === 1, 'after a reload the button sits under the explanation');
  await shoot(page, '01-button');

  await R.ask.click();
  await R.panel.waitFor({ timeout: 5000 });
  check(await R.box.evaluate((el) => el === document.activeElement), 'opening it puts the cursor in the box');
  check((await R.chips.count()) === 3, 'three suggestions to start with');
  const chip0 = await textOf(R.chips.first());
  check(chip0 === `ทำไมคำตอบคือ ${letters[right(0)]}`, `answered right, the first asks why it is right (${chip0})`);

  // typing in the box never answers the paper or flags it
  await R.box.pressSequentially('f2');
  check((await R.flag.getAttribute('aria-pressed')) === 'false' && (await R.box.inputValue()) === 'f2', 'typing F and 2 in the box stays in the box');
  await R.box.fill('');

  // a suggestion
  next = [{ delayMs: 700 }];
  await R.chips.first().click();
  await R.thinking.waitFor({ timeout: 3000 });
  check(true, '"AI กำลังคิด…" while it answers');
  await replyCount(page, 1);
  check((await textOf(R.replies.first())).includes(`${REPLY} (1)`), 'the reply shows');
  check((await textOf(R.panel)).includes('วันนี้ถาม AI ได้อีก'), 'and how many questions are left today');
  const first = seen.at(-1);
  check(first?.headers.authorization === `Bearer ${KEY}`, 'the server called the provider with the key from the file');
  const prompt0 = sitting.items[0].question.prompt;
  const sys = Array.isArray(first?.body.system) ? first.body.system.map((b) => b.text).join('') : String(first?.body.system ?? '');
  check(sys.includes(prompt0.slice(0, 20)) && sys.includes('(right)'), 'the AI heard the question and that the answer was right');
  check(JSON.stringify(first?.body.messages) === JSON.stringify([{ role: 'user', content: chip0 }]), 'and the suggestion as the question');
  check((await R.chips.count()) === 0, 'the suggestions go once the conversation starts');
  await shoot(page, '02-reply');

  // Shift+Enter is a new line, Enter sends
  await R.box.click();
  await page.keyboard.type('บรรทัดแรก');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('บรรทัดสอง');
  const before = seen.length;
  check((await R.box.inputValue()) === 'บรรทัดแรก\nบรรทัดสอง' && seen.length === before, 'Shift+Enter starts a new line and sends nothing');
  await page.keyboard.press('Enter');
  await replyCount(page, 2);
  const second = seen.at(-1);
  check(second.body.messages.length === 3 && second.body.messages[2].content === 'บรรทัดแรก\nบรรทัดสอง', 'Enter sends it, with the conversation so far');
  check((await R.box.inputValue()) === '', 'and empties the box');

  // failures give the question back
  fails();
  next = [{ status: 500, body: { type: 'error', error: { type: 'api_error', message: 'boom' } } }];
  await R.box.fill('คำถามที่ส่งไม่ถึง');
  await page.keyboard.press('Enter');
  await R.alert.waitFor({ timeout: 10000 });
  check((await textOf(R.alert)).startsWith('ตอนนี้ต่อกับ AI ไม่ได้'), `a provider failure says so (${await textOf(R.alert)})`);
  check((await R.box.inputValue()) === 'คำถามที่ส่งไม่ถึง' && (await R.replies.count()) === 2, 'the question goes back in the box, the conversation is unchanged');
  next = [{ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow' } } }];
  await R.button('ส่ง').click();
  await page.waitForFunction(() => /รอสักครู่/.test(document.querySelector('[data-ask-ai-panel] [role=alert]')?.textContent ?? ''), null, { timeout: 10000 });
  check(true, 'a busy provider says to wait a moment');
  await shoot(page, '03-failure');
  await R.button('ส่ง').click();
  await replyCount(page, 3);
  check((await R.alert.count()) === 0, 'sending again works, and the message goes');
  allowed();

  // hide, open, another question, and back
  await R.panel.getByRole('button', { name: 'ซ่อน' }).click();
  check((await R.panel.count()) === 0 && (await R.ask.count()) === 1, '"ซ่อน" folds it back to the button');
  await R.ask.click();
  check((await R.replies.count()) === 3, 'opening it again keeps the conversation');

  await R.button('ข้อต่อไป →').click();
  await page.waitForFunction(() => /ข้อ 2 \//.test(document.querySelector('main article p')?.textContent ?? ''), null, { timeout: 5000 });
  check((await R.ask.count()) === 0 && (await R.panel.count()) === 0, 'a new question shows no button before it is checked');
  await R.options.nth(wrong(1)).click();
  await R.button('ตรวจคำตอบ').click();
  await R.ask.waitFor({ timeout: 5000 });
  check((await R.panel.count()) === 0, 'once checked, its own button, folded');
  await R.ask.click();
  const chip1 = await textOf(R.chips.first());
  check(chip1 === `ทำไม ${letters[wrong(1)]} ถึงผิด`, `answered wrong, the first asks why the pick was wrong (${chip1})`);
  await R.chips.first().click();
  await replyCount(page, 1);
  const sys1 = String(seen.at(-1).body.system);
  check(sys1.includes(`The person chose: ${letters[wrong(1)]}.`) && sys1.includes('(wrong)'), 'the AI heard the wrong pick');

  // six questions fill a thread
  for (let i = 2; i <= 6; i++) {
    await R.box.fill(`คำถามที่ ${i}`);
    await page.keyboard.press('Enter');
    await replyCount(page, i);
  }
  check((await textOf(R.panel)).includes('ถามเรื่องข้อนี้ครบ 6 คำถามแล้ว') && (await R.box.count()) === 0, 'after six questions the thread is full and the box goes');
  check(seen.at(-1).body.messages.length === 11, 'the sixth carried the whole conversation (11 turns)');
  await shoot(page, '04-full', true);

  await R.cell(1).click();
  await page.waitForFunction(() => /ข้อ 1 \//.test(document.querySelector('main article p')?.textContent ?? ''), null, { timeout: 5000 });
  await R.panel.waitFor({ timeout: 5000 });
  check((await R.replies.count()) === 3, 'back on question 1 its conversation is still there, open');

  // the daily allowance
  await R.cell(3).click();
  await page.waitForFunction(() => /ข้อ 3 \//.test(document.querySelector('main article p')?.textContent ?? ''), null, { timeout: 5000 });
  await R.button('ดูเฉลย').click();
  await R.ask.waitFor({ timeout: 5000 });
  setAi({ perPersonPerDay: 1 });
  fails();
  const calls = seen.length;
  await R.ask.click();
  await R.chips.first().click();
  await R.alert.waitFor({ timeout: 10000 });
  check((await textOf(R.alert)) === 'วันนี้ถาม AI ครบโควตาแล้ว พรุ่งนี้ถามต่อได้' && seen.length === calls, 'past the daily allowance it says so, and the AI is not called');
  allowed();

  // "signed-in" asks a visitor to log in
  setAi({ who: 'signed-in' });
  await page.reload({ waitUntil: 'networkidle' });
  await R.ask.waitFor({ timeout: 10000 });
  await R.ask.click();
  const login = R.panel.getByRole('link', { name: 'เข้าสู่ระบบ' });
  await login.waitFor({ timeout: 5000 });
  check(decodeURIComponent((await login.getAttribute('href')) ?? '').endsWith(`/login?next=/exam/${SAMPLE}`), 'with "signed-in", a visitor is asked to log in and comes back here');
  check((await R.box.count()) === 0, 'and has no box to type in');
  await shoot(page, '05-login');
  setAi();
  // a page asks whether AI is on once, so it learns of the change on the next load
  await page.reload({ waitUntil: 'networkidle' });

  // a mock sitting: nothing until it is handed in
  await page.getByRole('button', { name: 'ออกจากข้อสอบ กลับมาทำต่อได้' }).click();
  await page.getByRole('button', { name: 'เริ่มทำข้อสอบ' }).waitFor({ timeout: 5000 });
  await begin(page, { count: 2, mode: 'mock' });
  await R.options.first().click();
  await page.waitForTimeout(600);
  check((await R.ask.count()) === 0, 'a mock sitting has no "ถาม AI"');
  await page.locator('header').getByRole('button', { name: 'ส่งข้อสอบ' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'ส่งข้อสอบ' }).click();
  await page.locator('[data-exam-review]').first().waitFor({ timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-ask-ai]').length === 2, null, { timeout: 10000 });
  check(true, 'the result has one button under each of the 2 answers');
  await page.locator('[data-ask-ai]').nth(1).click();
  const unanswered = await textOf(R.chips.first());
  check(unanswered.startsWith('ทำไมคำตอบคือ'), `the one not answered asks why the answer is what it is (${unanswered})`);
  await R.chips.first().click();
  await replyCount(page, 1);
  check(String(seen.at(-1).body.system).includes('The person did not choose an answer.'), 'and the AI heard that nothing was chosen');
  check(await noSideScroll(page), 'no sideways scroll on the result');
  await shoot(page, '06-result', true);
  await ctx.close();

  // ============ phones
  for (const width of [390, 360]) {
    const phone = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const p = await phone.newPage();
    watch(p, `phone ${width}`);
    const P = on(p);
    await p.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
    await begin(p, { count: 2 });
    await P.options.first().tap();
    await P.button('ตรวจคำตอบ').tap();
    await P.ask.waitFor({ timeout: 10000 });
    await P.ask.tap();
    await P.chips.first().waitFor({ timeout: 5000 });
    const chipsFit = await P.chips.evaluateAll((bs) => bs.every((b) => b.getBoundingClientRect().right <= window.innerWidth));
    await P.chips.first().tap();
    await replyCount(p, 1);
    await P.box.fill('ก'.repeat(80) + ' ' + 'https://example.com/' + 'a'.repeat(120));
    await P.button('ส่ง').tap();
    await replyCount(p, 2);
    check(chipsFit && (await noSideScroll(p)), `${width} px: the panel, a long question and the replies fit with no sideways scroll`);
    const send = await P.button('ส่ง').boundingBox();
    check(Boolean(send) && send.height >= 44 && send.x + send.width <= width, `${width} px: "ส่ง" is a full-size target inside the screen`);
    await shoot(p, `07-phone-${width}`, true);
    await phone.close();
  }

  // ============ signed in: a game of one's own, and its exam link for a guest
  if (who) {
    fails(); // the exam page looks the game's id up as a link first (404), and one request below is meant to miss
    const maker = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const mp = await maker.newPage();
    watch(mp, 'maker');
    const TITLE = `ถาม AI ทดสอบ ${Date.now().toString(36).slice(-5)}`;
    const q = (prompt, why) => ({ type: 'quiz', prompt, options: ['ข้อที่ถูก', 'ผิด ก', 'ผิด ข', 'ผิด ค'], correct: [0], timeLimitS: 20, explanation: why });
    const FILE = { title: TITLE, description: 'เกมทดสอบถาม AI', rounds: [{ title: 'หัวข้อทดสอบ', questions: [q('คำถามของเกมตัวเองข้อหนึ่ง', 'เพราะข้อแรกถูก'), q('คำถามของเกมตัวเองข้อสอง', 'เพราะข้อแรกถูกเหมือนกัน')] }] };
    await mp.goto(`${WEB}/login?with=password&next=/editor`, { waitUntil: 'networkidle' });
    await mp.locator('#login-user').fill(who.username);
    await mp.locator('#login-password').fill(who.password);
    await mp.locator('button[type=submit]').click();
    await mp.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 20000 });
    await mp.locator('input[type=file]').setInputFiles({ name: 'ask-ai.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(FILE)) });
    await mp.waitForURL(/\/editor\?id=/, { timeout: 20000 });
    gameId = new URL(mp.url()).searchParams.get('id');
    await mp.waitForTimeout(1500); // the editor's first save

    // the maker, on their own game (the page asks for an exam link by that code first, which is a 404)
    await mp.goto(`${WEB}/exam/${gameId}`, { waitUntil: 'networkidle' });
    await begin(mp, { count: 2 });
    const M = on(mp);
    await M.button('ดูเฉลย').click();
    await M.ask.waitFor({ timeout: 10000 });
    await M.ask.click();
    await M.chips.first().click();
    await replyCount(mp, 1);
    check(/คำถามของเกมตัวเองข้อ(หนึ่ง|สอง)/.test(String(seen.at(-1).body.system)), 'the maker asks about a question of their own game');

    // the server reads the question from the game itself: an id that is not in it gets nothing
    const res = await mp.evaluate(
      async ([u, id]) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ib-req': '1' }, body: JSON.stringify({ paper: { kind: 'game', id }, questionId: 'nope', chosen: null, messages: [{ role: 'user', text: 'x' }] }) })).status,
      [`${MOUNT}/api/exam-ai`, gameId],
    );
    check(res === 404, 'a question id that is not in the game is turned away');

    // its exam link, for a guest
    const link = await mp.evaluate(async (u) => (await (await fetch(u, { method: 'POST', headers: { 'x-ib-req': '1' } })).json()).link?.id, `${MOUNT}/api/games/${gameId}/exam`);
    const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const gp = await guest.newPage();
    watch(gp, 'guest');
    await gp.goto(`${WEB}/exam/${link}`, { waitUntil: 'networkidle' });
    await begin(gp, { count: 2 });
    const G = on(gp);
    await G.options.nth(1).click();
    await G.button('ตรวจคำตอบ').click();
    await G.ask.waitFor({ timeout: 10000 });
    await G.ask.click();
    check((await textOf(G.chips.first())) === 'ทำไม B ถึงผิด', 'a guest on the exam link gets the button too');
    await G.chips.first().click();
    await replyCount(gp, 1);
    check(String(seen.at(-1).body.system).includes('The person chose: B. ผิด ก (wrong)'), 'and the AI hears the question the link serves');
    await guest.close();

    const gone = await mp.evaluate(async (u) => (await fetch(u, { method: 'DELETE', headers: { 'x-ib-req': '1' } })).status, `${MOUNT}/api/games/${gameId}`);
    check(gone === 200, 'the test game is deleted');
    if (gone === 200) gameId = null;
    await maker.close();
    allowed();
  } else {
    console.log('skip  a game of your own and its exam link: pass --login=<file> to check them');
  }

  // ============ off again
  rmSync(AI_FILE, { force: true });
  check((await status()).enabled === false, 'removing the file turns AI off');
  const after = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await after.newPage();
  watch(a, 'after');
  await a.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
  await begin(a, { count: 2 });
  await on(a).button('ดูเฉลย').click();
  await on(a).status.waitFor({ timeout: 5000 });
  await a.waitForTimeout(800);
  check((await on(a).ask.count()) === 0, 'and the button is gone');
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

console.log(`\n${passed} passed, ${failed} failed${gameId ? ` (left behind: game ${gameId})` : ''}`);
process.exit(failed ? 1 : 0);
