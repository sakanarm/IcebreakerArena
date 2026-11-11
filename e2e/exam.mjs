// Exam mode, as the person sitting it and as the maker handing it out.
// Signed out: /exam lists the sample games, a practice sitting checks each answer and shows the
// explanation, the sitting survives leaving and a reload, the result counts right/wrong/skipped and lets the
// missed ones be sat again, a mock sitting shows nothing until it is handed in, a time limit hands it in by
// itself (with the page open, and while it was closed), a wrong code says so, and phones never scroll sideways.
// Signed in (--login): a game of the account's own becomes an exam from its card, its exam link opens for a
// browser with nobody signed in, an edit waits for "update" and keeps the link, and closing the link (or
// deleting the game) shuts it. Many people opening one link at once all get it.
//   node exam.mjs [--base=http://localhost:3000] [--login=<file>] [--shots=<dir>]
// Against production: node exam.mjs --base=https://dmhub.mfec.dev/PikaArena --login=<file>
// --login names a file holding a "username: …" line and a "password: …" line (what
// `npm run users -- add <name> "<display name>" --out=<file>` writes). The game it imports is deleted at the end.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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

const SAMPLE = 'tpl-pika';
const LOAD = 200;

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

const browser = await chromium.launch(launchOptions);
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools/.test(m.text()) && errors.push(`${who}: ${m.text().slice(0, 160)}`));
  page.on('dialog', (d) => d.accept());
};
/** from here on until `allowed()`, the browser logging a 404 or 401 is expected: looking a code up that leads nowhere */
let missesFrom = -1;
const misses = () => (missesFrom = errors.length);
const allowed = () => {
  const after = errors.splice(missesFrom);
  errors.push(...after.filter((e) => !/Failed to load resource: the server responded with a status of 40[14]/.test(e)));
};
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (loc) => squash(await loc.first().innerText());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const stored = (page, code) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), `ib.exam.${code}`);

/** the sitting's page, by what it shows */
const on = (page) => ({
  heading: page.locator('#exam-prompt'),
  counter: page.locator('main article p').first(),
  options: page.locator('[data-choice]'),
  status: page.locator('main [role=status]'),
  button: (name) => page.locator('main').getByRole('button', { name, exact: true }),
  cell: (n) => page.getByRole('navigation', { name: 'ทุกข้อ' }).getByRole('button', { name: new RegExp(`^ข้อ ${n}:`) }),
});
const startPage = (page) => page.getByRole('button', { name: 'เริ่มทำข้อสอบ' });
const setCount = async (page, n) => {
  await page.getByRole('textbox', { name: 'จำนวนข้อ' }).fill(String(n));
  await page.getByRole('textbox', { name: 'จำนวนข้อ' }).blur();
};
const begin = async (page, { count, mode = 'practice', pace = null }) => {
  await setCount(page, count);
  await page.locator(`input[name=exam-mode][value=${mode}]`).check();
  if (pace !== null) await page.locator('main select').selectOption(String(pace));
  await startPage(page).click();
  await on(page).heading.waitFor({ timeout: 10000 });
};
const at = async (page) => (await textOf(on(page).counter)).match(/ข้อ (\d+) \/ (\d+)/)?.slice(1).map(Number) ?? [];

// ============ signed out: the sample games
const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await anon.newPage();
watch(page, 'anon');

await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
check((await page.locator(`a[href="${MOUNT}/exam"]`).count()) >= 1, 'the home page links to exam mode');

await page.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
const listed = await page.locator(`main a[href^="${MOUNT}/exam/"]`).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
check(listed.length >= 3 && listed.includes(`${MOUNT}/exam/${SAMPLE}`), `/exam lists the sample games as exams (${listed.length})`);
check((await page.locator(`main a[href="${MOUNT}/host"]`).count()) === 1, 'and says where to make one of your own');
await shoot(page, '01-index');

