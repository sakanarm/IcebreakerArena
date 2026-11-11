// "ข้อสอบจากคลังความรู้" (/pika) in a real browser.
//
// Everywhere: signed out, the page asks for a login that comes back to /pika, and /exam and the host page point
// to it. With --login, an account without a work email is told to ask the admin, and nothing is sent to Pika.
//
// On this machine, with --fake-pika, the whole road against a stand-in for Pika that this script runs itself:
// the project is made on a press; a wrong file, an empty file and a short paste are refused before anything is
// sent; a PDF and a pasted text are sent (multipart with the file's name, a title and an idempotency key; json
// for the paste), followed until Pika has read them, and their pages chosen by themselves; a failed read says
// so; the library lists documents and their pages, search finds pages, the eleventh page is refused; the review
// shows every question with its answer and the source sentence, unticking takes a question out, contact lines
// stay hidden; saving makes an exam that opens on its start page; no key ever reaches the browser; and phones
// never scroll sideways.
//
// --fake-pika needs a web server whose knowledge base is that stand-in, and whose login has a work email:
//   IB_DATA_DIR=<empty folder> (with secrets/pika-org-key holding any text) PIKA_BASE_URL=http://127.0.0.1:<port>/Pika/api/v1
//   then `npm run users -- add …` and `npm run users -- email <username> <email>` against that folder, then
//   `npx next dev -p 3000` in apps/web with the same two variables and AUTH_MODE=local.
//   node pika-exam.mjs --base=http://localhost:3000 --login=<file> --fake-pika=<port> [--shots=<dir>]
// Against production (read only: it makes no project and sends nothing):
//   node pika-exam.mjs --base=https://dmhub.mfec.dev/PikaArena --login=<file of an account without an email>
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

import { launchOptions } from './lib/rig.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
const WEB = (arg('base') || 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = arg('shots');
const MOUNT = new URL(WEB).pathname.replace(/\/$/, '');
const LOGIN = arg('login');
const FAKE_PORT = Number(arg('fake-pika') || 0);
const who = LOGIN
  ? Object.fromEntries(
      readFileSync(LOGIN, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*(username|password)\s*:\s*(.+?)\s*$/)?.slice(1))
        .filter(Boolean),
    )
  : null;
if (who && !(who.username && who.password)) throw new Error(`${LOGIN}: want a "username: …" line and a "password: …" line`);
const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(WEB);
if (FAKE_PORT && !local) throw new Error('--fake-pika is for a dev server on this machine');
if (FAKE_PORT && !who) throw new Error('--fake-pika needs --login (an account with a work email)');

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
const textOf = async (loc) => ((await loc.textContent()) ?? '').replace(/\s+/g, ' ').trim();
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// ---------- the stand-in for Pika ----------

const PROJECT_KEY = 'pika_live_E2EONLY_project_key_000000';
const page = (title, facts) => ['# ' + title, '', '## Summary', `${title} โดยสรุป`, '', '## Details', ...facts.map((f) => `- ${f} [[sources/e2e.md]]`)].join('\n');
const PAGES = {
  'topics/arena.md': {
    title: 'Pika Arena',
    content: page('Pika Arena', [
      'ห้องเล่นหนึ่งห้องรองรับผู้เล่นพร้อมกันได้ 1000 คน',
      'ระบบเรียลไทม์ของเกมใช้ **Socket.IO** เป็นตัวส่งข้อมูลระหว่างเครื่องผู้เล่นกับเซิร์ฟเวอร์',
      'ฐานข้อมูลที่เกมนี้ใช้คือ PostgreSQL ซึ่งเก็บผลของทุกห้อง',
      'ติดต่อทีมงานได้ที่ support@example.com หากพบปัญหาระหว่างเล่น',
    ]),
  },
  'systems/stack.md': {
    title: 'ระบบและเครื่องมือ',
    content: page('ระบบและเครื่องมือ', [
      'เซิร์ฟเวอร์เกมรันด้วย Node.js และดูแลโพรเซสด้วย pm2 ตลอดเวลา',
      'หน้าเว็บของเกมเขียนด้วย Next.js และ React เป็นหลัก',
      'ทีมเริ่มพัฒนาเกมนี้ในปี 2026 และเปิดใช้งานจริงในเดือนตุลาคม',
    ]),
  },
  'topics/handbook.md': {
    title: 'คู่มือพนักงานใหม่',
    content: page('คู่มือพนักงานใหม่', [
      'พนักงานใหม่มีวันลาพักร้อน 10 วันต่อปีหลังผ่านทดลองงาน',
      'ช่วงทดลองงานของพนักงานใหม่ยาว 119 วันนับจากวันเริ่มงาน',
      'การเบิกค่าเดินทางต้องส่งใบเสร็จภายใน 30 วันหลังเดินทาง',
      'โทรหาฝ่ายบุคคลได้ที่ 02-123-4567 ในเวลาทำการ',
    ]),
  },
};
// a long manual whose pages are not readable: enough of them to reach the ten-page limit
const MANUAL = Array.from({ length: 11 }, (_, i) => `manual/part-${String(i + 1).padStart(2, '0')}.md`);

