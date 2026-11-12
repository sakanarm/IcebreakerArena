// Importing a question bank from Excel, CSV or a paste (/import).
// Signed out: the page asks for a login, and /exam points to it.
// Signed in (--login): the template downloads and reads back as itself; a real .xlsx (made by openpyxl, with a
// title row, merged topic cells, rich text, numbers, booleans and a hidden sheet) shows what it read, which rows
// it skipped and why, and saves as a game that opens as an exam with its answers and explanations; a paste of
// 230 rows splits into three games with each topic drawing 10; an old .xls and a sheet without a header say
// what to do; /host and the editor link here; phones never scroll sideways. Every game it makes is deleted.
//   node sheet-import.mjs [--base=http://localhost:3000] [--login=<file>] [--shots=<dir>]
// Against production: node sheet-import.mjs --base=https://dmhub.mfec.dev/PikaArena --login=<file>
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

const BANK_XLSX = readFileSync(new URL('../apps/web/src/lib/fixtures/bank.xlsx', import.meta.url));

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (ok) passed++;
  else failed++;
  return ok;
};
const shoot = async (page, name, full = true) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full });
};

const browser = await chromium.launch(launchOptions);
const errors = [];
const watch = (page, label) => {
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools|Failed to load resource/.test(m.text()) && errors.push(`${label}: ${m.text().slice(0, 160)}`));
  // the exam page asks for a shared link by the game's code first, and a game never shared answers 404 there
  page.on('response', (r) => r.status() >= 400 && !/\/api\/exams\//.test(r.url()) && errors.push(`${label} ${r.status()}: ${r.url()}`));
  page.on('dialog', (d) => d.accept());
};
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (loc) => squash(await loc.first().innerText());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// ---------- signed out ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'anon');
  await page.goto(`${WEB}/import`, { waitUntil: 'networkidle' });
  const heading = await textOf(page.locator('h1'));
  check(/เข้าสู่ระบบก่อนนำเข้าคลังข้อสอบ|นำเข้าคลังข้อสอบ/.test(heading), `signed out, /import shows: ${heading}`);
  if (/เข้าสู่ระบบ/.test(heading)) {
    const href = await page.getByRole('link', { name: 'เข้าสู่ระบบ' }).getAttribute('href');
    check(/\/login\?next=%2Fimport$/.test(href ?? ''), 'and its login link comes back to /import');
  }
  await page.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
  check((await page.locator(`main a[href="${MOUNT}/create"]`).count()) === 1, '/exam links to the create page');
  await page.goto(`${WEB}/create`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid=create-sheet]:not([data-state=loading])').waitFor({ timeout: 20000 });
  const sheetHref = await page.getByTestId('create-sheet-go').getAttribute('href');
  check(sheetHref === `${MOUNT}/import` || /\/login\?next=%2Fimport$/.test(sheetHref ?? ''), `and the create page leads to /import (${sheetHref})`);
  await ctx.close();
}

