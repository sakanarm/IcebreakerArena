// A question bank, from the editor to the report: import a game whose first round
// holds 30 questions, make that round a bank that asks 10, and check every place that says so (the round
// panel, the outline, a question's panel, the game's numbers, the card on /host), at a desk and on a phone.
// Then play it on the Host page with bot players and check the room asks 10 of the 30, each once, and that
// the counter, the round card and the report count only those. A second room, played by socket at the same
// time, has to draw a different set.
//   node bank.mjs [--base=http://localhost:3000] [--login=<file>] [--shots=<dir>]
// Against production: node bank.mjs --base=https://dmhub.mfec.dev/PikaArena --login=<file>
// Where making games needs an account (AUTH_MODE local), --login names a file holding a "username: …" line and
// a "password: …" line, which is what `npm run users -- add <name> "<display name>" --out=<file>` writes. With
// no login mode the games stay in the test browser's own storage. Either way both rooms are closed at the end
// and the games the test imported are deleted.
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { require, launchOptions } from './lib/rig.mjs';
const { io } = require('socket.io-client');

const WEB = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? '';
const MOUNT = new URL(WEB).pathname.replace(/\/$/, '');
const GAME_AT = WEB === 'http://localhost:3000' ? { url: 'http://localhost:4000', path: '/socket.io' } : { url: new URL(WEB).origin, path: `${MOUNT}/socket.io` };
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
const connect = () => io(GAME_AT.url, { path: GAME_AT.path, transports: ['websocket'], forceNew: true, reconnection: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BANK = 30;
const DRAW = 10;
const PLAYERS = 3;
const tag = Date.now().toString(36).slice(-5);
const TITLE = `คลังคำถามทดสอบ ${tag}`;
const quiz = (prompt) => ({ type: 'quiz', prompt, options: ['ข้อที่ถูก', 'ผิด ก', 'ผิด ข', 'ผิด ค'], correct: [0], timeLimitS: 5 });
const BANKED = Array.from({ length: BANK }, (_, i) => `คำถามจากคลัง หมายเลข ${String(i + 1).padStart(2, '0')}`);
const FIXED = ['คำถามปิดท้าย ก', 'คำถามปิดท้าย ข'];
const FILE = {
  title: TITLE,
  description: 'เกมทดสอบคลังคำถาม: ด่านแรกมี 30 ข้อ สุ่มมาถาม 10',
  rounds: [
    { title: 'คลังความรู้', questions: BANKED.map(quiz) },
    { title: 'ปิดท้าย', questions: FIXED.map(quiz) },
  ],
};
const asFile = (name, game) => ({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(game)) });

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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools/.test(m.text()) && errors.push(m.text().slice(0, 160)));
// deleting nothing here, but the editor asks before some changes: say yes
page.on('dialog', (d) => d.accept());

const text = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, ' ').trim();
const outline = page.getByRole('navigation', { name: 'โครงเกม' });
const bankSwitch = page.getByRole('switch', { name: /สุ่มคำถามจากคลัง/ });
const box = page.locator('[data-bank] input');
const less = page.getByRole('button', { name: 'ถามน้อยลง 1 ข้อ' });
const more = page.getByRole('button', { name: 'ถามเพิ่ม 1 ข้อ' });
const pill = () => text('[data-round-count]');
const note = () => text('[data-bank] [data-bank-note]');
const importGame = async (name, game) => {
  await page.locator('input[type=file]').setInputFiles(asFile(name, game));
};
const openRound = async (title) => {
  await outline.getByRole('button').filter({ hasText: title }).first().click();
  await page.waitForSelector('[data-round-count]', { timeout: 10000 });
};