await page.locator(`main a[href="${MOUNT}/exam/${SAMPLE}"]`).click();
await startPage(page).waitFor({ timeout: 15000 });
check((await textOf(page.locator('main h1'))).startsWith('รู้จัก Pika'), 'a sample opens on its start page');
const BANK = Number((await textOf(page.locator('main'))).match(/คลังคำถาม (\d+) ข้อ · 3 หัวข้อ/)?.[1] ?? 0);
check(BANK >= 8, `which says how big the bank is (${BANK} questions in 3 topics)`);
check((await page.locator('main input[type=checkbox]').count()) === 4, 'three topics to pick, and the shuffle switch');
check(/· ข้อสอบ · MFEC Pika Arena$/.test(await page.title()), `the tab is named after the paper (${await page.title()})`);
await shoot(page, '02-start', true);
{
  // the paper's name stays in the tab after Next writes the route's own title, and leaves with the paper
  const tab = await page.context().newPage();
  watch(tab, 'title');
  await tab.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
  await tab.locator(`main a[href="${MOUNT}/exam/${SAMPLE}"]`).click();
  await startPage(tab).waitFor({ timeout: 15000 });
  await tab.waitForTimeout(1500);
  check(/^รู้จัก Pika.* · ข้อสอบ · MFEC Pika Arena$/.test(await tab.title()), `a second later the tab still has the paper's name (${await tab.title()})`);
  await tab.locator(`header a[href="${MOUNT}/exam"]`).first().click();
  await tab.waitForURL((u) => u.pathname === `${MOUNT}/exam`, { timeout: 15000 });
  await tab.waitForTimeout(1500);
  check((await tab.title()) === 'โหมดข้อสอบ · MFEC Pika Arena', `back on /exam the tab is the index's again (${await tab.title()})`);
  await tab.goBack();
  await startPage(tab).waitFor({ timeout: 15000 });
  await tab.waitForTimeout(1500);
  check(/^รู้จัก Pika.* · ข้อสอบ · MFEC Pika Arena$/.test(await tab.title()), `and the browser's back button brings the paper's name back (${await tab.title()})`);
  await tab.close();
}

// none of the topics: nothing to start
await page.getByRole('button', { name: 'ไม่เลือกเลย' }).click();
check(await startPage(page).isDisabled(), 'with no topic picked there is nothing to start');
await page.getByRole('button', { name: 'เลือกทั้งหมด' }).click();
check(!(await startPage(page).isDisabled()), 'picking them back starts again');
await setCount(page, 99);
check(
  (await page.getByRole('textbox', { name: 'จำนวนข้อ' }).inputValue()) === String(BANK) && (await page.getByRole('button', { name: 'เพิ่มจำนวนข้อ' }).isDisabled()),
  `a count above the bank stops at ${BANK}, and ＋ with it`,
);
await page.getByRole('button', { name: 'ลดจำนวนข้อ' }).click();
check((await page.getByRole('textbox', { name: 'จำนวนข้อ' }).inputValue()) === String(BANK - 1), '− takes one off');

// ---------- practice: 4 questions
await begin(page, { count: 4 });
let sitting = await stored(page, SAMPLE);
check(sitting?.items?.length === 4 && sitting.mode === 'practice', 'a practice sitting of 4 starts, and is kept in this browser');
check(new Set(sitting.items.map((it) => it.question.id + it.topicId)).size === 4, 'four different questions');
const right = (i) => sitting.items[i].question.correct[0];
const wrong = (i) => (right(i) + 1) % sitting.items[i].question.options.length;
const R = on(page);
check(String(await at(page)) === '1,4', 'it opens on question 1 of 4');
check(await R.button('ตรวจคำตอบ').isDisabled(), '"ตรวจคำตอบ" waits for an answer');
await shoot(page, '03-practice-q1');

