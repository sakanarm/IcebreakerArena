// The admin page (/admin) in a real browser: users and their roles and permissions, the AI connection,
// and the system tab, at desk and phone width.
//
// Local (a dev server on this machine) runs everything:
//  - an admin makes an account, which logs in with the password shown once;
//  - a role and a permission are changed, and that person's open session sees it at once (sharing and
//    the Pika page are refused, /create says the permission is off);
//  - the account is disabled (logged out everywhere, can't log in) and enabled again;
//  - a new password is issued (the old one stops working, the new one works);
//  - the admin can't demote or disable themself;
//  - the AI tab saves a gateway, key, model and header to var/secrets/ai.json, pointing at a stand-in
//    provider here. The key and header value never reach the browser, not in a page or in an answer.
//    The connection test passes, then fails without echoing the key, and AI can be turned off and on.
//  - a maker gets the "admins only" page and 403 from every /api/admin call.
// It writes <repo>/var/secrets/ai.json and removes it at the end; it will not run if that file is
// already there. The account it makes is left disabled (nothing is ever deleted on this page).
//
// Anywhere else (production) it changes nothing: as an admin it opens each tab and checks that no secret
// is on the page; as anyone else, that the page and the API refuse.
//
//   node admin.mjs --login=<admin file> [--maker-login=<file>] [--base=http://localhost:3000] [--shots=<dir>]
// Login files hold "username: …" and "password: …" lines.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchOptions } from './lib/rig.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const WEB = (arg('base') || 'http://localhost:3000').replace(/\/$/, '');
const MOUNT = new URL(WEB).pathname.replace(/\/$/, '');
const SHOTS = arg('shots');
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(WEB);
const readLogin = (file) => {
  const who = Object.fromEntries(
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*(username|password)\s*:\s*(.+?)\s*$/)?.slice(1))
      .filter(Boolean),
  );
  if (!(who.username && who.password)) throw new Error(`${file}: want a "username: …" line and a "password: …" line`);
  return who;
};
if (!arg('login')) throw new Error('admin.mjs needs --login=<file> for an admin account');
const ADMIN = readLogin(arg('login'));
const MAKER = arg('maker-login') ? readLogin(arg('maker-login')) : null;

const SECRETS = fileURLToPath(new URL('../var/secrets/', import.meta.url));
const AI_FILE = join(SECRETS, 'ai.json');
if (LOCAL && existsSync(AI_FILE)) throw new Error(`${AI_FILE} is already there: move it away first, this check will not overwrite it`);

const KEY = 'sk-e2e-admin-not-a-real-key-0123456789';
const HEADER_VALUE = 'e2e-admin-header-secret-77';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the stand-in AI provider (the connection test is one plain Messages call)
let reply = null;
const provider = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    const r = reply ?? {
      status: 200,
      body: { id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } },
    };
    res.writeHead(r.status, { 'content-type': 'application/json', 'x-should-retry': 'false' });
    res.end(JSON.stringify(r.body));
  });
});