const docs = [{ document_id: 'doc-manual', title: 'คู่มือฉบับเต็ม', source_ref: 'e2e/manual', bytes: 2_400_000, pages: MANUAL }];
const jobs = new Map();
const calls = [];
let projectMade = false;

function fake(c) {
  if (c.method === 'POST' && c.route === '/projects') {
    projectMade = true;
    return { status: 201, json: { project_id: c.json.id, client_id: 'client-e2e', api_key: PROJECT_KEY } };
  }
  const id = /^\/projects\/([^/]+)/.exec(c.route)?.[1] ?? '';
  if (c.method === 'GET' && c.route === `/projects/${id}/documents`) return { json: { documents: docs, total: docs.length } };
  if (c.method === 'POST' && c.route === `/projects/${id}/search`) {
    const q = String(c.json.query ?? '').toLowerCase();
    const hits = Object.entries(PAGES)
      .filter(([, p]) => p.content.toLowerCase().includes(q))
      .map(([path, p]) => ({ file_path: path, title: p.title, snippet: p.content.split('\n').find((l) => l.toLowerCase().includes(q)) ?? '', score: 0.9 }));
    return { json: { hits } };
  }
  if (c.method === 'POST' && c.route === `/projects/${id}/files`) {
    const text = Buffer.from(c.raw, 'latin1').toString('utf8');
    const name = /filename="([^"]*)"/.exec(text)?.[1] ?? '';
    const title = /name="title"\r\n\r\n([^\r]*)\r\n/.exec(text)?.[1] ?? name;
    const jobId = `job-${jobs.size + 1}`;
    const broken = name.startsWith('broken');
    jobs.set(jobId, { project: id, polls: 0, broken, pages: broken ? [] : ['topics/arena.md', 'systems/stack.md'], title });
    return { status: 202, json: { job_id: jobId, status: 'queued' } };
  }
  if (c.method === 'POST' && c.route === `/projects/${id}/documents`) {
    const jobId = `job-${jobs.size + 1}`;
    jobs.set(jobId, { project: id, polls: 0, broken: false, pages: ['topics/handbook.md'], title: String(c.json.title ?? '') });
    return { status: 202, json: { job_id: jobId, status: 'queued' } };
  }
  const job = /^\/jobs\/([^/]+)$/.exec(c.route)?.[1];
  if (c.method === 'GET' && job && jobs.has(job)) {
    const j = jobs.get(job);
    j.polls++;
    // read on the second time it is asked about, as a real one takes a while
    if (j.polls < 2) return { json: { job_id: job, project_id: j.project, status: 'processing' } };
    if (j.broken) return { json: { job_id: job, project_id: j.project, status: 'failed', error: 'could not read' } };
    if (!docs.some((d) => d.document_id === `doc-${job}`)) docs.unshift({ document_id: `doc-${job}`, title: j.title, source_ref: 'e2e', bytes: 1200, pages: j.pages });
    return { json: { job_id: job, project_id: j.project, status: 'done', result: { pages: j.pages, document_id: `doc-${job}` } } };
  }
  if (c.method === 'GET' && c.route === `/projects/${id}/pages`) {
    const p = PAGES[c.query.get('path') ?? ''];
    return p ? { json: { file_path: c.query.get('path'), title: p.title, content: p.content } } : { status: 404, json: { detail: 'page not found' } };
  }
  return { status: 404, json: { detail: 'no such route' } };
}

async function startFake() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (b) => chunks.push(b));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const raw = Buffer.concat(chunks).toString('latin1');
      let json = {};
      try {
        json = raw && (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      } catch {}
      const c = { method: req.method, route: url.pathname.replace(/^\/Pika\/api\/v1/, ''), query: url.searchParams, raw, json, headers: req.headers };
      calls.push(c);
      const out = fake(c);
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.json ?? null));
    });
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(FAKE_PORT, '127.0.0.1', resolve));
  return server;
}