// ---------- the editor, at a desk
if (who) {
  await page.goto(`${WEB}/login?with=password&next=/editor`, { waitUntil: 'networkidle' });
  await page.locator('#login-user').fill(who.username);
  await page.locator('#login-password').fill(who.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/editor(\?|$)/, { timeout: 20000 }).catch(() => {});
} else {
  await page.goto(`${WEB}/editor`, { waitUntil: 'networkidle' });
}
const opened = await page.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 20000 }).then(() => true, () => false);
if (!opened) {
  console.log(`FAIL  the editor did not open${who ? ': the login was not taken' : ': this site wants a login to make games, pass --login=<file>'}`);
  await browser.close();
  process.exit(1);
}
check(true, who ? `signed in as ${who.username}` : 'nobody is signed in, so the games stay in this browser');
const imported = [];
await importGame('bank.json', FILE);
await page.waitForURL(/\/editor\?id=/, { timeout: 20000 });
await page.waitForSelector(`text=${TITLE}`, { timeout: 20000 });
const gameId = new URL(page.url()).searchParams.get('id');
imported.push(gameId);
check(Boolean(gameId), `the 32-question game was imported ${who ? 'into the account' : 'into this browser'}`);

await openRound('คลังความรู้');
check((await pill()) === `${BANK} ข้อ`, `a plain round says how many questions it has (${await pill()})`);
check((await bankSwitch.getAttribute('aria-checked')) === 'false', 'the bank switch starts off');
check(!(await page.locator('[data-bank]').count()), 'and shows no number to set');
check(!(await outline.locator('[role=img][aria-label^="สุ่ม"]').count()), 'the outline marks no round as a bank');
await shoot(page, '01-round-plain');

await bankSwitch.click();
await page.waitForSelector('[data-bank]', { timeout: 5000 });
check((await bankSwitch.getAttribute('aria-checked')) === 'true', 'the switch turns on');
check((await box.inputValue()) === String(DRAW), `a bank of ${BANK} starts at ${DRAW} (${await box.inputValue()})`);
check((await pill()) === `🎲 สุ่ม ${DRAW} จาก ${BANK} ข้อ`, `the round says it (${await pill()})`);
check((await note()).startsWith(`อีก ${BANK - DRAW} ข้อพักไว้รอบหน้า`), `and how many rest (${(await note()).slice(0, 30)}…)`);
check((await outline.locator(`[role=img][aria-label="สุ่ม ${DRAW} จาก ${BANK} ข้อ"]`).count()) === 1, 'the outline marks the round 🎲 10/30');
await page.waitForTimeout(400); // the panel slides in
await shoot(page, '02-round-bank');

await less.click();
check((await box.inputValue()) === '9' && (await pill()) === `🎲 สุ่ม 9 จาก ${BANK} ข้อ`, '− asks one fewer');
await more.click();
await more.click();
check((await box.inputValue()) === '11' && (await pill()) === `🎲 สุ่ม 11 จาก ${BANK} ข้อ`, '＋ asks one more');
await box.fill(String(BANK));
check((await pill()) === `🎲 ${BANK} ข้อ สลับลำดับ`, `asking them all only shuffles (${await pill()})`);
check((await note()).startsWith(`ตอนนี้ถามครบทั้ง ${BANK} ข้อ`), 'and the note says how to get different sets');
check(await more.isDisabled(), '＋ stops at the size of the bank');
await box.fill('99');
check((await box.inputValue()) === String(BANK), `a number over the bank is held to it (${await box.inputValue()})`);
await box.fill('');
check((await pill()) === `🎲 ${BANK} ข้อ สลับลำดับ`, 'an emptied box changes nothing yet');
await box.blur();
check((await box.inputValue()) === String(BANK), 'and gets its number back when left');
await box.fill('0');
check((await pill()) === `🎲 ${BANK} ข้อ สลับลำดับ`, 'a zero is not taken');
await box.blur();
await box.fill('1');
check((await pill()) === `🎲 สุ่ม 1 จาก ${BANK} ข้อ` && (await less.isDisabled()), '1 is the least, and − stops there');
await box.fill('x7y');
check((await box.inputValue()) === '7', `letters are dropped (${await box.inputValue()})`);
await box.fill(String(DRAW));
check((await pill()) === `🎲 สุ่ม ${DRAW} จาก ${BANK} ข้อ`, `back to ${DRAW}`);

