// Slider reveal at many widths, through a real room: four slider questions (short, wide, billion-scale, percent),
// each answered by bots, then measured on the reveal screen. Checks that every number fits its room, nothing
// clashes, and nothing sits under the Host's dock or the stats card.
//   node slider-fit.mjs [--only=<view name substring>] [--base=http://localhost:3000] [--players=40] [--batch=4]
// The views are played in batches, each batch its own room: more pages open at once than the machine has cores
// starves them, and a starved page measures the wrong moment (see README).
import { chromium } from 'playwright-core';

import { require, launchOptions } from './lib/rig.mjs';
const WEB = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000').replace(/\/$/, '');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '';
const PLAYERS = Number(process.argv.find((a) => a.startsWith('--players='))?.slice(10) ?? 40);
const BATCH = Math.max(1, Number(process.argv.find((a) => a.startsWith('--batch='))?.slice(8) ?? 4));
const { io } = require('socket.io-client');
// the game server: the dev port 4000 unless the base is a prod-style address (socket.io sits under the same mount)
const DEV = new URL(WEB).port === '3000';
const MOUNT = DEV ? '' : new URL(WEB).pathname.replace(/\/$/, '');
const ORIGIN = DEV ? 'http://localhost:4000' : new URL(WEB).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWS = [
  ['host 390', 'host', 390, 844, true],
  ['stage 390', 'stage', 390, 844, true],
  ['host 360', 'host', 360, 740, true],
  ['host 640', 'host', 640, 960, true],
  ['host 744', 'host', 744, 1133, true],
  ['host 768', 'host', 768, 1024, true],
  ['stage landscape 844', 'stage', 844, 390, true],
  ['host landscape 844', 'host', 844, 390, true],
  ['host landscape 740', 'host', 740, 360, true],
  ['host landscape 640', 'host', 640, 360, true],
  ['host laptop 1366', 'host', 1366, 657, false],
  ['host 1536', 'host', 1536, 730, false],
  ['host 1600', 'host', 1600, 900, false],
  ['host 1080p', 'host', 1920, 905, false],
  ['stage 720p', 'stage', 1280, 720, false],
  ['stage 1080p', 'stage', 1920, 1080, false],
].filter(([name]) => name.includes(ONLY));

const GAMES = [
  { id: 'q1', prompt: 'ยอดดอยอินทนนท์สูงกี่เมตร', slider: { min: 0, max: 4000, step: 5, answer: 2565, margin: 150, unit: 'เมตร' } },
  { id: 'q2', prompt: 'ค่าที่ยาวที่สุดในจักรวาล', slider: { min: -1e9, max: 1e9, step: 200000, answer: -1e9, margin: 1e9, unit: 'หน่วยที่ยาวที่สุดนะค' } },
  { id: 'q3', prompt: 'ตัวเลขหลักพันล้าน', slider: { min: -1e9, max: 1e9, step: 200000, answer: 1e9, margin: 0 } },
  { id: 'q4', prompt: 'คะแนนความรู้', slider: { min: 0, max: 100, step: 1, answer: 50, margin: 5, unit: 'คะแนน' } },
];
const game = (tag) => ({
  id: `slider-${tag}`,
  title: `slider fit ${tag}`,
  rounds: [{ id: 'r1', title: 'รอบเดียว', questions: GAMES.map((g) => ({ id: g.id, type: 'slider', prompt: g.prompt, options: [], correct: [], timeLimitS: 20, slider: g.slider })) }],
});

// the answer for bot k: sometimes right on the answer, sometimes spread across the scale
const guess = (g, k) => {
  const s = g.slider;
  if (k % 10 === 0) return s.answer;
  if (k % 10 === 1) return s.min;
  if (k % 10 === 2) return s.max;
  const span = s.max - s.min;
  const v = s.min + span * ((k * 37) % 100) / 100;
  return Math.round(v / s.step) * s.step + (s.min % s.step);
};

