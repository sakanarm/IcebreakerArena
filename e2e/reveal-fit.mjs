// The reveal of a quiz, a poll and a true/false (bars beside the stats card) at every width from a phone to a
// projector, upright tablets most of all: the bars and the card inside the scene's side margins, the bars no thinner
// than their shapes, each count centred over its bar. Then again with the widest numbers a room can show (1,000
// players, a 120-second average), written into the page. Pictures and every rect in reveal-fit-<out>/.
//   node reveal-fit.mjs [base url, default local dev] [--out=after] [--only=640,744]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { require, launchOptions } from './lib/rig.mjs';
const { io } = require('socket.io-client');

const WEB = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const NAME = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'after';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const MOUNT = new URL(WEB).pathname.replace(/\/$/, '');
const GAME_AT = WEB === 'http://localhost:3000' ? { url: 'http://localhost:4000', path: '/socket.io' } : { url: new URL(WEB).origin, path: `${MOUNT}/socket.io` };
const OUT = fileURLToPath(new URL(`./reveal-fit-${NAME}/`, import.meta.url));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const tag = Date.now().toString(36).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = () => io(GAME_AT.url, { path: GAME_AT.path, transports: ['websocket'], forceNew: true, reconnection: false });
let failed = 0;
let passed = 0;
const check = (ok, what) => (ok ? passed++ : (console.log('FAIL', what), failed++), ok);

const GAME = {
  id: `fit-${tag}`,
  title: `จอเฉลย ${tag}`,
  rounds: [
    {
      id: 'r1',
      title: 'รอบเดียว',
      questions: [
        { id: 'q1', type: 'quiz', prompt: 'ออฟฟิศใหม่ของเราอยู่ชั้นไหนของอาคาร', options: ['ชั้น 12', 'ชั้น 15', 'ชั้น 18', 'ชั้น 21'], correct: [1], timeLimitS: 30 },
        { id: 'q2', type: 'poll', prompt: 'มื้อเที่ยงวันศุกร์นี้ อยากกินอะไรกันดี', options: ['ส้มตำ', 'ข้าวมันไก่', 'ชาบู', 'สลัด'], correct: [], timeLimitS: 30 },
        { id: 'q3', type: 'truefalse', prompt: 'ทีมเราไปเที่ยวทะเลด้วยกันเมื่อปีที่แล้ว', options: ['จริง', 'เท็จ'], correct: [0], timeLimitS: 30 },
      ],
    },
  ],
};
const PLAYERS = 6;
// bot k is right when k % 3 != 0; the poll's votes go round all four
const RIGHT = { quiz: 1, truefalse: 0 };
const TILES = { quiz: 4, truefalse: 2 };
const answerFor = (q, k) => ({ choice: q.type === 'poll' ? k % 4 : k % 3 ? RIGHT[q.type] : (RIGHT[q.type] + 1) % TILES[q.type] });

// [name, page, width, height, touch]
const VIEWS = [
  ['host 360', 'host', 360, 740, true],
  ['host 390', 'host', 390, 844, true],
  ['host 412', 'host', 412, 915, true],
  ['host 600', 'host', 600, 960, true],
  ['host 640', 'host', 640, 960, true],
  ['host 700', 'host', 700, 1000, true],
  ['host 744', 'host', 744, 1133, true],
  ['stage 744', 'stage', 744, 1133, true],
  ['host 768', 'host', 768, 1024, true],
  ['stage 768', 'stage', 768, 1024, true],
  ['host 800', 'host', 800, 1280, true],
  ['host 820', 'host', 820, 1180, true],
  ['host 834', 'host', 834, 1194, true],
  ['host 912', 'host', 912, 1368, true],
  ['host 1024', 'host', 1024, 768, true],
  ['host 1024 upright', 'host', 1024, 1366, true],
  ['host 740 side', 'host', 740, 360, true],
  ['host 844 side', 'host', 844, 390, true],
  ['host 915 side', 'host', 915, 412, true],
  ['host 1280', 'host', 1280, 800, false],
  ['host laptop', 'host', 1366, 657, false],
  ['host 1536', 'host', 1536, 730, false],
  ['host 1080p', 'host', 1920, 905, false],
  ['stage 720p', 'stage', 1280, 720, false],
  ['stage 1080p', 'stage', 1920, 1080, false],
].filter((v) => !ONLY || ONLY.some((w) => v[0].includes(w)));