// a question of the bank says it may sit a room out
await outline.getByRole('button').filter({ hasText: BANKED[0] }).first().click();
await page.waitForSelector('h2:has-text("ข้อ 1")', { timeout: 10000 });
const qNote = await page.locator('[data-bank-note]').first().innerText().catch(() => '');
check(qNote.includes(`สุ่มถาม ${DRAW} จาก ${BANK} ข้อ`), `a question in the bank says so (${qNote.replace(/\s+/g, ' ').slice(0, 40)})`);
await shoot(page, '03-question-in-bank');
await outline.getByRole('button').filter({ hasText: FIXED[0] }).first().click();
await page.waitForTimeout(500);
check(!(await page.locator('[data-bank-note]').count()), 'a question of a plain round says nothing of the kind');

// the game's own numbers
await page.locator('header button').filter({ hasText: TITLE }).first().click();
await page.waitForSelector(`text=ข้อต่อรอบ จากคลัง ${BANK + FIXED.length} ข้อ`, { timeout: 10000 }).catch(() => {});
const settings = await page.locator('main').innerText();
check(settings.includes(`ข้อต่อรอบ จากคลัง ${BANK + FIXED.length} ข้อ`) && settings.includes(`🎲 ${DRAW + FIXED.length}`), `the game counts ${DRAW + FIXED.length} a room, out of ${BANK + FIXED.length}`);
await shoot(page, '04-game-numbers');

// off and on again
await openRound('คลังความรู้');
await bankSwitch.click();
check((await pill()) === `${BANK} ข้อ` && !(await page.locator('[data-bank]').count()), 'switched off, the round asks all 30 in order again');
check(!(await outline.locator('[role=img][aria-label^="สุ่ม"]').count()), 'and the outline drops the mark');
await bankSwitch.click();
check((await box.inputValue()) === String(DRAW), 'switched on again, it starts at 10');

// a small round starts at half
await openRound('ปิดท้าย');
await bankSwitch.click();
check((await pill()) === '🎲 สุ่ม 1 จาก 2 ข้อ', `a round of 2 starts at 1 (${await pill()})`);
await bankSwitch.click();
check((await pill()) === '2 ข้อ', 'and goes back to plain');

// it is saved, and still there after a reload
const stored = async () =>
  who
    ? page.evaluate(async (url) => (await (await fetch(url, { cache: 'no-store' })).json()).game?.game ?? null, `${MOUNT}/api/games/${gameId}`)
    : page.evaluate((id) => JSON.parse(localStorage.getItem('ib.games') ?? '[]').find((g) => g.id === id) ?? null, gameId);
let saved = null;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(250);
  saved = await stored();
  if (saved?.rounds[0].draw === DRAW && !('draw' in saved.rounds[1])) break;
}
check(saved?.rounds[0].draw === DRAW && !('draw' in (saved?.rounds[1] ?? {})), `the saved game keeps draw ${DRAW} on the bank round only`);
await page.reload({ waitUntil: 'networkidle' });
await openRound('คลังความรู้');
check((await pill()) === `🎲 สุ่ม ${DRAW} จาก ${BANK} ข้อ` && (await box.inputValue()) === String(DRAW), 'after a reload the bank is as it was left');

// ---------- the same panel on a phone
for (const [w, h] of [
  [390, 800],
  [360, 640],
]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await page.locator('[data-bank]').scrollIntoViewIfNeeded();
  const fit = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [...document.querySelectorAll('[data-bank], [data-bank] *, [data-round-count]')]
      .map((el) => [el, el.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.left < -0.5 || r.right > vw + 0.5))
      .map(([el]) => el.tagName);
    const tap = [...document.querySelectorAll('[data-bank] button, [data-bank] input')].map((el) => Math.round(el.getBoundingClientRect().height));
    return { vw, sideways: document.documentElement.scrollWidth > vw, out, tap };
  });
  check(!fit.sideways, `${w}px: the page does not scroll sideways`);
  check(!fit.out.length, `${w}px: the bank panel stays inside the screen${fit.out.length ? ` (${fit.out.join(',')})` : ''}`);
  check(fit.tap.every((t) => t >= 40), `${w}px: − the number and ＋ are big enough to tap (${fit.tap.join('/')})`);
  await less.click();
  await more.click();
  check((await box.inputValue()) === String(DRAW), `${w}px: − and ＋ work`);
  await shoot(page, `05-phone-${w}`);
}
await page.setViewportSize({ width: 1280, height: 900 });

