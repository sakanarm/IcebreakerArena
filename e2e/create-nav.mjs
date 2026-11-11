// The "create something new" page (/create) and the ways into the exam and create pages from everywhere else.
// Signed out: each of the four ways says what it needs (a login, or an admin), the home page shows the exam link
// even on a phone, the player's join page points to practice exams, and the exam pages link back to games and create.
// Signed in (--login): the maker's pages share one top bar that marks where you are, /host has a create button,
// each way on /create either opens its page or says why it cannot, and a saved game in the editor offers to open
// as an exam. Phones (390 and 360 wide) never scroll sideways. The one game it makes is deleted.
//   node create-nav.mjs [--base=http://localhost:3000] [--login=<file>] [--shots=<dir>]
// Against production: node create-nav.mjs --base=https://dmhub.mfec.dev/PikaArena --login=<file>
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
  // the exam page asks for a shared link by the game's code first, and a game never shared answers 404 there;
  // a signed-out page asks who is logged in and hears 401
  page.on('response', (r) => r.status() >= 400 && !/\/api\/exams\/|\/api\/(me|account|auth)\b/.test(r.url()) && errors.push(`${label} ${r.status()}: ${r.url()}`));
  page.on('dialog', (d) => d.accept());
};
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (loc) => squash(await loc.first().innerText());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const WAYS = ['ai', 'pika', 'sheet', 'editor'];
const settled = (page) => Promise.all(WAYS.map((k) => page.locator(`[data-testid=create-${k}]:not([data-state=loading])`).waitFor({ timeout: 20000 })));
const states = (page) => Promise.all(WAYS.map(async (k) => [k, await page.getByTestId(`create-${k}`).getAttribute('data-state')])).then(Object.fromEntries);

/** Every card is in a state that makes sense, and says so in the one place it should. */
const cardsMakeSense = async (page, label) => {
  for (const k of WAYS) {
    const card = page.getByTestId(`create-${k}`);
    const st = await card.getAttribute('data-state');
    const go = await card.getByTestId(`create-${k}-go`).count();
    const why = await card.getByTestId(`create-${k}-why`).count();
    if (st === 'off') check(go === 0 && why === 1 && (await textOf(card.getByTestId(`create-${k}-why`))).length > 10, `${label}: ${k} is off, with no button and a reason`);
    else check(go === 1 && why === 0, `${label}: ${k} is ${st}, with one button and no reason`);
  }
};

// ---------- signed out ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'anon');

  await page.goto(`${WEB}/create`, { waitUntil: 'networkidle' });
  check((await textOf(page.locator('h1'))) === 'เริ่มจากเนื้อหาที่คุณมี', '/create has its heading');
  check((await page.title()).includes('สร้างข้อสอบใหม่'), `and its tab title (${await page.title()})`);
  await settled(page);
  const st = await states(page);
  check(st.editor === 'go', `the editor is open to anyone (${st.editor})`);
  check(st.pika === 'login' || st.pika === 'off', `Pika asks for a login, or is off without accounts (${st.pika})`);
  check(st.sheet === 'login' || st.sheet === 'go', `the sheet import asks for a login, or is open without accounts (${st.sheet})`);
  check(['login', 'off', 'go'].includes(st.ai), `AI is in a known state (${st.ai})`);
  await cardsMakeSense(page, 'signed out');
  check((await page.getByTestId('create-editor-go').getAttribute('href')) === `${MOUNT}/editor`, 'the editor card opens /editor');
  if (st.pika === 'login') check(/\/login\?next=%2Fpika$/.test((await page.getByTestId('create-pika-go').getAttribute('href')) ?? ''), 'Pika logs in and comes back to /pika');
  if (st.sheet === 'login') check(/\/login\?next=%2Fimport$/.test((await page.getByTestId('create-sheet-go').getAttribute('href')) ?? ''), 'the sheet import logs in and comes back to /import');
  if (st.ai === 'login') check(/\/login\?next=%2Fimport%3Fai%3D1$/.test((await page.getByTestId('create-ai-go').getAttribute('href')) ?? ''), 'AI logs in and comes back to /import?ai=1');
  check((await page.getByTestId('nav-create').getAttribute('aria-current')) === 'page', 'the top bar marks สร้างใหม่ as here');
  check((await page.locator('header [aria-current=page]').count()) === 1, 'and nothing else');
  // the whole card is the button: a click anywhere on the editor card's text opens the editor
  // (the card's link stretches over it, so click where the title is, as a person would)
  const t = await page.getByTestId('create-editor').locator('h2').boundingBox();
  await page.mouse.click(t.x + t.width / 2, t.y + t.height / 2);
  await page.waitForURL((u) => u.pathname === `${MOUNT}/editor`, { timeout: 20000 });
  check(true, 'clicking the editor card title opens /editor');
  await shoot(page, '1-anon-editor');

  // the home page: the exam and create cards, and the exam link in the top bar
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  check((await page.locator(`section a[href="${MOUNT}/create"]`).count()) === 1, 'home has a card for the create page');
  check((await page.locator(`section a[href="${MOUNT}/exam"]`).count()) === 1, 'and one for exams');
  check((await page.locator(`a[href="${MOUNT}/editor"]`).count()) === 0, 'and no longer a link straight to the editor');

  // the player's join page
  await page.goto(`${WEB}/play`, { waitUntil: 'networkidle' });
  const join = page.getByTestId('join-exam');
  check((await join.count()) === 1 && (await join.getAttribute('href')) === `${MOUNT}/exam`, 'the join page points to practice exams');

  // the exam pages link back to games and to create
  await page.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
  check((await page.getByTestId('exam-nav-create').getAttribute('href')) === `${MOUNT}/create`, '/exam has a create link in its header');
  check((await page.getByTestId('exam-nav-host').getAttribute('href')) === `${MOUNT}/host`, 'and a link to the games');
  check((await page.locator(`main a[href="${MOUNT}/create"]`).count()) === 1, 'and a create card at the bottom');
  const sample = await page.locator(`main a[href^="${MOUNT}/exam/"]`).first().getAttribute('href');
  await page.goto(`${WEB}${sample.slice(MOUNT.length)}`, { waitUntil: 'networkidle' });
  check((await page.getByTestId('exam-nav-create').count()) === 1, `a sample exam's start page keeps the header links (${sample.slice(MOUNT.length)})`);
  await ctx.close();
}