// Q1: right, by the keyboard
await page.keyboard.press(String(right(0) + 1));
check((await R.options.nth(right(0)).getAttribute('aria-checked')) === 'true', `key ${right(0) + 1} picks option ${right(0) + 1}`);
check((await R.cell(1).getAttribute('aria-label')) === 'ข้อ 1: เลือกไว้ ยังไม่ได้ตรวจ', 'the grid shows it picked');
await page.keyboard.press('Enter');
await R.status.waitFor({ timeout: 5000 });
check((await textOf(R.status)).startsWith('✓ ถูกต้อง'), 'Enter checks it: right');
const why0 = sitting.items[0].question.explanation;
check(Boolean(why0) && (await textOf(R.status)).includes(squash(why0).slice(0, 30)), 'and shows the explanation');
check((await R.cell(1).getAttribute('aria-label')) === 'ข้อ 1: ตอบถูก', 'the grid marks it right');
check((await R.options.first().getAttribute('aria-disabled')) === 'true', 'a checked question cannot be changed');
await shoot(page, '04-practice-right');
await page.keyboard.press('Enter');
await page.waitForFunction(() => /ข้อ 2 \//.test(document.querySelector('main article p')?.textContent ?? ''), null, { timeout: 5000 });
check(String(await at(page)) === '2,4', 'Enter again goes on to question 2');
check((await page.evaluate(() => document.activeElement?.id)) === 'exam-prompt', 'and the new question is focused for a screen reader');

// Q2: wrong, by the mouse
await R.options.nth(wrong(1)).click();
await R.button('ตรวจคำตอบ').click();
await R.status.waitFor({ timeout: 5000 });
const letters = 'ABCDEFGH';
check((await textOf(R.status)).startsWith(`✕ ยังไม่ถูก คำตอบที่ถูกคือ ${letters[right(1)]}`), `a wrong answer says which was right (${letters[right(1)]})`);
await R.options.nth(right(1)).click({ force: true });
check((await R.options.nth(wrong(1)).getAttribute('aria-checked')) === 'true', 'clicking another option after checking changes nothing');
await shoot(page, '05-practice-wrong');
await R.button('ข้อต่อไป →').click();

// Q3: shown without an answer, and flagged
await R.button('ดูเฉลย').click();
await R.status.waitFor({ timeout: 5000 });
check((await textOf(R.status)).startsWith('ข้อนี้ไม่ได้ตอบ คำตอบที่ถูกคือ'), '"ดูเฉลย" shows the answer without one');
await page.keyboard.press('f');
check((await page.locator('main article').getByRole('button', { name: /ติดธง/ }).getAttribute('aria-pressed')) === 'true', 'F flags the question');
check((await R.cell(3).getAttribute('aria-label')) === 'ข้อ 3: ดูเฉลยโดยไม่ได้ตอบ ติดธงไว้', 'the grid says so');
check((await page.getByRole('progressbar').getAttribute('aria-valuenow')) === '3', 'the progress bar counts 3 done');

// leave, come back, reload
await page.getByRole('button', { name: 'ออกจากข้อสอบ กลับมาทำต่อได้' }).click();
const resume = page.getByRole('region', { name: 'ข้อสอบที่ทำค้างไว้' });
await resume.waitFor({ timeout: 5000 });
check((await textOf(resume)).includes('ทำแล้ว 3 จาก 4 ข้อ'), 'leaving keeps the sitting: "ทำแล้ว 3 จาก 4 ข้อ"');
await resume.getByRole('button', { name: 'ทำต่อ' }).click();
await R.heading.waitFor({ timeout: 5000 });
check(String(await at(page)) === '3,4', '"ทำต่อ" goes back to question 3');
await page.reload({ waitUntil: 'networkidle' });
await R.heading.waitFor({ timeout: 10000 });
check(String(await at(page)) === '3,4' && (await R.status.count()) === 1, 'a reload lands on the same question, still checked');

// Q4: right, then the summary
await page.keyboard.press('ArrowRight');
await page.waitForFunction(() => /ข้อ 4 \//.test(document.querySelector('main article p')?.textContent ?? ''), null, { timeout: 5000 });
check(true, '→ moves to question 4');
await page.keyboard.press(String(right(3) + 1));
await page.keyboard.press('Enter');
await R.status.waitFor({ timeout: 5000 });
check((await R.button('ดูสรุปผล').count()) === 1, 'with every question checked, the next step is the summary');
await R.button('ดูสรุปผล').click();

// ---------- the result
const score = page.locator('[data-exam-score]');
await score.waitFor({ timeout: 5000 });
const counted = async () => [
  await textOf(score),
  await textOf(page.locator('[data-exam-percent]')),
  await page.locator('[data-exam-review=right]').count(),
  await page.locator('[data-exam-review=wrong]').count(),
  await page.locator('[data-exam-review=skipped]').count(),
];
check(String(await counted()) === '2,50%,2,1,1', `2 right of 4, 50%, and the answers listed right/wrong/skipped (${await counted()})`);
check((await textOf(page.locator('main'))).includes(squash(why0).slice(0, 30)), 'the answers list keeps the explanations');
const took = (await stored(page, SAMPLE)).spentMs;
check(took >= 700 && took < 120000 && !(await textOf(page.locator('main'))).includes('ใช้เวลา 0 วินาที'), `the time spent is counted, up to the moment it was handed in (${took} ms)`);
check((await textOf(page.locator('main'))).includes('คะแนนรายหัวข้อ') === new Set(sitting.items.map((it) => it.topicId)).size > 1, 'a score per topic when the questions came from more than one');
await shoot(page, '06-result', true);
await page.getByRole('group', { name: 'กรองข้อที่แสดง' }).getByRole('button', { name: 'ติดธง (1)' }).click();
check((await page.locator('[data-exam-review]').count()) === 1, 'the flagged filter shows the one flagged');
await page.reload({ waitUntil: 'networkidle' });
await score.waitFor({ timeout: 10000 });
check(String(await counted()) === '2,50%,2,1,1', 'a reload keeps the result');

await page.getByRole('button', { name: 'ทำข้อที่พลาดอีกครั้ง (2 ข้อ)' }).click();
await R.heading.waitFor({ timeout: 5000 });
const again = await stored(page, SAMPLE);
check(
  String(await at(page)) === '1,2' && again.items.map((it) => it.question.id).join() === [sitting.items[1], sitting.items[2]].map((it) => it.question.id).join(),
  'the missed two are sat again, on their own',
);

// ---------- mock: nothing shown until it is handed in
await page.getByRole('button', { name: 'ออกจากข้อสอบ กลับมาทำต่อได้' }).click();
await startPage(page).waitFor({ timeout: 5000 });
await begin(page, { count: 3, mode: 'mock', pace: 60 });
sitting = await stored(page, SAMPLE);
check(sitting.mode === 'mock' && sitting.items.length === 3 && sitting.deadline - sitting.startedAt === 180000, 'a mock sitting of 3 at a minute each gets 3 minutes');
const timer = page.getByRole('timer');
check(/^เหลือเวลา [23]:\d\d$/.test((await timer.getAttribute('aria-label')) ?? ''), `the clock runs (${await timer.getAttribute('aria-label')})`);
await R.options.nth(wrong(0)).click();
check((await R.status.count()) === 0 && (await R.button('ตรวจคำตอบ').count()) === 0, 'an answer is not checked in a mock sitting');
check((await R.cell(1).getAttribute('aria-label')) === 'ข้อ 1: ตอบแล้ว', 'the grid says answered');
await R.button('ล้างคำตอบ').click();
check((await R.cell(1).getAttribute('aria-label')) === 'ข้อ 1: ยังไม่ได้ทำ', '"ล้างคำตอบ" takes it back');
await R.options.nth(right(0)).click();
await shoot(page, '07-mock');
await R.button('ถัดไป →').click();
await R.button('ถัดไป →').click();
check(String(await at(page)) === '3,3' && (await R.button('ส่งข้อสอบ').count()) === 1, 'the last question offers to hand in');
await page.locator('header').getByRole('button', { name: 'ส่งข้อสอบ' }).click();
const ask = page.getByRole('dialog');
await ask.waitFor({ timeout: 5000 });
check((await textOf(ask)).includes('ยังเหลือ 2 ข้อ') && (await textOf(ask)).includes('ข้อ 2, 3'), 'handing in early says which are left (2, 3)');
await shoot(page, '08-mock-confirm');
await page.keyboard.press('Escape');
await ask.waitFor({ state: 'detached', timeout: 5000 });
check(String(await at(page)) === '3,3', 'Esc goes back to the paper');
await page.keyboard.press('1'); // keys are off while the dialog is open, on again now
check((await R.cell(3).getAttribute('aria-label')) === 'ข้อ 3: ตอบแล้ว', 'and the keys work again');
await page.locator('header').getByRole('button', { name: 'ส่งข้อสอบ' }).click();
await ask.getByRole('button', { name: 'ส่งข้อสอบ' }).click();
await score.waitFor({ timeout: 5000 });
const mockScore = Number(await textOf(score));
const expected = 1 + (sitting.items[2].question.correct.includes(0) ? 1 : 0);
check(mockScore === expected && (await page.locator('[data-exam-review=skipped]').count()) === 1, `handed in: ${mockScore} right, one not answered`);
check((await textOf(page.locator('main > p').first())).includes('จำลองสอบ'), 'the result says it was a mock exam');

// ---------- the time runs out, with the page open and with it closed
const squeeze = async (ms) => {
  // off the exam page, so it does not write the sitting back over the change
  await page.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
  await page.evaluate(
    ([k, ms]) => {
      const a = JSON.parse(localStorage.getItem(k));
      a.deadline = Date.now() + ms;
      a.startedAt = a.deadline - 60000;
      localStorage.setItem(k, JSON.stringify(a));
    },
    [`ib.exam.${SAMPLE}`, ms],
  );
  await page.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
};
await page.getByRole('button', { name: 'สุ่มชุดใหม่' }).click();
await begin(page, { count: 2, mode: 'mock', pace: 30 });
await R.options.nth(0).click();
await squeeze(2500);
await R.heading.waitFor({ timeout: 10000 });
check((await timer.count()) === 1, 'a timed sitting reopens on the paper with its clock');
await shoot(page, '09-clock-low');
await score.waitFor({ timeout: 8000 });
check((await textOf(page.locator('main'))).includes('หมดเวลา ระบบส่งข้อสอบให้อัตโนมัติ'), 'when the time is up the paper is handed in by itself');
check((await stored(page, SAMPLE)).finishedAt === (await stored(page, SAMPLE)).deadline, 'at its deadline');

await page.getByRole('button', { name: 'สุ่มชุดใหม่' }).click();
await begin(page, { count: 2, mode: 'mock', pace: 30 });
await squeeze(-5000);
await score.waitFor({ timeout: 10000 });
const late = await stored(page, SAMPLE);
check(late.finishedAt === late.deadline && (await textOf(page.locator('main'))).includes('หมดเวลา'), 'time that ran out while the page was closed ends the sitting at its deadline');
check((await textOf(page.locator('main'))).includes('ใช้เวลา 1 นาที'), 'and counts only the time allowed');

// ---------- codes that lead nowhere
misses();
await page.goto(`${WEB}/exam/no-such-exam`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'ไม่พบข้อสอบนี้' }).waitFor({ timeout: 10000 });
check(true, 'a code that is no exam says "ไม่พบข้อสอบนี้"');
await page.goto(`${WEB}/exam/AAAAAAAAAAAAAAAAAAAAAA`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'ไม่พบข้อสอบนี้' }).waitFor({ timeout: 10000 });
check(true, 'and so does a link code that was never opened');
const api404 = await page.evaluate(async (u) => (await fetch(u)).status, `${MOUNT}/api/exams/AAAAAAAAAAAAAAAAAAAAAA`);
check(api404 === 404, `the API answers 404 for it (${api404})`);
const apiSample = await page.evaluate(async (u) => (await fetch(u)).status, `${MOUNT}/api/exams/${SAMPLE}`);
check(apiSample === 404, 'a sample is served by the page itself, not by the link API');
allowed();