// ---------- import: a draw the file carries
await importGame('one.json', { title: `คลังข้อเดียว ${tag}`, rounds: [{ title: 'ด่านเดียว', draw: 5, questions: [quiz('มีข้อเดียว')] }] });
await page.waitForFunction((id) => new URL(location.href).searchParams.get('id') !== id, gameId, { timeout: 20000 });
await page.waitForSelector(`text=คลังข้อเดียว ${tag}`, { timeout: 20000 });
imported.push(new URL(page.url()).searchParams.get('id'));
await openRound('ด่านเดียว');
check((await box.inputValue()) === '1', `a file asking for more than the round has is held to it (${await box.inputValue()})`);
check((await note()).startsWith('ด่านนี้มีข้อเดียว'), 'a bank of one question says to add more first');
check((await pill()) === '🎲 1 ข้อ', `and its round does not speak of shuffling (${await pill()})`);
check((await less.isDisabled()) && (await more.isDisabled()), 'with nothing to choose, − and ＋ are both off');
await shoot(page, '06-bank-of-one');
await importGame('bad.json', { title: `คลังเสีย ${tag}`, rounds: [{ title: 'ด่าน', draw: 0, questions: [quiz('ก'), quiz('ข')] }] });
const toast = await page.getByText(/นำเข้าไม่ได้/).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => page.getByText(/นำเข้าไม่ได้/).first().innerText(), () => '');
check(toast.includes('จำนวนข้อที่สุ่มมาถาม'), `a draw of 0 in a file is refused in words (${toast.replace(/\s+/g, ' ').slice(0, 70)})`);

// ---------- the card on /host
await page.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
const card = page.locator('article').filter({ hasText: TITLE }).first();
await card.waitFor({ state: 'visible', timeout: 20000 });
const cardText = (await card.innerText()).replace(/\s+/g, ' ');
check(cardText.includes(`2 ด่าน · 🎲 ${DRAW + FIXED.length} จาก ${BANK + FIXED.length} ข้อ`), `the game's card says 🎲 12 จาก 32 ข้อ`);
await card.scrollIntoViewIfNeeded();
await shoot(page, '07-host-card');

// ---------- play it
// server clock minus ours, as the player app works it out, so the bots answer once a question opens
const probe = connect();
let skew = 0;
{
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const sent = Date.now();
    const at = await probe.timeout(5000).emitWithAck('time:sync');
    const rtt = Date.now() - sent;
    if (rtt < best) [best, skew] = [rtt, at - (sent + rtt / 2)];
  }
  probe.close();
}
const refused = [];
/** a player that picks the first tile shortly after each question opens; `seen` gets every state */
const bot = async (pin, k, seen) => {
  const s = connect();
  const done = new Set();
  s.on('player:state', (st) => {
    seen?.(st);
    const q = st.question;
    if (st.phase !== 'question' || !q || done.has(q.id)) return;
    done.add(q.id);
    const wait = Math.max(0, q.startsAt - (Date.now() + skew)) + 300 + k * 150;
    setTimeout(() => s.emit('player:answer', { questionId: q.id, choice: 0 }, (res) => res?.ok || refused.push(`room ${pin} bot ${k} q${q.number}: ${res?.error}`)), wait);
  });
  const j = await s.timeout(10000).emitWithAck('player:join', { pin, nickname: `บอท ${k + 1}`, avatar: '🦊' });
  if (!j.ok) throw new Error(`join ${pin}: ${j.error}`);
  return s;
};