const browser = await chromium.launch(launchOptions);
const errors = [];
const watch = (page, who) => {
  page.on('pageerror', (e) => errors.push(`${who}: ${e}`));
  page.on('console', (m) => {
    // a refused API call is logged by the browser as a failed resource; the page handles it
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`);
  });
};

async function loginAs(who, viewport = { width: 1280, height: 900 }, next = '/admin') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  watch(page, who.username);
  await page.goto(`${WEB}/login?with=password&next=${encodeURIComponent(next)}`, { waitUntil: 'networkidle' });
  await page.locator('#login-user').fill(who.username);
  await page.locator('#login-password').fill(who.password);
  await page.keyboard.press('Enter');
  await page.waitForURL((u) => u.pathname.endsWith(next), { timeout: 30000 });
  return { ctx, page };
}

/** a call as the page makes it: same origin, our header */
const api = (page, path, method = 'GET', body) =>
  page.evaluate(
    async ({ url, method, body }) => {
      const r = await fetch(url, {
        method,
        headers: { 'x-ib-req': '1', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, text: await r.text() };
    },
    { url: `${MOUNT}${path}`, method, body },
  );
const me = async (page) => JSON.parse((await api(page, '/api/auth/me')).text).user;
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const noSecret = (text) => !text.includes(KEY) && !text.includes(HEADER_VALUE);

/** press save in the edit sheet and wait for this save's answer (an earlier "saved" note may still be showing) */
async function saveEdit(page) {
  const answer = page.waitForResponse((r) => /\/api\/admin\/users\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH', { timeout: 15000 });
  await page.locator('[data-testid=edit-save]').click();
  const r = await answer;
  if (r.status() !== 200) throw new Error(`saving the account answered ${r.status()}: ${await r.text()}`);
  await page.locator('[data-testid=admin-edit-user] [role=status]').waitFor({ timeout: 10000 });
}

async function openTab(page, key) {
  await page.locator(`[data-testid=admin-tab-${key}]`).click();
  const ready = { users: 'admin-user-list', ai: 'ai-status', system: 'admin-services' }[key];
  await page.locator(`[data-testid=${ready}]`).waitFor({ timeout: 20000 });
}

/** wait for the AI status badge; on a timeout, say what it showed instead */
async function aiState(page, want) {
  try {
    await page.waitForFunction((w) => document.querySelector('[data-testid=ai-status]')?.getAttribute('data-state') === w, want, { timeout: 15000 });
  } catch {
    const got = await page.locator('[data-testid=ai-status]').getAttribute('data-state').catch(() => null);
    const bar = await page.locator('[data-testid=ai-save-bar]').innerText().catch(() => '');
    throw new Error(`AI status stayed ${got} (wanted ${want}); save bar: ${bar.replace(/\s+/g, ' ').slice(0, 200)}`);
  }
}

async function openMenu(page) {
  await page.locator('button[aria-haspopup=menu]').first().click();
  await page.locator('[role=menu]').waitFor({ timeout: 10000 });
}

async function denied(who, label) {
  const { ctx, page } = await loginAs(who, undefined, '/host');
  const u = await me(page);
  if (u?.role === 'admin') {
    check(false, `${label}: --maker-login must not be an admin`);
    await ctx.close();
    return;
  }
  await openMenu(page);
  check(!(await page.locator('[data-testid=nav-admin]').count()), `${label}: no ตั้งค่าระบบ link in the account menu`);
  await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
  await page.locator('[data-testid=admin-denied]').waitFor({ timeout: 15000 });
  check(true, `${label}: /admin says it is for admins only`);
  check(!(await page.locator('[data-testid=admin-user-list]').count()), `${label}: and shows no user list`);
  const calls = [
    ['/api/admin/users', 'GET'],
    ['/api/admin/overview', 'GET'],
    ['/api/admin/ai', 'GET'],
    ['/api/admin/ai', 'PUT', { apiKey: 'sk-must-not-save' }],
    ['/api/admin/users', 'POST', { username: 'never-made', name: 'never', password: 'generate' }],
    ['/api/admin/ai/test', 'POST', {}],
  ];
  const got = [];
  for (const [path, method, body] of calls) got.push((await api(page, path, method, body)).status);
  check(
    got.every((s) => s === 403),
    `${label}: every /api/admin call is refused with 403 (${got.join(', ')})`,
  );
  await ctx.close();
}

try {
  // ---------- signed out
  {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    watch(page, 'signed-out');
    await page.goto(`${WEB}/admin`, { waitUntil: 'networkidle' });
    await page.locator('[data-testid=admin-login]').waitFor({ timeout: 15000 });
    check(true, 'signed out: /admin asks to log in');
    check((await api(page, '/api/admin/users')).status === 401, 'signed out: /api/admin/users is 401');
    await ctx.close();
  }

  const { ctx, page } = await loginAs(ADMIN);
  const self = await me(page);
  if (self?.role !== 'admin') {
    check(false, `--login account is not an admin (role ${self?.role ?? 'none'})`);
    await ctx.close();
    if (MAKER) await denied(MAKER, 'maker');
    throw new Error('stop');
  }
  check(true, 'admin: logged in with role admin');
  await page.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
  await openMenu(page);
  await page.locator('[data-testid=nav-admin]').click();
  await page.waitForURL((u) => u.pathname.endsWith('/admin'), { timeout: 20000 });
  check(true, 'admin: ตั้งค่าระบบ in the account menu opens /admin');
  await page.locator('[data-testid=admin-user-list]').waitFor({ timeout: 20000 });
  check((await page.title()).includes('ตั้งค่าระบบ'), 'admin: the tab title says ตั้งค่าระบบ');

  // ---------- users: search finds me, my own row is locked
  await page.locator('[data-testid=admin-search]').fill(ADMIN.username);
  await page.waitForFunction((u) => [...document.querySelectorAll('[data-testid=admin-user-row]')].every((r) => r.dataset.user === u) && document.querySelector(`[data-testid=admin-user-row][data-user="${u}"]`), ADMIN.username, { timeout: 15000 });
  check(true, 'users: the search narrows the list to my account');
  await page.locator(`[data-testid=admin-user-row][data-user="${ADMIN.username}"]`).click();
  await page.locator('[data-testid=admin-edit-user]').waitFor();
  check(await page.locator('[data-testid=edit-role-maker]').isDisabled(), 'users: I can not demote myself');
  check(await page.locator('[data-testid=edit-enabled]').isDisabled(), 'users: I can not disable myself');
  await page.keyboard.press('Escape');
  await page.locator('[data-testid=admin-edit-user]').waitFor({ state: 'detached' });

  // ---------- how people log in here: the add sheet offers only what works (nothing is saved)
  const ways = JSON.parse((await api(page, '/api/admin/users')).text).login;
  check(typeof ways?.passwords === 'boolean' && typeof ways?.company === 'boolean', `users: the list says how people log in here (passwords ${ways?.passwords}, company login ${ways?.company})`);
  await page.locator('[data-testid=admin-add-user]').click();
  await page.locator('[data-testid=admin-add-sheet]').waitFor();
  check((await page.locator('[data-testid=add-how-generate]').count()) === (ways.passwords ? 1 : 0), 'add: a password is offered only where the site has a password form');
  await page.locator('[data-testid=add-how-none]').check();
  check((await page.locator('[data-testid=add-company-off]').count()) === (ways.company ? 0 : 1), 'add: company-only says so when company login is not set up yet');
  await page.keyboard.press('Escape');
  await page.locator('[data-testid=admin-add-sheet]').waitFor({ state: 'detached' });

  if (LOCAL) {
    // ---------- make an account
    const username = `e2e-made-${Date.now().toString(36)}`;
    const name = `ทดสอบหน้าแอดมิน ${username.slice(-4)}`;
    await page.locator('[data-testid=admin-search]').fill('');
    await page.locator('[data-testid=admin-add-user]').click();
    await page.locator('[data-testid=admin-add-sheet]').waitFor();
    await page.locator('[data-testid=add-username]').fill(username);
    await page.locator('[data-testid=add-name]').fill(name);
    await page.locator('[data-testid=add-role]').selectOption('maker');
    await page.locator('[data-testid=add-submit]').click();
    await page.locator('[data-testid=admin-user-made]').waitFor({ timeout: 20000 });
    const password = (await page.locator('[data-testid=secret-value]').innerText()).trim();
    check(/^[A-Za-z0-9]{16}$/.test(password), 'add: a 16-character password is shown once');
    await page.locator('[data-testid=made-close]').click();
    // (the search was cleared a moment before saving: the list must still end up showing everyone)
    await page.locator(`[data-testid=admin-user-row][data-user="${username}"]`).waitFor({ timeout: 10000 });
    check(true, 'add: the new account is in the list');

    // the new person logs in and keeps the session open
    const person = await loginAs({ username, password }, undefined, '/host');
    let u = await me(person.page);
    check(u?.role === 'maker' && u.can.share && u.can.pika && u.can.aiQuiz, 'add: the new account logs in as a maker with every feature on');

    // ---------- role and permissions
    const row = page.locator(`[data-testid=admin-user-row][data-user="${username}"]`);
    await row.click();
    await page.locator('[data-testid=admin-edit-user]').waitFor();
    check(await page.locator('[data-testid=edit-save]').isDisabled(), 'edit: save waits for a change');
    await page.locator('[data-testid=edit-role-curator]').check();
    for (const p of ['share', 'pika', 'aiQuiz']) await page.locator(`[data-testid=edit-perm-${p}]`).click();
    await saveEdit(page);
    check(true, 'edit: saved');
    await page.keyboard.press('Escape');
    check((await row.innerText()).includes('ปิดสิทธิ์ 3 อย่าง'), 'edit: the row shows the role and "ปิดสิทธิ์ 3 อย่าง"');

    u = await me(person.page);
    check(u?.role === 'curator' && !u.can.share && !u.can.pika && !u.can.aiQuiz, 'their open session sees the new role and permissions at once');
    const share = await api(person.page, '/api/catalog', 'POST', { gameId: 'aaaaaaaaaaaaaaaaaaaaaa' });
    check(share.status === 403 && share.text.includes('not_permitted'), 'sharing is refused (not_permitted)');
    check((await api(person.page, '/api/pika/project')).status === 403, 'the Pika API is refused');
    await person.page.goto(`${WEB}/pika`, { waitUntil: 'networkidle' });
    check((await person.page.locator('text=ผู้ดูแลระบบปิดสิทธิ์คลังความรู้สำหรับบัญชีนี้').count()) > 0, '/pika says the admin turned it off');
    await person.page.goto(`${WEB}/create`, { waitUntil: 'networkidle' });
    await person.page.locator('[data-testid=create-pika]').waitFor({ timeout: 15000 });
    check((await person.page.locator('[data-testid=create-pika]').innerText()).includes('ปิดสิทธิ์อยู่'), '/create marks Pika as turned off');
    check((await person.page.locator('[data-testid=create-ai]').innerText()).includes('ปิดสิทธิ์อยู่'), '/create marks AI quiz as turned off');
    await shoot(person.page, 'create-perms-off', true);

    // permissions back on, role back to maker
    await row.click();
    await page.locator('[data-testid=admin-edit-user]').waitFor();
    await page.locator('[data-testid=edit-role-maker]').check();
    for (const p of ['share', 'pika', 'aiQuiz']) await page.locator(`[data-testid=edit-perm-${p}]`).click();
    await saveEdit(page);
    u = await me(person.page);
    check(u?.role === 'maker' && u.can.share && u.can.pika && u.can.aiQuiz, 'turned back on: their session has everything again');

    // ---------- disable: logged out everywhere, and the login is refused
    await page.locator('[data-testid=edit-enabled]').click();
    await saveEdit(page);
    await page.keyboard.press('Escape');
    check((await row.innerText()).includes('ปิดใช้งาน'), 'disable: the row says ปิดใช้งาน');
    check((await me(person.page)) === null, 'disable: their session ended at once');
    {
      const r = await api(person.page, '/api/auth/login', 'POST', { username, password });
      check(r.status >= 400, `disable: logging in again is refused (${r.status})`);
    }

    // enabled again, then a new password
    await row.click();
    await page.locator('[data-testid=admin-edit-user]').waitFor();
    await page.locator('[data-testid=edit-enabled]').click();
    await saveEdit(page);
    await page.locator('[data-testid=reset-password]').click();
    await page.locator('[data-testid=confirm-action]').click();
    await page.locator('[data-testid=admin-edit-user] [data-testid=secret-value]').waitFor({ timeout: 15000 });
    const fresh = (await page.locator('[data-testid=admin-edit-user] [data-testid=secret-value]').innerText()).trim();
    check(/^[A-Za-z0-9]{16}$/.test(fresh) && fresh !== password, 'reset: a new password is shown once');
    await page.keyboard.press('Escape');
    {
      const old = await api(person.page, '/api/auth/login', 'POST', { username, password });
      check(old.status >= 400, 'reset: the old password no longer works');
      await person.ctx.close();
      const again = await loginAs({ username, password: fresh }, undefined, '/host');
      check((await me(again.page))?.id === u.id, 'reset: the new one does');
      await again.ctx.close();
    }
    // end: the account stays, disabled (this page never deletes anyone)
    await row.click();
    await page.locator('[data-testid=admin-edit-user]').waitFor();
    await page.locator('[data-testid=edit-enabled]').click();
    await saveEdit(page);
    await page.keyboard.press('Escape');

    // ---------- AI
    await new Promise((done) => provider.listen(0, '127.0.0.1', done));
    const providerUrl = `http://127.0.0.1:${provider.address().port}`;
    await openTab(page, 'ai');
    check((await page.locator('[data-testid=ai-status]').getAttribute('data-state')) === 'ยังไม่ตั้งค่า', 'ai: with no file, it says not set up yet');
    check(await page.locator('[data-testid=ai-test]').isDisabled(), 'ai: test waits for a key');
    await page.locator('[data-testid=ai-baseurl]').fill(providerUrl);
    await page.locator('[data-testid=ai-key]').fill(KEY);
    await page.locator('[data-testid=ai-model]').fill('claude-opus-5-5');
    await page.locator('[data-testid=ai-add-header]').click();
    await page.locator('[data-testid=ai-header-name]').last().fill('X-Project');
    await page.locator('[data-testid=ai-header-value]').last().fill(HEADER_VALUE);
    await page.locator('[data-testid=ai-per-person]').fill('25');
    await page.locator('[data-testid=ai-save-bar]').waitFor();
    check(await page.locator('[data-testid=ai-test]').isDisabled(), 'ai: test waits while there are unsaved changes');
    await shoot(page, 'ai-dirty', true);
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/admin/ai') && r.request().method() === 'PUT');
    await page.locator('[data-testid=ai-save]').click();
    const put = await saved;
    check(put.status() === 200 && noSecret(await put.text()), 'ai: saved, and the answer holds neither the key nor the header value');
    await aiState(page, 'ใช้งานอยู่');
    check(true, 'ai: live at once, no restart');
    const file = JSON.parse(readFileSync(AI_FILE, 'utf8'));
    check(file.apiKey === KEY && file.headers?.['X-Project'] === HEADER_VALUE && file.baseUrl === providerUrl && file.perPersonPerDay === 25, 'ai: the file on the server holds what was typed');

    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-testid=ai-status]').waitFor({ timeout: 20000 });
    check(new URL(page.url()).hash === '#ai', 'ai: a reload stays on the AI tab');
    check((await page.locator('[data-testid=ai-key]').inputValue()) === '', 'ai: after a reload the key box is empty');
    check(((await page.locator('[data-testid=ai-key]').getAttribute('placeholder')) ?? '').includes('ตั้งไว้แล้ว'), 'ai: and says a key is set');
    check((await page.locator('[data-testid=ai-header-value]').first().inputValue()) === '', 'ai: the header value is not shown back');
    check(noSecret(await page.content()), 'ai: neither secret is anywhere in the page');
    check(noSecret((await api(page, '/api/admin/ai')).text), 'ai: nor in GET /api/admin/ai');
    check(noSecret((await api(page, '/api/admin/overview')).text), 'ai: nor in the overview');

    await page.locator('[data-testid=ai-test]').click();
    await page.locator('[data-testid=ai-test-result]').waitFor({ timeout: 40000 });
    check((await page.locator('[data-testid=ai-test-result]').getAttribute('data-ok')) === 'true', 'ai: the connection test passes against the stand-in');
    await shoot(page, 'ai-tested', true);

    reply = { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${KEY} (project ${HEADER_VALUE})` } } };
    await page.locator('[data-testid=ai-test]').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=ai-test-result]')?.getAttribute('data-ok') === 'false', null, { timeout: 40000 });
    check(true, 'ai: a refused key shows as a failed test');
    check(noSecret(await page.content()), 'ai: and the error the provider echoed is shown without the key or header value');
    reply = null;

    // a blank key keeps the saved one: change only the model
    await page.locator('[data-testid=ai-model]').fill('claude-sonnet-5-5');
    await page.locator('[data-testid=ai-save]').click();
    // saved: the bar stays to say so, but nothing is left to save
    await page.locator('[data-testid=ai-save]').waitFor({ state: 'detached', timeout: 15000 });
    check((await page.locator('[data-testid=ai-save-bar]').innerText()).includes('บันทึกแล้ว'), 'ai: the bar says it was saved');
    const kept = JSON.parse(readFileSync(AI_FILE, 'utf8'));
    check(kept.apiKey === KEY && kept.headers?.['X-Project'] === HEADER_VALUE && kept.model === 'claude-sonnet-5-5', 'ai: saving with the key box empty keeps the key and the header value');

    // off and on again
    await page.locator('[data-testid=ai-enabled]').click();
    await page.locator('[data-testid=ai-save]').click();
    await aiState(page, 'ปิดอยู่');
    const offApi = JSON.parse((await api(page, '/api/exam-ai')).text);
    check(offApi.enabled === false, 'ai: turned off, exam mode stops offering AI');
    await page.locator('[data-testid=ai-enabled]').click();
    await page.locator('[data-testid=ai-save]').click();
    await aiState(page, 'ใช้งานอยู่');
    check(JSON.parse((await api(page, '/api/exam-ai')).text).enabled === true, 'ai: turned on again, it is back');

    // a bad address is refused next to the field, and nothing is written
    const before = readFileSync(AI_FILE, 'utf8');
    await page.locator('[data-testid=ai-baseurl]').fill('ftp://not-allowed.example.com');
    await page.locator('[data-testid=ai-save]').click();
    await sleep(800);
    check(readFileSync(AI_FILE, 'utf8') === before, 'ai: a bad gateway address is refused and the file is unchanged');
    check((await page.locator('[data-testid=ai-save-bar] [role=alert]').count()) > 0, 'ai: and the save bar says why');
    await page.reload({ waitUntil: 'networkidle' });

    // ---------- the system tab shows what was done
    await openTab(page, 'system');
    const changes = await page.locator('[data-testid=admin-changes]').innerText();
    check(changes.includes('บันทึกการตั้งค่า AI') && changes.includes('ตั้งรหัสผ่านใหม่') && changes.includes('ปิดบัญชี'), 'system: recent changes list the AI save, the new password and the disabling');
    check(changes.includes(name), 'system: by name, for the account changed');
  } else {
    // production: look only
    await openTab(page, 'ai');
    check(noSecret(await page.content()) && !/sk-ant-|pika_(live|org|test)_/.test(await page.content()), 'ai (look only): no key on the page');
    const aiApi = (await api(page, '/api/admin/ai')).text;
    check(!/"apiKey"\s*:|sk-ant-/.test(aiApi), 'ai (look only): GET /api/admin/ai has no key');
    await openTab(page, 'system');
    check((await page.locator('[data-testid=admin-services] li').count()) === 4, 'system (look only): four services listed');
    const sys = await page.locator('[data-testid=admin-services]').innerText();
    check(!/postgres(ql)?:\/\//.test(sys) && !/pika_(live|org|test)_/.test(sys), 'system (look only): no database address or Pika key shown');
  }

  // ---------- every tab at phone width, never wider than the screen
  for (const [label, viewport] of [
    ['desk', { width: 1280, height: 900 }],
    ['phone', { width: 390, height: 844 }],
  ]) {
    await page.setViewportSize(viewport);
    for (const tab of ['users', 'ai', 'system']) {
      await openTab(page, tab);
      await sleep(300);
      const o = await overflow(page);
      check(o <= 0, `${label} ${tab}: no sideways scroll (${o})`);
      await shoot(page, `${label}-${tab}`, true);
    }
  }
  // keys move between tabs
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-testid=admin-tab-system]').focus();
  await page.keyboard.press('Home');
  check((await page.locator('[data-testid=admin-tab-users]').getAttribute('aria-selected')) === 'true', 'tabs: Home goes to the first tab');
  await page.keyboard.press('ArrowLeft');
  check((await page.locator('[data-testid=admin-tab-system]').getAttribute('aria-selected')) === 'true', 'tabs: ArrowLeft wraps to the last');
  await ctx.close();

  if (MAKER) await denied(MAKER, 'maker');
  else console.log('note  no --maker-login: the refusal for makers was not checked');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 5).join(' | ')}` : ''}`);
} catch (e) {
  if (e?.message !== 'stop') {
    failed++;
    console.log(`FAIL  ${e?.stack ?? e}`);
  }
} finally {
  await browser.close();
  if (provider.listening) provider.close();
  if (LOCAL) rmSync(AI_FILE, { force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