// ---------- phones
for (const width of [390, 360]) {
  const phone = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  watch(p, `phone ${width}`);
  await p.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
  await startPage(p).waitFor({ timeout: 15000 });
  const s1 = await noSideScroll(p);
  await shoot(p, `10-phone-${width}-start`, true);
  await begin(p, { count: 3, mode: 'mock', pace: 60 });
  const pr = on(p);
  await pr.options.first().tap();
  const s2 = await noSideScroll(p);
  await shoot(p, `11-phone-${width}-mock`, true);
  await p.locator('header').getByRole('button', { name: 'ส่งข้อสอบ' }).tap();
  await shoot(p, `12-phone-${width}-confirm`);
  await p.getByRole('dialog').getByRole('button', { name: 'ส่งข้อสอบ' }).tap();
  await p.locator('[data-exam-score]').waitFor({ timeout: 5000 });
  const s3 = await noSideScroll(p);
  await shoot(p, `13-phone-${width}-result`, true);
  await p.getByRole('button', { name: 'สุ่มชุดใหม่' }).tap();
  await begin(p, { count: 2 });
  await pr.options.first().tap();
  await pr.button('ตรวจคำตอบ').tap();
  await pr.status.waitFor({ timeout: 5000 });
  const s4 = await noSideScroll(p);
  await shoot(p, `14-phone-${width}-practice`, true);
  check(s1 && s2 && s3 && s4, `${width}px: start, paper, result and an explained answer fit without scrolling sideways`);
  await phone.close();
}