const made = new Set();
if (who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'maker');
  const api = (path, init = {}) =>
    page.evaluate(
      async ([u, i]) => {
        const r = await fetch(u, { ...i, headers: { 'x-ib-req': '1', ...(i.headers ?? {}) } });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [`${MOUNT}/api${path}`, init],
    );
  const doneIds = async () =>
    (await page.locator('[data-testid=import-done] a[href*="/exam/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).map((h) => h.split('/').pop());
  const summary = () => textOf(page.getByTestId('import-summary'));
  const upload = async (name, buffer, mimeType) => {
    await page.getByTestId('sheet-file').setInputFiles({ name, mimeType, buffer });
  };
  const again = async () => {
    await page.getByRole('button', { name: /นำเข้าไฟล์อื่น|เลือกไฟล์อื่น/ }).first().click();
    await page.getByTestId('sheet-file').waitFor({ state: 'attached' });
  };

  await page.goto(`${WEB}/login?with=password&next=/import`, { waitUntil: 'networkidle' });
  await page.locator('#login-user').fill(who.username);
  await page.locator('#login-password').fill(who.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/import$/, { timeout: 20000 }).catch(() => {});
  await page.getByTestId('sheet-file').waitFor({ state: 'attached', timeout: 20000 });
  check(true, `signed in as ${who.username}, back on /import`);
  await shoot(page, '1-pick');

  // the template, downloaded and read back
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /ดาวน์โหลดแม่แบบ/ }).click()]);
  const template = readFileSync(await download.path());
  check(download.suggestedFilename() === 'pika-arena-question-bank.csv', `the template downloads as ${download.suggestedFilename()}`);
  check(template.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && template.toString('utf8').includes('"หัวข้อ","คำถาม","ก","ข","ค","ง","คำตอบ","คำอธิบาย"'), 'with a BOM (so Excel shows Thai) and the Thai header');
  await upload('pika-arena-question-bank.csv', template, 'text/csv');
  await page.getByTestId('import-summary').waitFor();
  const tsum = await summary();
  check(/4 ข้อที่นำเข้าได้ 2 หัวข้อ$/.test(tsum), `the template reads back as itself: ${tsum}`);
  check((await page.getByTestId('import-problems').count()) === 0, 'with nothing to fix');
  check((await page.getByTestId('import-title').inputValue()) === 'pika-arena-question-bank', 'the title starts as the file name');
  await again();

  // a real workbook
  await upload('ข้อสอบ IT Security.xlsx', BANK_XLSX, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  await page.getByTestId('import-summary').waitFor();
  const xsum = await summary();
  check(/^4 ข้อที่นำเข้าได้ 2 หัวข้อ 2 แถวที่ต้องแก้$/.test(xsum), `the workbook: ${xsum}`);
  const problems = await textOf(page.getByTestId('import-problems'));
  check(/ความปลอดภัย · แถว 5 คำตอบ “1” กำกวม/.test(problems) && /ความปลอดภัย · แถว 10 ยังไม่ได้ใส่คำตอบ/.test(problems), `each skipped row says its sheet, row and why: ${problems.slice(0, 120)}…`);
  check(/ชีต “สรุป”: ข้ามไป/.test(await textOf(page.locator('main, body'))), 'the sheet without a header is noted, the hidden sheet is not read');
  check((await page.getByRole('button', { name: 'นำเข้าเฉพาะ 4 ข้อที่ถูกต้อง' }).count()) === 1, 'the save button says only the good rows go in');
  await page.getByTestId('import-rounds').getByRole('button', { name: /รหัสผ่าน/ }).click();
  const firstQ = await textOf(page.getByTestId('import-rounds').locator('li.card').first());
  check(/รหัสผ่านแบบใดปลอดภัยที่สุด/.test(firstQ) && /✓ วลียาว & เดายาก <ผสมตัวเลข>/.test(firstQ) && /บรรทัดแรก/.test(firstQ), 'the preview marks the right answer and shows the explanation');
  await shoot(page, '2-preview');
  await page.getByTestId('import-title').fill('');
  await page.getByTestId('import-save').click();
  check(/ตั้งชื่อคลังข้อสอบก่อน/.test(await textOf(page.locator('main p[role=alert], section p[role=alert]'))), 'an empty title is caught before saving');
  const TITLE = `คลังทดสอบ ${Date.now().toString(36).slice(-5)}`;
  await page.getByTestId('import-title').fill(TITLE);
  await page.getByTestId('import-save').click();
  await page.getByTestId('import-done').waitFor({ timeout: 20000 });
  const [xid] = await doneIds();
  if (xid) made.add(xid);
  check(/นำเข้าแล้ว 4 ข้อ/.test(await textOf(page.getByTestId('import-done'))) && !!xid, `saved as one game (${xid})`);
  await shoot(page, '3-done');
  const rec = await api(`/games/${xid}`);
  const game = rec.body?.game?.game;
  check(rec.status === 200 && game?.title === TITLE, 'the game is in the account under its title');
  check(
    JSON.stringify(game?.rounds.map((r) => [r.title, r.questions.map((q) => [q.type, q.correct.join()])])) ===
      JSON.stringify([
        ['รหัสผ่าน', [['quiz', '2'], ['truefalse', '0']]],
        ['ฟิชชิง', [['truefalse', '0'], ['quiz', '1']]],
      ]),
    `rounds, types and answers as the sheet had them: ${JSON.stringify(game?.rounds.map((r) => r.title))}`,
  );
  check(game?.rounds[0].questions[0].timeLimitS === 45 && game?.rounds[0].questions[0].explanation === 'บรรทัดแรก\nบรรทัดสอง', 'with its time and its explanation');
  check(game?.rounds[1].questions[0].prompt === 'ห้าม แชร์รหัสผ่านทางแชต', 'rich text reads as plain text');

  await page.getByTestId('import-done').getByRole('link', { name: /ทำข้อสอบ/ }).click();
  await page.waitForURL(/\/exam\//);
  await page.getByRole('button', { name: 'เริ่มทำข้อสอบ' }).waitFor({ timeout: 20000 });
  const start = await textOf(page.locator('main'));
  check(start.includes(TITLE) && /4 ข้อ/.test(start), 'the done screen opens it as an exam of 4 questions');
  await page.getByRole('button', { name: 'เริ่มทำข้อสอบ' }).click();
  await page.locator('#exam-prompt').waitFor({ timeout: 10000 });
  check((await page.locator('[data-choice]').count()) >= 2, 'and the exam starts');

  // a paste of 230 rows: three games, each topic drawing 10
  await page.goto(`${WEB}/import`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /วางจากตาราง/ }).click();
  const lines = ['หัวข้อ\tคำถาม\tก\tข\tค\tง\tคำตอบ\tคำอธิบาย'];
  for (let i = 1; i <= 230; i++) lines.push(`${i <= 150 ? 'บทที่ 1' : 'บทที่ 2'}\tข้อที่ ${i} ข้อใดถูก\tถูก ${i}\tผิด ก\tผิด ข\tผิด ค\tก\tเพราะข้อ ${i}`);
  await page.locator('#paste').fill(lines.join('\n'));
  await page.getByRole('button', { name: 'อ่านตาราง' }).click();
  await page.getByTestId('import-summary').waitFor();
  check(/^230 ข้อที่นำเข้าได้ 2 หัวข้อ$/.test(await summary()), `the paste: ${await summary()}`);
  const PASTE = `คลังใหญ่ ${Date.now().toString(36).slice(-5)}`;
  await page.getByTestId('import-title').fill(PASTE);
  check(/แบ่งเป็น 3 ชุด/.test(await textOf(page.locator('main, body'))), 'over 100 questions says it will be three games');
  await page.getByRole('checkbox').check();
  await page.getByRole('combobox', { name: 'จำนวนข้อที่สุ่มต่อหัวข้อ' }).selectOption('10');
  await page.getByTestId('import-save').click();
  await page.getByTestId('import-done').waitFor({ timeout: 30000 });
  const pids = await doneIds();
  pids.forEach((id) => made.add(id));
  check(pids.length === 3 && /นำเข้าแล้ว 230 ข้อ/.test(await textOf(page.getByTestId('import-done'))), `saved as ${pids.length} games`);
  const parts = await Promise.all(pids.map((id) => api(`/games/${id}`).then((r) => r.body?.game?.game)));
  check(
    JSON.stringify(parts.map((g) => [g?.title, g?.rounds.map((r) => [r.title, r.questions.length, r.draw])])) ===
      JSON.stringify([
        [`${PASTE} (ชุดที่ 1/3)`, [['บทที่ 1', 100, 10]]],
        [`${PASTE} (ชุดที่ 2/3)`, [['บทที่ 1', 50, 10], ['บทที่ 2', 50, 10]]],
        [`${PASTE} (ชุดที่ 3/3)`, [['บทที่ 2', 30, 10]]],
      ]),
    'each part keeps its topics in order, and each topic draws 10',
  );

  // files that cannot be used
  await page.goto(`${WEB}/import`, { waitUntil: 'networkidle' });
  await upload('old.xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]), 'application/vnd.ms-excel');
  check(/\.xls แบบเก่า/.test(await textOf(page.locator('main p[role=alert], section p[role=alert]'))), 'an old .xls says to save it as .xlsx');
  await upload('notes.csv', Buffer.from('ชื่อ,อายุ\nก้อง,30\n'), 'text/csv');
  await page.getByTestId('import-summary').waitFor();
  check(/^0 ข้อที่นำเข้าได้ 0 หัวข้อ$/.test(await summary()) && /ไม่พบแถวหัวตาราง/.test(await textOf(page.locator('main, body'))), 'a sheet without a header says what header it needs');
  check((await page.getByTestId('import-save').count()) === 0, 'and offers nothing to save');

  // the ways in
  await page.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
  check((await page.locator(`a[href="${MOUNT}/create"]`).count()) >= 1, '/host links to the create page');
  await page.goto(`${WEB}/create`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid=create-sheet]:not([data-state=loading])').waitFor({ timeout: 20000 });
  check((await page.getByTestId('create-sheet-go').getAttribute('href')) === `${MOUNT}/import`, 'which leads to the import page');
  await page.goto(`${WEB}/editor?id=${xid}`, { waitUntil: 'networkidle' });
  await page.locator(`a[href="${MOUNT}/import"]`).first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
  check((await page.locator(`a[href="${MOUNT}/import"]`).count()) >= 1, 'the editor links to the import page');

  // phones
  for (const width of [360, 414]) {
    const phone = await browser.newContext({ viewport: { width, height: 780 }, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
    const pp = await phone.newPage();
    watch(pp, `phone ${width}`);
    await pp.goto(`${WEB}/import`, { waitUntil: 'networkidle' });
    await pp.getByTestId('sheet-file').waitFor({ state: 'attached', timeout: 20000 });
    const pickOk = await noSideScroll(pp);
    await pp.getByTestId('sheet-file').setInputFiles({ name: 'bank.xlsx', mimeType: 'application/octet-stream', buffer: BANK_XLSX });
    await pp.getByTestId('import-summary').waitFor();
    await pp.getByTestId('import-rounds').getByRole('button', { name: /รหัสผ่าน/ }).click();
    const previewOk = await noSideScroll(pp);
    if (width === 360) await shoot(pp, '4-phone-preview');
    check(pickOk && previewOk, `${width}px: no sideways scroll on the picker or the preview`);
    await phone.close();
  }

  for (const id of made) {
    const r = await api(`/games/${id}`, { method: 'DELETE' });
    if (r.status === 200) made.delete(id);
  }
  check(made.size === 0, 'every game it made is deleted');
  await ctx.close();
} else {
  console.log('skip  the import itself: pass --login=<file> to check it');
}

check(errors.length === 0, `no errors in the browser${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed${made.size ? ` (left behind: games ${[...made].join(', ')})` : ''}`);
process.exit(failed ? 1 : 0);