/** where the bars, their counts and the card are, against the scene's side margins */
const measure = () => {
  const main = document.querySelector('main');
  const c = getComputedStyle(main);
  const m = main.getBoundingClientRect();
  const lo = m.left + parseFloat(c.paddingLeft);
  const hi = m.right - parseFloat(c.paddingRight);
  const bars = main.querySelector('[role=img]');
  const card = bars.nextElementSibling;
  const b = bars.getBoundingClientRect();
  const k = card.getBoundingClientRect();
  const r1 = (x) => Math.round(x * 10) / 10;
  const cols = [...bars.children].map((col) => {
    const r = col.getBoundingClientRect();
    const count = col.querySelector(':scope > div.relative > span');
    const range = document.createRange();
    range.selectNodeContents(count);
    const t = range.getBoundingClientRect();
    const label = col.lastElementChild;
    return { left: r1(r.left), w: r1(r.width), text: count.textContent, tw: r1(t.width), tl: r1(t.left), tr: r1(t.right), off: r1((t.left + t.right) / 2 - (r.left + r.right) / 2), fits: label.scrollWidth <= label.clientWidth + 0.5 };
  });
  // a count hanging over its bar's sides is still on the screen, not cut off at main's edge, and clear of the next
  // bar's count (at HEAD a phone read "1,0002")
  const cut = cols.some((c) => c.tl < m.left - 0.5 || c.tr > m.right + 0.5);
  const apart = cols.every((c, i) => i === 0 || cols[i - 1].tr <= c.tl + 0.5);
  // the card's lines, each on one line: a wrap puts part of a line a whole line lower. Only the narrow card a phone
  // held upright has beside its bars may wrap them, and there every line still keeps inside the card's padding
  const narrow = !matchMedia('(min-width: 40rem)').matches && !matchMedia('(max-height: 500px)').matches;
  const kc = getComputedStyle(card);
  const [kl, kr] = [k.left + parseFloat(kc.paddingLeft) - 0.5, k.right - parseFloat(kc.paddingRight) + 0.5];
  const lines = [...card.querySelectorAll(':scope > div, :scope > div > div')]
    .filter((el) => el.textContent.trim() && (!el.children.length || el.matches('.font-display, .text-white\\/80')))
    .map((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((q) => q.width > 1);
      const mids = rects.map((q) => (q.top + q.bottom) / 2);
      const wraps = Math.max(...mids) - Math.min(...mids) > 0.6 * parseFloat(getComputedStyle(el).fontSize);
      const inside = rects.every((q) => q.left >= kl && q.right <= kr);
      return { text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 30), wraps, inside };
    });
  const scrolls = main.scrollHeight - main.clientHeight;
  return {
    vw: innerWidth,
    lo: r1(lo),
    hi: r1(hi),
    bars: [r1(b.left), r1(b.right)],
    card: [r1(k.left), r1(k.right), r1(k.top), r1(k.bottom)],
    barsTop: r1(b.top),
    barsH: r1(b.height),
    into: r1(Math.max(0, lo - Math.min(b.left, k.left), Math.max(b.right, k.right) - hi)),
    gap: r1(k.left - b.right),
    cols,
    cut,
    apart,
    narrow,
    lines,
    scrolls,
  };
};

/** the widest numbers a room shows: 1,000 on the tallest bar, 1,000 / 1,000 on the card, and a 120-second average */
const worst = () => {
  const bars = document.querySelector('main [role=img]');
  const card = bars.nextElementSibling;
  const texts = (el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const all = [];
    for (let n; (n = w.nextNode()); ) all.push(n);
    return all;
  };
  for (const n of texts(card.querySelector('.font-display'))) n.textContent = n.textContent.replace(/\d[\d,]*/g, '1,000');
  const line = card.querySelector('.text-white\\/80');
  if (line)
    for (const n of texts(line)) {
      if (/^\d+$/.test(n.textContent)) n.textContent = '100';
      if (/วิ$/.test(n.textContent)) n.textContent = '120.0 วิ';
    }
  const counts = [...bars.querySelectorAll(':scope > div > div.relative > span')];
  const top = counts.reduce((a, s) => (parseFloat(s.style.bottom) > parseFloat(a.style.bottom) ? s : a));
  top.textContent = '1,000';
};