/** the same game in a second room, with no browser: one host socket, one player, straight to the report */
const bySocket = async (game) => {
  const host = connect();
  let S = null;
  host.on('stage:state', (s) => (S = s));
  const created = await host.timeout(10000).emitWithAck('host:create', { game });
  if (!created.ok) throw new Error(`host:create: ${created.error} ${created.message ?? ''}`);
  const player = await bot(created.pin, 0);
  const until = async (fn, what, ms = 60000) => {
    const end = Date.now() + ms;
    while (!(S && fn(S))) {
      if (Date.now() > end) throw new Error(`room ${created.pin}: timed out waiting for ${what} (phase ${S?.phase})`);
      await sleep(40);
    }
  };
  await until((s) => s.playerCount === 1, 'the player');
  host.emit('host:next', S.step);
  for (;;) {
    await until((s) => ['reveal', 'leaderboard', 'podium'].includes(s.phase), 'a reveal, a leaderboard or the podium');
    if (S.phase === 'podium') break;
    const was = S.step;
    host.emit('host:next', was);
    await until((s) => s.step !== was, `leaving step ${was}`);
  }
  const got = await host.timeout(10000).emitWithAck('host:report');
  await host.timeout(10000).emitWithAck('host:close', { pin: created.pin, hostToken: created.hostToken }).catch(() => {});
  player.close();
  host.close();
  if (!got.ok) throw new Error(`host:report: ${got.error}`);
  return got.report;
};