// ============ signed in: an exam link for a game of one's own
let gameId = null;
if (who) {
  const maker = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mp = await maker.newPage();
  watch(mp, 'maker');
  const tag = Date.now().toString(36).slice(-5);
  const TITLE = `ข้อสอบทดสอบ ${tag}`;
  const NEW_TITLE = `ข้อสอบทดสอบ ${tag} ฉบับแก้`;
  const q = (prompt, why) => ({ type: 'quiz', prompt, options: ['ข้อที่ถูก', 'ผิด ก', 'ผิด ข', 'ผิด ค'], correct: [0], timeLimitS: 20, explanation: why });
  const FILE = {
    title: TITLE,
    description: 'เกมทดสอบโหมดข้อสอบ',
    rounds: [
      { title: 'ความปลอดภัย', questions: [q('ข้อสอบข้อหนึ่ง', 'คำอธิบายข้อหนึ่ง เพราะว่าถูก'), q('ข้อสอบข้อสอง', 'คำอธิบายข้อสอง')] },
      {
        title: 'นโยบาย',
        questions: [
          q('ข้อสอบข้อสาม', 'คำอธิบายข้อสาม'),
          { type: 'truefalse', prompt: 'ข้อสอบข้อสี่ จริงไหม', options: ['จริง', 'เท็จ'], correct: [0], timeLimitS: 10 },
          { type: 'poll', prompt: 'โพลนี้ไม่ใช่ข้อสอบ', options: ['ก', 'ข'], correct: [], timeLimitS: 10 },
        ],
      },
    ],
  };

  await mp.goto(`${WEB}/login?next=/editor`, { waitUntil: 'networkidle' });
  await mp.locator('#login-user').fill(who.username);
  await mp.locator('#login-password').fill(who.password);
  await mp.locator('button[type=submit]').click();
  await mp.waitForURL(/\/editor(\?|$)/, { timeout: 20000 }).catch(() => {});
  await mp.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 20000 });
  await mp.locator('input[type=file]').setInputFiles({ name: 'exam.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(FILE)) });
  await mp.waitForURL(/\/editor\?id=/, { timeout: 20000 });
  gameId = new URL(mp.url()).searchParams.get('id');
  check(/^[\w-]{22}$/.test(gameId ?? ''), `signed in as ${who.username}, and the game was imported into the account`);
  await mp.waitForTimeout(1500); // the editor's first save

  const card = () => mp.locator('article').filter({ hasText: TITLE }).first();
  const linkButton = () => card().getByRole('button', { name: /🔗/ });
  await mp.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
  await card().waitFor({ timeout: 20000 });
  const sitHref = await card().getByRole('link', { name: /ทำเป็นข้อสอบ/ }).getAttribute('href');
  check(sitHref === `${MOUNT}/exam/${gameId}`, 'the card offers "📝 ทำเป็นข้อสอบ"');
  check((await textOf(linkButton())) === '🔗 เปิดลิงก์ข้อสอบ', 'and "🔗 เปิดลิงก์ข้อสอบ"');
  await card().scrollIntoViewIfNeeded();
  await shoot(mp, '20-host-card');

  // the maker sits it first: the whole game, from the account (the page asks for an exam link by that code first, which is a 404)
  misses();
  await mp.goto(`${WEB}/exam/${gameId}`, { waitUntil: 'networkidle' });
  await startPage(mp).waitFor({ timeout: 15000 });
  check((await textOf(mp.locator('main'))).includes('คลังคำถาม 4 ข้อ · 2 หัวข้อ'), 'the maker can sit their own game: 4 questions in 2 topics, the poll left out');
  allowed();

  // the link
  await mp.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
  await linkButton().click();
  const box = mp.getByRole('dialog', { name: 'ลิงก์ข้อสอบ' });
  await box.waitFor({ timeout: 5000 });
  await shoot(mp, '21-link-before');
  await box.getByRole('button', { name: '🔗 เปิดลิงก์ข้อสอบ' }).click();
  const field = box.getByRole('textbox', { name: 'ลิงก์ข้อสอบ' });
  await field.waitFor({ timeout: 10000 });
  const url = await field.inputValue();
  const code = url.split('/exam/')[1] ?? '';
  check(url === `${WEB}/exam/${code}` && /^[\w-]{22}$/.test(code) && code !== gameId, 'opening the link gives its own address, not the game id');
  check((await box.locator('svg').count()) >= 1, 'with a QR code to scan');
  await shoot(mp, '22-link-open');
  await box.getByRole('button', { name: 'เสร็จ' }).click();
  check((await textOf(linkButton())) === '🔗 ลิงก์ข้อสอบ', 'the card now says the link is open');

  // nobody signed in opens it
  const guest = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const gp = await guest.newPage();
  watch(gp, 'guest');
  await gp.goto(url, { waitUntil: 'networkidle' });
  await startPage(gp).waitFor({ timeout: 15000 });
  check((await textOf(gp.locator('main h1'))) === TITLE, 'a browser with nobody signed in opens the link');
  await begin(gp, { count: 4 });
  const G = on(gp);
  const first = (await stored(gp, code)).items[0].question;
  await G.options.nth(first.correct[0]).click();
  await G.button('ตรวจคำตอบ').click();
  await G.status.waitFor({ timeout: 5000 });
  check(!first.explanation || (await textOf(G.status)).includes(first.explanation), 'and sees the explanation');
  const served = await gp.evaluate(async (u) => (await fetch(u)).json(), `${MOUNT}/api/exams/${code}`);
  const qs = served.exam?.paper?.topics?.flatMap((t) => t.questions) ?? [];
  check(qs.length === 4 && qs.every((x) => !('source' in x)) && !JSON.stringify(served).includes('โพลนี้'), 'the link serves the 4 exam questions only');

  // many at once
  const t0 = Date.now();
  const times = await Promise.all(
    Array.from({ length: LOAD }, async () => {
      const s = Date.now();
      const r = await fetch(`${WEB}/api/exams/${code}`);
      await r.arrayBuffer();
      return { ok: r.status === 200, ms: Date.now() - s };
    }),
  );
  const sorted = times.map((t) => t.ms).sort((a, b) => a - b);
  check(times.every((t) => t.ok), `${LOAD} people opening the link at once all get it (p50 ${sorted[LOAD >> 1]} ms, p95 ${sorted[Math.floor(LOAD * 0.95)]} ms, all in ${Date.now() - t0} ms)`);

  // an edit waits for "update"
  const saved = await mp.evaluate(
    async ([u, title]) => {
      const { game: rec } = await (await fetch(u, { cache: 'no-store' })).json();
      const r = await fetch(u, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-ib-req': '1' },
        body: JSON.stringify({ game: { ...rec.game, title }, version: rec.version }),
      });
      return r.status;
    },
    [`${MOUNT}/api/games/${gameId}`, NEW_TITLE],
  );
  check(saved === 200, 'the maker renames the game');
  const title = async () => (await (await fetch(`${WEB}/api/exams/${code}`)).json()).exam.paper.title;
  check((await title()) === TITLE, 'the link keeps the copy it was opened with');
  await mp.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
  const card2 = mp.locator('article').filter({ hasText: NEW_TITLE }).first();
  await card2.waitFor({ timeout: 20000 });
  check((await textOf(card2.getByRole('button', { name: /🔗/ }))) === '🔗 ลิงก์ข้อสอบ (มีฉบับใหม่)', 'the card says there is a newer version');
  await card2.getByRole('button', { name: /🔗/ }).click();
  await box.waitFor({ timeout: 5000 });
  await shoot(mp, '23-link-stale');
  await box.getByRole('button', { name: '🔄 อัปเดตข้อสอบในลิงก์' }).click();
  await mp.getByText('อัปเดตข้อสอบในลิงก์แล้ว ลิงก์เดิมใช้ต่อได้').waitFor({ timeout: 10000 });
  check((await box.getByRole('textbox', { name: 'ลิงก์ข้อสอบ' }).inputValue()) === url, 'updating keeps the same link');
  check((await title()) === NEW_TITLE, 'and the link now serves the new version');
  await gp.reload({ waitUntil: 'networkidle' });
  await G.heading.waitFor({ timeout: 10000 });
  check(String(await at(gp)) === '1,4' && (await G.status.count()) === 1, "the guest's sitting carries on as it was");
  await gp.getByRole('button', { name: 'ออกจากข้อสอบ กลับมาทำต่อได้' }).click();
  await startPage(gp).waitFor({ timeout: 5000 });
  check((await textOf(gp.locator('main h1'))) === NEW_TITLE, 'and their start page shows the new version');

  // closing the link shuts it
  misses();
  await box.getByRole('button', { name: 'ปิดลิงก์' }).click();
  await mp.getByText('ปิดลิงก์ข้อสอบแล้ว').waitFor({ timeout: 10000 });
  // the message comes first and the card follows once the list is fetched again, which takes a moment on a busy server
  const reopen = await card2
    .getByRole('button', { name: '🔗 เปิดลิงก์ข้อสอบ', exact: true })
    .waitFor({ timeout: 10000 })
    .then(() => true, () => false);
  check(reopen, 'closed: the card offers to open a link again');
  check((await fetch(`${WEB}/api/exams/${code}`)).status === 404, 'the closed link answers 404');
  await gp.reload({ waitUntil: 'networkidle' });
  await gp.getByRole('heading', { name: 'ไม่พบข้อสอบนี้' }).waitFor({ timeout: 10000 });
  check((await stored(gp, code)) === null, 'the guest sees "ไม่พบข้อสอบนี้", and their sitting is dropped');
  allowed();

  // a new link is a new address; deleting the game shuts it too
  const reopened = await mp.evaluate(
    async (u) => (await (await fetch(u, { method: 'POST', headers: { 'x-ib-req': '1' } })).json()).link?.id,
    `${MOUNT}/api/games/${gameId}/exam`,
  );
  check(Boolean(reopened) && reopened !== code, 'opening a link again gives a new address');
  const gone = await mp.evaluate(async (u) => (await fetch(u, { method: 'DELETE', headers: { 'x-ib-req': '1' } })).status, `${MOUNT}/api/games/${gameId}`);
  check(gone === 200, 'the test game is deleted');
  if (gone === 200) gameId = null;
  check((await fetch(`${WEB}/api/exams/${reopened}`)).status === 404, "and with it the game's exam link");
  await guest.close();
  await maker.close();
} else {
  console.log('skip  the exam link for a game of your own: pass --login=<file> to check it');
}

check(errors.length === 0, `no errors in the browser${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed${gameId ? ` (left behind: game ${gameId})` : ''}`);
process.exit(failed ? 1 : 0);