const browser = await chromium.launch({ ...launchOptions });
const host = connect();
let S = null;
host.on('stage:state', (s) => (S = s));
const created = await host.timeout(10000).emitWithAck('host:create', { game: GAME });
if (!created.ok) throw new Error(`host:create: ${created.error}`);
const { pin, hostToken, stageToken } = created;
console.log(`PIN ${pin} on ${WEB}`);
const until = async (fn, what, ms = 45000) => {
  const end = Date.now() + ms;
  while (!(S && fn(S))) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what} (phase ${S?.phase})`);
    await sleep(40);
  }
};
// server clock minus ours, as the player app works it out, so the bots answer once a question opens by the server's clock
let skew = 0;
{
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const sent = Date.now();
    const at = await host.timeout(5000).emitWithAck('time:sync');
    const rtt = Date.now() - sent;
    if (rtt < best) [best, skew] = [rtt, at - (sent + rtt / 2)];
  }
}
const bots = [];
const refused = [];
for (let k = 0; k < PLAYERS; k++) {
  const s = connect();
  const done = new Set();
  s.on('player:state', (st) => {
    const q = st.question;
    if (st.phase !== 'question' || !q || done.has(q.id)) return;
    done.add(q.id);
    const wait = Math.max(0, q.startsAt - (Date.now() + skew)) + 300 + k * 100;
    setTimeout(() => s.emit('player:answer', { questionId: q.id, ...answerFor(q, k) }, (res) => res?.ok || refused.push(`bot ${k} q${q.number}: ${res?.error}`)), wait);
  });
  const j = await s.timeout(10000).emitWithAck('player:join', { pin, nickname: `ผู้เล่น ${k + 1}`, avatar: '🦊' });
  if (!j.ok) throw new Error(`join: ${j.error}`);
  bots.push(s);
}
await until((s) => s.playerCount === PLAYERS, 'players');
const errors = [];
const results = {};
try {
  // the lobby → the round's title, which goes on to the first question by itself; after that only a reveal and a
  // leaderboard wait for the Host. Each press names the step it was made on, so it never lands on the next screen
  host.emit('host:next', S.step);
  for (let seen = 0; seen < GAME.rounds[0].questions.length; ) {
    await until((s) => ['reveal', 'leaderboard', 'podium'].includes(s.phase), 'a reveal or a leaderboard');
    if (S.phase === 'podium') throw new Error(`the podium after ${seen} reveals`);
    const was = `${S.phase}:${S.question?.id}`;
    if (S.phase === 'leaderboard') {
      host.emit('host:next', S.step);
      await until((s) => `${s.phase}:${s.question?.id}` !== was, `leaving ${was}`);
      continue;
    }
    seen++;
    const q = S.question;
    const qid = `q${q.number}`;
    for (const [name, kind, width, height, touch] of VIEWS) {
      if (`${S.phase}:${S.question?.id}` !== was) throw new Error(`the reveal of ${qid} went on to ${S.phase} by itself`);
      const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width, height }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, reducedMotion: 'reduce' });
      if (kind === 'host') await ctx.addInitScript(({ k, t }) => localStorage.setItem(k, t), { k: `ib.host.${pin}`, t: JSON.stringify(hostToken) });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e}`));
      page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
      await page.goto(`${WEB}/${kind}/${pin}${kind === 'stage' ? `#${stageToken}` : ''}`);
      await page.locator('main [role=img]').waitFor({ timeout: 20000 });
      await sleep(2200);
      const file = `${OUT}${qid}-${q.type}-${name.replace(/\W+/g, '_')}`;
      const real = await page.evaluate(measure);
      await page.screenshot({ path: `${file}.png` });
      await page.evaluate(worst);
      await sleep(100);
      const wide = await page.evaluate(measure);
      await page.screenshot({ path: `${file}-worst.png` });
      results[`${qid} ${name}`] = { real, wide };
      for (const [what, m] of [['', real], [' (widest numbers)', wide]]) {
        const at = `${qid}-${q.type} ${name}${what}`;
        check(m.into <= 0.5, `${at}: inside the side margins ${m.lo}..${m.hi} (bars ${m.bars.join('..')}, card ${m.card[0]}..${m.card[1]})`);
        check(m.cols.every((c) => c.fits), `${at}: every bar's shape and ✓ fit it (${m.cols.map((c) => c.w).join(', ')} px)`);
        check(m.cols.every((c) => Math.abs(c.off) <= 1), `${at}: every count centred on its bar (${m.cols.map((c) => c.off).join(', ')})`);
        check(!m.cut, `${at}: every count on the screen (${m.cols.map((c) => `${c.tl}..${c.tr}`).join(', ')})`);
        check(m.apart, `${at}: no count over the next one (${m.cols.map((c) => `${c.text} ${c.tl}..${c.tr}`).join(', ')})`);
        if (!m.narrow) check(!m.lines.some((l) => l.wraps), `${at}: the card's lines each on one line (${m.lines.filter((l) => l.wraps).map((l) => l.text).join(' | ')})`);
        check(m.lines.every((l) => l.inside), `${at}: the card's lines inside it (${m.lines.filter((l) => !l.inside).map((l) => l.text).join(' | ')})`);
      }
      console.log(
        `${qid} ${name.padEnd(17)} bars ${real.cols.map((c) => c.w).join('/')} card ${Math.round(real.card[1] - real.card[0])} gap ${real.gap} into ${real.into}` +
          ` | widest: bars ${wide.cols.map((c) => c.w).join('/')} card ${Math.round(wide.card[1] - wide.card[0])} into ${wide.into}`,
      );
      await ctx.close();
    }
    host.emit('host:next', S.step);
    await until((s) => `${s.phase}:${s.question?.id}` !== was, `leaving ${was}`);
  }
} catch (e) {
  check(false, `the game ran through: ${e.message}`);
}
check(!refused.length, `every bot's answer taken${refused.length ? `: ${refused.join(', ')}` : ''}`);
writeFileSync(`${OUT}rects.json`, JSON.stringify(results, null, 1));
await host.timeout(10000).emitWithAck('host:close', { pin, hostToken }).catch(() => {});
for (const b of bots) b.close();
host.close();
await browser.close();
check(!errors.length, `no console or page errors${errors.length ? `\n  ${errors.slice(0, 12).join('\n  ')}` : ''}`);
console.log(`pictures and rects in ${OUT}`);
console.log(`${passed} passed`);
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