await page.goto(`${WEB}/editor?id=${gameId}`, { waitUntil: 'networkidle' });
await page.waitForSelector(`text=${TITLE}`, { timeout: 20000 });
saved = await stored();
const second = bySocket(saved).then(
  (report) => ({ report }),
  (e) => ({ error: e.message }),
);
await page.getByRole('button', { name: /เล่นเลย/ }).click();
await page.waitForURL(/\/host\/\d{6}(\?|#|$)/, { timeout: 30000 });
const pin = page.url().match(/\/host\/(\d{6})/)[1];
console.log(`room ${pin} is open on ${WEB}`);

let P = null;
const bots = [];
for (let k = 0; k < PLAYERS; k++) bots.push(await bot(pin, k, k === 0 ? (st) => (P = st) : undefined));
const next = () => page.locator('button').filter({ hasText: /เริ่มเกม|ดูอันดับ|ประกาศผล|ข้อถัดไป/ }).last();
await page.locator('button').filter({ hasText: 'เริ่มเกม' }).last().waitFor({ state: 'visible', timeout: 20000 });
await shoot(page, '08-lobby');

const asked = [];
const rounds = [];
const giveUp = Date.now() + 6 * 60_000;
let where = '';
while (Date.now() < giveUp) {
  const st = P;
  if (!st) {
    await sleep(150);
    continue;
  }
  if (st.phase === 'podium') break;
  if (st.phase === 'round' && st.round && !rounds.some((r) => r.index === st.round.index)) {
    rounds.push(st.round);
    const said = await page.getByText(`${st.round.questionCount} ข้อ`, { exact: true }).first().waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
    check(said, `round ${st.round.index + 1}'s card says ${st.round.questionCount} ข้อ`);
    await shoot(page, `09-round-${st.round.index + 1}`);
  }
  if (st.phase === 'question' && st.question && !asked.some((a) => a.id === st.question.id)) {
    const q = st.question;
    asked.push(q);
    const chip = page.locator('header span').filter({ hasText: new RegExp(`^\\s*ข้อ\\s*${q.number}\\s*/\\s*${q.total}\\s*$`) });
    const counted = await chip.first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    const shown = await page.getByText(q.prompt, { exact: true }).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
    check(counted && shown, `question ${q.number} / ${q.total} is on the Host's screen: ${q.prompt}`);
    if (q.number === 1) await shoot(page, '10-question-1');
  }
  const here = `${st.phase}:${st.question?.id ?? ''}`;
  if (st.phase === 'lobby' || st.phase === 'reveal' || st.phase === 'leaderboard') {
    if (where !== here) await sleep(st.phase === 'lobby' ? 300 : 900); // let the scene land before pressing on
    where = here;
    await next().click({ timeout: 3000 }).catch(() => {});
    const end = Date.now() + 3000;
    while (Date.now() < end && `${P.phase}:${P.question?.id ?? ''}` === here) await sleep(60);
    continue;
  }
  await sleep(120);
}
check(P?.phase === 'podium', 'the game reached the podium');

const total = DRAW + FIXED.length;
const fromBank = asked.filter((q) => q.roundIndex === 0).map((q) => q.prompt);
const closing = asked.filter((q) => q.roundIndex === 1).map((q) => q.prompt);
check(asked.length === total, `the room asked ${total} questions (${asked.length})`);
check(asked.every((q, i) => q.number === i + 1 && q.total === total), `numbered 1 to ${total}, each of ${total}`);
check(fromBank.length === DRAW && new Set(fromBank).size === DRAW && fromBank.every((p) => BANKED.includes(p)), `${DRAW} of them from the bank, none twice`);
check(JSON.stringify(closing) === JSON.stringify(FIXED), 'the plain round after it came whole and in the order written');
check(rounds.length === 2 && rounds[0].questionCount === DRAW && rounds[1].questionCount === FIXED.length, `the rounds counted ${DRAW} and ${FIXED.length}`);
check(JSON.stringify(fromBank) !== JSON.stringify(BANKED.slice(0, DRAW)), 'the draw is not just the first 10 as written');
console.log(`      drawn: ${fromBank.map((p) => p.slice(-2)).join(' ')}`);

// the report counts the questions asked, no others
await page.waitForTimeout(2500);
await shoot(page, '11-podium');
await page.locator('button').filter({ hasText: 'ดูรายงาน' }).last().click();
await page.getByRole('tab', { name: /รายข้อ/ }).click({ timeout: 20000 });
await page.waitForSelector('ol > li', { timeout: 20000 });
await page.waitForTimeout(800);
const reported = await page.locator('ol > li > p.font-semibold').allInnerTexts();
check(JSON.stringify(reported.map((p) => p.trim())) === JSON.stringify(asked.map((q) => q.prompt)), `the report lists the same ${total} questions in the order asked (${reported.length})`);
const reportText = await page.innerText('body');
check(!BANKED.filter((p) => !fromBank.includes(p)).some((p) => reportText.includes(p)), 'no question that stayed in the bank is in the report');
await shoot(page, '12-report', true);

// the second room drew for itself
const other = await second;
if (!check(!other.error, `a second room of the same game played through${other.error ? `: ${other.error}` : ''}`)) {
  // nothing to compare
} else {
  const theirs = other.report.questions.map((q) => q.prompt);
  const theirBank = theirs.filter((p) => BANKED.includes(p));
  check(theirs.length === total && theirBank.length === DRAW && new Set(theirBank).size === DRAW, `it also asked ${total}, ${DRAW} of them from the bank, none twice`);
  check(JSON.stringify(theirs.slice(DRAW)) === JSON.stringify(FIXED), 'and ended on the same plain round');
  check(JSON.stringify(theirBank) !== JSON.stringify(fromBank), 'but not the same draw as the first room');
  console.log(`      drawn: ${theirBank.map((p) => p.slice(-2)).join(' ')}`);
}

check(!refused.length, `every bot's answer was taken${refused.length ? `: ${refused.slice(0, 5).join(', ')}` : ''}`);
check(!errors.length, `no console or page errors${errors.length ? `\n  ${errors.slice(0, 8).join('\n  ')}` : ''}`);

// leave nothing behind: the games this test imported, then the room
if (who) {
  const gone = await page.evaluate(
    async (urls) => Promise.all(urls.map(async (u) => (await fetch(u, { method: 'DELETE', headers: { 'x-ib-req': '1' } })).status)),
    imported.map((id) => `${MOUNT}/api/games/${id}`),
  );
  check(gone.every((st) => st >= 200 && st < 300), `the ${imported.length} test games are deleted from the account (${gone.join(', ')})`);
}
const hostToken = await page.evaluate((p) => JSON.parse(localStorage.getItem(`ib.host.${p}`) ?? 'null'), pin);
const closer = connect();
const closed = await closer.timeout(10000).emitWithAck('host:close', { pin, hostToken }).catch((e) => ({ ok: false, error: e.message }));
check(closed?.ok === true, `room ${pin} is closed${closed?.ok ? '' : ` (${closed?.error})`}`);
closer.close();
for (const b of bots) b.close();
await browser.close();
console.log(`\n${passed} passed`);
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