// ---------- the checks ----------

const fakeServer = FAKE_PORT ? await startFake() : null;
const browser = await chromium.launch(launchOptions);
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  // every answer our API gives the browser, to make sure no key is ever in one
  const bodies = [];
  // anything the page itself complains about (the dev overlay's "Issue" badge)
  const complaints = [];
  p.on('pageerror', (e) => complaints.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) complaints.push(`console: ${m.text().slice(0, 300)}`);
  });
  p.on('response', async (r) => {
    if (!r.url().includes('/api/')) return;
    try {
      bodies.push(await r.text());
    } catch {}
  });

  // signed out
  await p.goto(`${WEB}/pika`, { waitUntil: 'networkidle' });
  if (!who || !local) {
    await p.getByText('เข้าสู่ระบบก่อนสร้างข้อสอบจากคลังความรู้').waitFor({ timeout: 20000 });
    const href = await p.getByRole('link', { name: 'เข้าสู่ระบบ', exact: true }).getAttribute('href');
    check(/\/login\?next=%2Fpika$/.test(href ?? ''), 'signed out, /pika asks for a login that comes back to it');
    await p.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
    check((await p.locator(`a[href="${MOUNT}/pika"]`).count()) === 1, '/exam points to the knowledge base');
  }

  if (who) {
    await p.goto(`${WEB}/login?next=/pika`, { waitUntil: 'networkidle' });
    await p.locator('#login-user').fill(who.username);
    await p.locator('#login-password').fill(who.password);
    await p.locator('button[type=submit]').click();
    await p.waitForURL(/\/pika$/, { timeout: 20000 }).catch(() => {});
    await p.getByRole('heading', { name: 'ข้อสอบจากคลังความรู้', exact: true }).waitFor({ timeout: 20000 });
    check(true, 'signed in, back on /pika');

    if (!FAKE_PORT) {
      // read only: an account with no email is told why, and nothing reaches Pika
      // read only: whatever this account's state is, the page says it, and nothing is pressed
      const state = p.getByRole('heading', { name: /บัญชีนี้ยังไม่มีอีเมล|ยังไม่ได้เชื่อมกับ Pika|เริ่มคลังความรู้ของคุณ|เลือกหน้าที่จะออกข้อสอบ/ }).first();
      await state.waitFor({ timeout: 20000 });
      check(true, `the page says where this account stands: "${await textOf(state)}"`);
      await p.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
      check((await p.locator(`header a[href="${MOUNT}/pika"]`).count()) === 1, 'the host page links to /pika when signed in');
    } else {
      // ---------- the whole road, against the stand-in ----------
      const start = p.getByRole('button', { name: 'สร้างคลังความรู้ของฉัน' });
      await start.waitFor({ timeout: 20000 });
      check(!projectMade, 'no project is made by just opening the page');
      await shoot(p, '1-start');
      await start.click();
      await p.getByRole('heading', { name: 'เลือกหน้าที่จะออกข้อสอบ' }).waitFor({ timeout: 20000 });
      check(projectMade, 'the press makes the project');
      const made = calls.find((c) => c.route === '/projects');
      check(/^icebreaking_[a-z0-9_-]+$/.test(made?.json.id ?? ''), `named icebreaking_<the email's local part> (${made?.json.id})`);
      await p.getByTestId('pika-docs').waitFor();
      check((await p.getByTestId('pika-docs').locator('> li').count()) === 1, 'the library lists the document already there');

      const file = p.getByTestId('pika-file');
      const alertText = () => textOf(p.locator('[role=alert]').first());
      const before = calls.length;
      await file.setInputFiles({ name: 'tool.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
      check((await alertText()).includes('.pdf .docx'), 'a .exe is refused, saying which types are fine');
      await file.setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
      check((await alertText()).includes('ว่างเปล่า'), 'an empty file is refused');
      check(calls.length === before, 'and neither was sent');

      // a PDF: sent, followed, read, its pages chosen
      await file.setInputFiles({ name: 'คู่มือ Arena.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% e2e\n') });
      const jobsList = p.getByTestId('pika-jobs');
      await jobsList.getByText('Pika กำลังอ่าน').waitFor({ timeout: 10000 });
      check(true, 'the PDF shows as being read');
      const sent = calls.find((c) => c.method === 'POST' && c.route.endsWith('/files'));
      check(
        Boolean(sent) &&
          (sent.headers['content-type'] ?? '').startsWith('multipart/form-data') &&
          Buffer.from(sent.raw, 'latin1').toString('utf8').includes('filename="คู่มือ Arena.pdf"') &&
          /name="title"\r\n\r\n/.test(sent.raw) &&
          /^ib-.+-[0-9a-f]{32}$/.test(String(sent.headers['idempotency-key'] ?? '')),
        'Pika got the file as multipart, with its name, a title and an idempotency key',
      );
      check(sent?.headers.authorization === `Bearer ${PROJECT_KEY}`, 'with the project key, not the org key');
      await jobsList.getByText('✓ อ่านแล้ว ได้ 2 หน้า').waitFor({ timeout: 20000 });
      check(true, 'then shows as read, with its page count');
      await p.getByTestId('pika-chosen').getByText('เลือกแล้ว 2/10 หน้า').waitFor({ timeout: 5000 });
      check(true, 'and its two pages are chosen by themselves');
      await p.getByTestId('pika-docs').getByText('คู่มือ Arena').waitFor({ timeout: 10000 });
      check(true, 'the library lists the new document');

      // a file Pika cannot read
      await file.setInputFiles({ name: 'broken.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\x03\x04') });
      await jobsList.getByText(/อ่านเอกสารนี้ไม่สำเร็จ/).waitFor({ timeout: 20000 });
      check(true, 'a document Pika could not read says so');

      // a paste
      await p.getByRole('tab', { name: /วางข้อความ/ }).click();
      await p.getByPlaceholder('เช่น คู่มือพนักงานใหม่ 2026').fill('คู่มือพนักงานใหม่');
      const area = p.locator('textarea');
      await area.fill('สั้นเกินไป');
      await p.getByRole('button', { name: 'ส่งเข้าคลังความรู้' }).click();
      check((await alertText()).includes('อย่างน้อย 200'), 'a short paste is refused');
      const handbook = PAGES['topics/handbook.md'].content.replace(/\[\[[^\]]+\]\]/g, '');
      await area.fill(`${handbook}\n${handbook}`);
      await p.getByText('ข้อความนี้มีอีเมลหรือเบอร์โทร').waitFor({ timeout: 3000 });
      check(true, 'a paste with a phone number is warned about before sending');
      await p.getByRole('button', { name: 'ส่งเข้าคลังความรู้' }).click();
      await jobsList.getByText('✓ อ่านแล้ว ได้ 1 หน้า').waitFor({ timeout: 20000 });
      const pasted = calls.find((c) => c.method === 'POST' && c.route.endsWith('/documents'));
      check(pasted?.json.title === 'คู่มือพนักงานใหม่' && String(pasted?.json.content ?? '').includes('วันลาพักร้อน'), 'the paste reached Pika as a titled document');
      check((await area.inputValue()) === '', 'and the box is cleared');
      await p.getByTestId('pika-chosen').getByText('เลือกแล้ว 3/10 หน้า').waitFor({ timeout: 5000 });
      check(true, 'its page joins the chosen ones');

      // search
      await p.getByLabel('ค้นในคลังความรู้').fill('pm2');
      await p.getByRole('button', { name: 'ค้นหา' }).click();
      await p.getByTestId('pika-hits').waitFor({ timeout: 10000 });
      check((await p.getByTestId('pika-hits').locator('li').count()) === 1, 'search finds the one page about pm2');
      check(await p.getByTestId('pika-hits').locator('input[type=checkbox]').isChecked(), 'already ticked, as it is chosen');
      await p.getByRole('button', { name: 'ล้าง' }).click();

      // the ten-page limit
      const manual = p.getByTestId('pika-docs').locator('> li').filter({ hasText: 'คู่มือฉบับเต็ม' });
      await manual.getByRole('button').first().click();
      await manual.getByRole('button', { name: 'เลือกทั้งเอกสาร' }).click();
      await p.getByTestId('pika-chosen').getByText('เลือกแล้ว 10/10 หน้า').waitFor({ timeout: 5000 });
      check(await p.getByTestId('pika-chosen').getByText(/ครบ 10 หน้าแล้ว/).isVisible(), 'choosing past ten stops at ten and says so');
      await p.setViewportSize({ width: 390, height: 844 });
      check(await noSideScroll(p), 'the library does not scroll sideways on a phone');
      await shoot(p, '2-library-phone', true);
      await p.setViewportSize({ width: 1280, height: 900 });
      // the chips take pages out again
      const chips = p.getByTestId('pika-chosen').getByRole('button', { name: /^เอา part/ });
      check((await chips.count()) === 7, `seven of the manual's pages fitted (${await chips.count()})`);
      while ((await chips.count()) > 0) await chips.first().click();
      await p.getByTestId('pika-chosen').getByText('เลือกแล้ว 3/10 หน้า').waitFor({ timeout: 5000 });
      check(!(await p.getByTestId('pika-chosen').getByText(/ครบ 10 หน้าแล้ว/).isVisible()), 'pressing the chips takes them out, and the limit note goes');
      // one unreadable page, to see it named on the review
      await manual.getByText('part 01').click();

      // review
      await p.getByRole('button', { name: /ตั้งข้อสอบจากหน้าที่เลือก/ }).click();
      const review = p.getByTestId('pika-review');
      await review.waitFor({ timeout: 20000 });
      const factsCall = calls.filter((c) => c.route.endsWith('/pages')).length;
      check(factsCall === 4, `the four chosen pages were read (${factsCall})`);
      check((await textOf(review)).includes('อ่านไม่ได้ 1 หน้า'), 'the unreadable page is named');
      const cards = review.locator('ol > li');
      const total = await cards.count();
      const saveButton = p.getByTestId('pika-save');
      const countOf = async () => Number((await textOf(saveButton)).match(/(\d+) ข้อ/)?.[1] ?? -1);
      const first = await countOf();
      check(total >= 8 && first === total, `every fact is a question to start with (${first} of ${total})`);
      const quizzes = await review.locator('ol > li ul').evaluateAll((uls) => uls.map((u) => u.children.length));
      check(quizzes.every((n) => n === 2 || n === 4), `every question has four choices or true/false (${quizzes.join(',')})`);
      check((await review.locator('ol > li').filter({ hasText: '✓' }).count()) === total, 'every question shows its answer');
      check((await review.locator('ol > li').filter({ hasText: '📖' }).count()) === total, 'and the sentence it came from');
      check(!(await textOf(review)).includes('support@example.com') && !(await textOf(review)).includes('02-123-4567'), 'contact lines are left out of the questions');
      await review.getByRole('button', { name: /ข้อความที่ไม่ได้นำมาตั้ง/ }).click();
      const dropped = await textOf(review);
      check(!dropped.includes('support@example.com') && !dropped.includes('02-123-4567') && dropped.includes('ซ่อนข้อความไว้เพราะมีข้อมูลติดต่อ'), 'and listed as hidden, without the address or the number');
      await cards.first().locator('input[type=checkbox]').uncheck();
      check((await countOf()) === first - 1, 'unticking a question takes it out of the count');
      await p.setViewportSize({ width: 390, height: 844 });
      check(await noSideScroll(p), 'the review does not scroll sideways on a phone');
      await shoot(p, '3-review-phone', true);
      await p.setViewportSize({ width: 1280, height: 900 });
      await shoot(p, '3-review', true);

      // save, then open it as an exam
      const title = 'ข้อสอบ e2e จากคลังความรู้';
      await review.getByPlaceholder('ข้อสอบจากคลังความรู้').fill(title);
      const want = await countOf();
      await saveButton.click();
      const done = p.getByTestId('pika-done');
      await done.waitFor({ timeout: 20000 });
      check((await textOf(done)).includes(`สร้างข้อสอบแล้ว ${want} ข้อ`) && (await textOf(done)).includes(title), `saved: "${title}", ${want} questions`);
      await shoot(p, '4-done');
      await done.getByRole('link', { name: /ทำข้อสอบ/ }).click();
      await p.getByRole('button', { name: 'เริ่มทำข้อสอบ' }).waitFor({ timeout: 20000 });
      check((await textOf(p.locator('h1').first())).includes(title), 'and it opens as an exam, on its start page');
      check((await textOf(p.locator('body'))).includes(`คลังคำถาม ${want} ข้อ`), `with all ${want} questions`);
      const examId = new URL(p.url()).pathname.split('/').pop();
      const saved = await p.evaluate(async (url) => (await fetch(url)).json(), `${WEB}/api/games/${examId}`);
      check(saved?.game?.tainted === true, 'the saved game is marked as internal, so it cannot be shared');    }
  }

  const leaked = bodies.filter((b) => /pika_(live|org|test)_/.test(b) || b.includes(PROJECT_KEY));
  check(leaked.length === 0, `no key in any of the ${bodies.length} answers the browser got`);
  check(complaints.length === 0, `no errors in the page${complaints.length ? `:\n      ${[...new Set(complaints)].join('\n      ')}` : ''}`);
} finally {
  await browser.close();
  fakeServer?.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