// ---------- phones, signed out ----------
for (const [w, h] of [
  [390, 844],
  [360, 740],
]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, `anon ${w}`);
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' });
  check(await page.locator(`header a[href="${MOUNT}/exam"]`).isVisible(), `${w}px: the home top bar shows ข้อสอบ`);
  check(await noSideScroll(page), `${w}px: home never scrolls sideways`);
  for (const p of ['/create', '/exam', '/play']) {
    await page.goto(`${WEB}${p}`, { waitUntil: 'networkidle' });
    if (p === '/create') await settled(page);
    check(await noSideScroll(page), `${w}px: ${p} never scrolls sideways`);
  }
  await page.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
  check(await page.getByTestId('exam-nav-create').isVisible(), `${w}px: the exam header's create link shows`);
  check((await page.getByTestId('exam-nav-host').isVisible()) === w >= 359, `${w}px: and its games link ${w >= 359 ? 'shows' : 'hides'}`);
  await shoot(page, `2-anon-exam-${w}`);
  await ctx.close();
}

// ---------- signed in ----------
let gameId = null;
if (who) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'maker');
  const api = (path, init = {}) =>
    page.evaluate(
      async ([u, i]) => {
        const r = await fetch(u, { ...i, headers: { 'x-ib-req': '1', 'content-type': 'application/json', ...(i.headers ?? {}) } });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [`${MOUNT}/api${path}`, init],
    );

  await page.goto(`${WEB}/login?next=/create`, { waitUntil: 'networkidle' });
  await page.locator('#login-user').fill(who.username);
  await page.locator('#login-password').fill(who.password);
  await page.locator('button[type=submit]').click();
  await page.waitForURL((u) => u.pathname === `${MOUNT}/create`, { timeout: 20000 });
  check(true, 'signed in, back on /create');
  await settled(page);
  const st = await states(page);
  check(st.sheet === 'go' && st.editor === 'go', `the sheet import and the editor are open (${st.sheet}, ${st.editor})`);
  check(st.ai !== 'login' && st.pika !== 'login', `nothing asks a logged-in maker to log in (ai ${st.ai}, pika ${st.pika})`);
  await cardsMakeSense(page, 'signed in');
  check((await page.getByTestId('create-sheet-go').getAttribute('href')) === `${MOUNT}/import`, 'the sheet card opens /import');
  if (st.ai === 'go') {
    check((await page.getByTestId('create-ai-go').getAttribute('href')) === `${MOUNT}/import?ai=1`, 'the AI card opens /import?ai=1');
    check(/วันนี้ใช้ได้อีก \d+ จาก \d+ ครั้ง/.test(await textOf(page.getByTestId('create-ai'))), 'and says how many tries are left today');
  }
  // the Pika card agrees with what the server says about this account
  const pika = await api('/pika/project');
  if (pika.status === 200) {
    const want = !pika.body.configured || !pika.body.hasEmail ? 'off' : 'go';
    check(st.pika === want, `the Pika card is ${st.pika}, as the account says (configured ${pika.body.configured}, has an email ${pika.body.hasEmail})`);
    if (pika.body.configured && !pika.body.hasEmail) check((await textOf(page.getByTestId('create-pika-why'))).includes('อีเมล'), 'and explains the account needs an email');
    if (want === 'go') check((await page.getByTestId('create-pika-go').getAttribute('href')) === `${MOUNT}/pika`, 'and opens /pika');
  } else check(st.pika === 'go', `the Pika status could not be read (${pika.status}), so the card just opens /pika`);
  check((await page.locator(`main a[href="${MOUNT}/login?next=%2Fcreate"]`).count()) === 0, 'no banner asks to log in');
  await shoot(page, '3-maker-create');

  // the top bar marks where you are, on every maker page
  for (const [p, here] of [
    ['/host', 'nav-host'],
    ['/create', 'nav-create'],
    ['/import', 'nav-create'],
    ['/pika', 'nav-create'],
  ]) {
    await page.goto(`${WEB}${p}`, { waitUntil: 'networkidle' });
    const on = await page.locator('header [aria-current=page]').evaluateAll((as) => as.map((a) => a.getAttribute('data-testid')));
    check(on.length === 1 && on[0] === here, `${p}: the top bar marks ${here} (${on.join(',')})`);
    check((await page.getByTestId('nav-exam').getAttribute('href')) === `${MOUNT}/exam`, `${p}: and links to exams`);
    if (p === '/import' || p === '/pika') check((await page.locator(`a[href="${MOUNT}/create"]`).filter({ hasText: 'วิธีสร้างอื่น' }).count()) === 1, `${p}: and links back to the other ways`);
  }
  await page.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
  check((await page.getByTestId('host-create').getAttribute('href')) === `${MOUNT}/create`, '/host has a create button');

  // a saved game in the editor offers to open as an exam
  const tag = Date.now().toString(36).slice(-5);
  const q = (prompt) => ({ type: 'quiz', prompt, options: ['ถูก', 'ผิด ก', 'ผิด ข', 'ผิด ค'], correct: [0], timeLimitS: 20, explanation: 'เพราะถูก' });
  const made = await api('/games', {
    method: 'POST',
    body: JSON.stringify({ game: { title: `ทางเข้าข้อสอบ ${tag}`, rounds: [{ title: 'รอบเดียว', questions: [q('ข้อหนึ่ง'), q('ข้อสอง'), { type: 'poll', prompt: 'โพล', options: ['ก', 'ข'], correct: [], timeLimitS: 10 }] }] } }),
  });
  gameId = made.body?.game?.id ?? null;
  check(made.status === 201 && !!gameId, `a test game was made (${made.status})`);
  if (gameId) {
    await page.goto(`${WEB}/editor?id=${gameId}`, { waitUntil: 'networkidle' });
    const link = page.getByTestId('editor-exam');
    await link.waitFor({ timeout: 20000 }).catch(() => {});
    check((await link.count()) === 1, 'the editor offers to open it as an exam');
    if (await link.count()) {
      check((await link.getAttribute('href')) === `${MOUNT}/exam/${gameId}` && (await link.getAttribute('target')) === '_blank', 'in a new tab, at /exam/<its id>');
      check((await textOf(link)).includes('2 ข้อที่ใช้เป็นข้อสอบได้'), `and counts the two quiz questions, not the poll (${await textOf(link)})`);
      const [tab] = await Promise.all([ctx.waitForEvent('page'), link.click()]);
      watch(tab, 'exam tab');
      await tab.waitForLoadState('networkidle');
      await tab.getByRole('heading', { name: `ทางเข้าข้อสอบ ${tag}` }).waitFor({ timeout: 20000 }).catch(() => {});
      check((await tab.getByRole('heading', { name: `ทางเข้าข้อสอบ ${tag}` }).count()) >= 1, 'and the new tab opens that game as an exam');
      await tab.close();
    }
    // a game with no exam questions gets no link
    const polls = await api(`/games/${gameId}`, {
      method: 'PUT',
      body: JSON.stringify({
        version: made.body.game.version,
        game: { title: `ทางเข้าข้อสอบ ${tag}`, rounds: [{ title: 'รอบเดียว', questions: [{ type: 'poll', prompt: 'โพล', options: ['ก', 'ข'], correct: [], timeLimitS: 10 }] }] },
      }),
    });
    if (polls.status === 200) {
      await page.goto(`${WEB}/editor?id=${gameId}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);
      check((await page.getByTestId('editor-exam').count()) === 0, 'a game of only polls gets no exam link');
    } else console.log(`note  could not rewrite the test game (${polls.status}), skipped the polls-only check`);
  }

  // phones, signed in
  for (const [w, h] of [
    [390, 844],
    [360, 740],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const p of ['/host', '/create', '/import', '/pika']) {
      await page.goto(`${WEB}${p}`, { waitUntil: 'networkidle' });
      if (p === '/create') await settled(page);
      check(await noSideScroll(page), `${w}px signed in: ${p} never scrolls sideways`);
    }
    const bar = await page.locator('header nav').boundingBox();
    check(!!bar && bar.width >= w - 40, `${w}px: the top bar's places fill a row of their own (${Math.round(bar?.width ?? 0)}px)`);
    await shoot(page, `4-maker-pika-${w}`);
  }

  if (gameId) {
    const del = await api(`/games/${gameId}`, { method: 'DELETE' });
    check(del.status === 200 || del.status === 204, `the test game was deleted (${del.status})`);
  }
  await ctx.close();
}

await browser.close();
for (const e of errors) check(false, e);
console.log(`\n${passed} passed, ${failed} failed${who ? '' : ' (signed-out checks only: pass --login=<file> for the rest)'}`);
process.exit(failed ? 1 : 0);