// the page measurements, run in the browser once a reveal is on screen
const measure = (prompt) => {
  const vw = innerWidth;
  const R = (r) => `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  const out = [];
  const col = document.querySelector('[role="img"][aria-label^="เฉลย"]')?.parentElement;
  if (!col) return { out: ['no reveal on screen'] };
  if (!document.body.innerText.includes(prompt)) return { out: [`reveal of another question on screen`] };
  const card = col.nextElementSibling;
  const dock = document.querySelector('.btn.btn-gold')?.closest('.fixed');
  const dockTop = dock ? dock.getBoundingClientRect().top : innerHeight;
  // every text rect in the column and the card, reported as the box it is drawn in. A line the layout cuts off (a
  // unit kept to one line on a phone on its side) still has a rect where it would have gone, so each rect is cut
  // down to the boxes that cut it off and dropped when nothing of it is left to see. A box that scrolls is not one
  // of those: what is past its edge is still there to read, which is the very thing these checks are about
  const clip = (node) => {
    const box = { l: -Infinity, r: Infinity, t: -Infinity, b: Infinity };
    for (let el = node.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const e = el.getBoundingClientRect();
      // each way on its own: the scene cuts off what is beside it but lets what is under it be scrolled to
      if (/hidden|clip/.test(cs.overflowX)) box.l = Math.max(box.l, e.left), box.r = Math.min(box.r, e.right);
      if (/hidden|clip/.test(cs.overflowY)) box.t = Math.max(box.t, e.top), box.b = Math.min(box.b, e.bottom);
    }
    return box;
  };
  const texts = [];
  for (const root of [col, card].filter(Boolean)) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange();
      r.selectNodeContents(n);
      const box = clip(n);
      for (const q of r.getClientRects()) {
        const [l, rr, t, b] = [Math.max(q.left, box.l), Math.min(q.right, box.r), Math.max(q.top, box.t), Math.min(q.bottom, box.b)];
        if (rr - l > 1 && b - t > 1) texts.push({ text: n.textContent.trim().slice(0, 24), l, r: rr, t, b });
      }
    }
  }
  for (const t of texts) {
    if (t.r > vw + 0.5 || t.l < -0.5) out.push(`sideways "${t.text}" ${Math.round(t.l)}..${Math.round(t.r)} of ${vw}`);
    if (t.b > dockTop + 0.5 && t.t < innerHeight) out.push(`under the dock "${t.text}" bottom ${Math.round(t.b)} > dock ${Math.round(dockTop)}`);
    if (t.b > innerHeight + 0.5) out.push(`below the screen "${t.text}" bottom ${Math.round(t.b)} > ${innerHeight}`);
  }
  // the answer pill, the ends and the counts: none wider than its box
  const sized = (sel) => [...col.querySelectorAll(sel)].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => `${sel} overflows: ${el.scrollWidth} in ${el.clientWidth}`);
  out.push(...sized('[class*="rounded-2xl"]'));
  const counts = [...col.querySelectorAll('span.font-display')].filter((el) => el.textContent.trim());
  for (let i = 1; i < counts.length; i++) {
    const a = counts[i - 1].getBoundingClientRect();
    const b = counts[i].getBoundingClientRect();
    if (a.right > b.left + 1 && Math.abs(a.top - b.top) < a.height) out.push(`counts clash: "${counts[i - 1].textContent}" and "${counts[i].textContent}"`);
  }
  // the card's own lines: each must stay on one line, its words kept
  return { out, texts: texts.length, dockTop: Math.round(dockTop), vw, ih: innerHeight, card: card ? R(card.getBoundingClientRect()) : 'none', col: R(col.getBoundingClientRect()) };
};

// One room, played from the lobby to the last reveal, watched by this batch of views.
// Returns what was measured; anything that goes wrong on the way throws with the room's own state in the message.
async function playBatch(browser, views, tag) {
  const host = io(ORIGIN, { path: `${MOUNT}/socket.io`, transports: ['websocket'], forceNew: true, reconnectionAttempts: 20 });
  let S = null;
  let room = null;
  let drops = 0;
  let closing = false;
  host.on('stage:state', (s) => { if (!S || S.phase !== s.phase || S.question?.id !== s.question?.id) console.log('  phase', s.phase, s.question?.id ?? '', s.step); S = s; });
  // a machine with every core busy can starve this process long enough to lose the socket: come back and say so,
  // instead of pressing at a room that is no longer listening and blaming the screen it was left on
  host.on('disconnect', (why) => { if (closing) return; drops++; console.log(`  the Host's socket dropped (${why})`); });
  host.on('connect', () => { if (room) host.emit('host:attach', { pin: room.pin, hostToken: room.hostToken }); });
  const where = () => `phase ${S?.phase}${S?.question ? ` of q${S.question.number}` : ''}, step ${S?.step}, host ${host.connected ? 'connected' : 'dropped'}${drops ? `, ${drops} drop(s)` : ''}`;
  const until = async (fn, what, ms = 40000) => {
    const end = Date.now() + ms;
    while (!(S && fn(S))) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what} (${where()})`);
      await sleep(40);
    }
  };

  const created = await host.timeout(10000).emitWithAck('host:create', { game: game(tag) });
  if (!created.ok) throw new Error(`create: ${created.error}`);
  const { pin, hostToken, stageToken } = created;
  room = { pin, hostToken };
  console.log(`room ${pin} on ${WEB}`);
  const bots = [];
  const pages = [];
  const fails = [];
  const refused = [];
  let checks = 0;
  try {
    let skew = 0;
    for (let i = 0, best = Infinity; i < 5; i++) {
      const sent = Date.now();
      const at = await host.timeout(5000).emitWithAck('time:sync');
      const rtt = Date.now() - sent;
      if (rtt < best) [best, skew] = [rtt, at - (sent + rtt / 2)];
    }
    for (let k = 0; k < PLAYERS; k++) {
      const s = io(ORIGIN, { path: `${MOUNT}/socket.io`, transports: ['websocket'], forceNew: true, reconnection: false });
      s.on('player:state', (st) => {
        const q = st.question;
        if (st.phase !== 'question' || !q || s.seen === q.id) return;
        s.seen = q.id;
        const g = GAMES[q.number - 1];
        setTimeout(() => {
          s.emit('player:answer', { questionId: q.id, value: guess(g, k) }, (r) => {
            // a reveal drawn from answers the room never took is no test of anything
            if (r && !r.ok) refused.push(`${q.id} bot ${k + 1}: ${r.error}`);
          });
        }, Math.max(0, q.startsAt - (Date.now() + skew)) + 200 + k * 5);
      });
      const j = await s.timeout(15000).emitWithAck('player:join', { pin, nickname: `ทดสอบ ${k + 1}`, avatar: '🦊' });
      if (!j.ok) throw new Error(`join ${k}: ${j.error}`);
      bots.push(s);
    }
    await until((s) => s.playerCount === PLAYERS, `all ${PLAYERS} players in the lobby`);

    for (const [name, kind, width, height, phone] of views) {
      const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width, height }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
      await ctx.addInitScript(([pinNow, token]) => {
        try {
          localStorage.setItem(`ib.host.${pinNow}`, JSON.stringify(token));
        } catch {}
      }, [pin, hostToken]);
      const page = await ctx.newPage();
      await page.goto(kind === 'stage' ? `${WEB}/stage/${pin}#${stageToken}` : `${WEB}/host/${pin}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      // the real typeface, not the stand-in the browser draws until the page's own Thai fonts arrive
      await page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
      pages.push({ name, page, ctx });
    }

    // the Host steps the room on. Only the lobby, a reveal and a leaderboard wait for a press: the round card goes
    // on by itself, and a question ends at its time limit or once everyone has answered. Each press names the step
    // it was made on, so it can never land on the screen after the one it was meant for — and the room is then
    // given until it actually leaves that step, rather than pressed again blind
    for (const [i, g] of GAMES.entries()) {
      while (!(S.phase === 'reveal' && S.question?.number === i + 1)) {
        const was = S.step;
        const at = S.phase;
        const number = S.question?.number ?? 0;
        if (at === 'podium' || number > i + 1) throw new Error(`the room ran past the reveal of ${g.id} (${where()})`);
        if (at === 'round' || at === 'question') await until((s) => s.step !== was, `the ${at} before ${g.id} to end`);
        else {
          host.emit('host:next', { step: was });
          await until((s) => s.step !== was, `the room to leave the ${at} on the way to ${g.id}`, 20000);
        }
      }
      await sleep(2900);
      for (const { name, page } of pages) {
        // a page can trail the room: wait until its reveal shows this question's prompt, then measure
        const ready = Date.now() + 25000;
        let measured;
        do {
          measured = await page.evaluate(measure, g.prompt).catch((e) => ({ out: [`measure threw: ${e.message}`] }));
          if (!measured.out.length) break;
          await sleep(300);
        } while (Date.now() < ready);
        checks++;
        if (process.env.SHOW) console.log(`  ${name} ${g.id}: texts ${measured.texts} col ${measured.col} card ${measured.card} dock ${measured.dockTop} vw ${measured.vw}`);
        if (measured.out.length) fails.push(`${name} ${g.id}: ${measured.out.slice(0, 4).join(' | ')}`);
      }
    }
    checks++;
    if (refused.length) fails.push(`${refused.length} of ${PLAYERS * GAMES.length} answers turned away: ${refused.slice(0, 3).join(', ')}`);
    return { checks, fails };
  } finally {
    for (const { ctx } of pages) await ctx.close().catch(() => {});
    for (const b of bots) b.close();
    await host.timeout(5000).emitWithAck('host:close', { pin, hostToken }).catch(() => {});
    closing = true;
    host.close();
  }
}

const browser = await chromium.launch({ ...launchOptions, headless: true });
const batches = [];
for (let i = 0; i < VIEWS.length; i += BATCH) batches.push(VIEWS.slice(i, i + BATCH));
const fails = [];
let checks = 0;
for (const [i, views] of batches.entries()) {
  console.log(`batch ${i + 1}/${batches.length}: ${views.map(([n]) => n).join(', ')}`);
  try {
    const r = await playBatch(browser, views, `${Date.now().toString(36).slice(-4)}${i + 1}`);
    checks += r.checks;
    fails.push(...r.fails);
  } catch (e) {
    fails.push(`batch ${i + 1} (${views.map(([n]) => n).join(', ')}): ${e.message}`);
  }
}
await browser.close();
console.log(fails.length ? fails.join('\n') : 'all clear');
console.log(`${checks} checks, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
