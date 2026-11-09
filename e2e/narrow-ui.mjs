// The Host page and the big screen on phones (360–390 px wide, and on their side) and on a laptop and a projector
// (where the main-is-a-scroller change must not cost them anything), through every phase and every
// question type, in two games: one as people write them, where every scene has to fit the screen as it is, and one
// with everything at the longest the editor allows, where a scene may scroll but nothing may be cut off, run into
// something else, or hide under the dock. Screenshots in narrow-shots/, or narrow-shots-NAME/ with --out=NAME (…-end.png:
// a scene scrolled to its end).
//   node narrow-ui.mjs [base url, default local dev] [--shots] [--only=normal|worst] [--pages=stage|host] [--views="host 360,stage 360"] [--out=NAME]
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

import { require, launchOptions } from './lib/rig.mjs';
const { io } = require('socket.io-client');

const WEB = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:3000';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const MOUNT = new URL(WEB).pathname.replace(/\/$/, '');
const GAME = WEB === 'http://localhost:3000' ? { url: 'http://localhost:4000', path: '/socket.io' } : { url: new URL(WEB).origin, path: `${MOUNT}/socket.io` };
// Pictures of 15 pages take longer than the scene they are of, which pushes every later scene past its moment (the
// lead-in ends, the question is answered) and makes the checks measure the wrong scene. So they are off unless asked
// for: the checks read the pages themselves, the pictures are for looking at afterwards.
const SHOTS = process.argv.includes('--shots');
const NAMED = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const OUT = fileURLToPath(new URL(NAMED ? `./narrow-shots-${NAMED}/` : './narrow-shots/', import.meta.url));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const tag = Date.now().toString(36).slice(-5);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// the sockets come back the way the real pages do — the Host re-attaches, a player resumes with its own token.
// A machine short of cores drops a websocket now and then, and a harness that gives up there spends the next two
// minutes pressing a button nobody is holding and then blames the screen it was looking at.
const connect = () => io(GAME.url, { path: GAME.path, transports: ['websocket'], forceNew: true, reconnectionAttempts: 20 });
let failed = 0;
let passed = 0;
const check = (ok, what) => (ok ? passed++ : (console.log('FAIL', what), failed++), ok);
// what fn returns in the page once it is something: page.waitForFunction runs its test as code from a string, which
// the pages' CSP refuses on production, so ask over and over instead
const inPage = async (page, fn, arg, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`nothing within ${ms} ms`);
    await sleep(50);
  }
};

// a picture for the questions that have one, served by the test itself
const IMG = 'https://narrow-test.invalid/picture.png';

/** Thai text of about n letters, words apart, cut to at most n */
const long = (phrase, n) => phrase.repeat(Math.ceil(n / phrase.length) + 1).slice(0, n).trimEnd();
const T = 'ทีมงานของเราชอบไปเที่ยวทะเลด้วยกันทุกปี ';

const NORMAL = {
  id: `narrow-${tag}`,
  title: `ทายใจทีมขาย ${tag}`,
  rounds: [
    {
      title: 'รู้จักกันก่อน',
      subtitle: 'คำถามง่ายๆ ให้ทุกคนอุ่นเครื่อง',
      questions: [
        { type: 'quiz', prompt: 'ออฟฟิศใหม่ของเราอยู่ชั้นไหนของอาคาร ลองนึกถึงวันแรกที่มาทำงานดูนะ', options: ['ชั้น 12 ฝั่งลิฟต์โดยสาร', 'ชั้น 15', 'ชั้น 18 ติดห้องประชุมใหญ่', 'ชั้น 21'], correct: [1], timeLimitS: 30, imageUrl: IMG },
        { type: 'truefalse', prompt: 'ทีมเราไปเที่ยวทะเลด้วยกันครั้งล่าสุดเมื่อปีที่แล้ว', options: ['จริง', 'เท็จ'], correct: [0], timeLimitS: 30 },
        { type: 'poll', prompt: 'มื้อเที่ยงวันศุกร์นี้ อยากกินอะไรกันดี', options: ['ส้มตำไก่ย่าง', 'ข้าวมันไก่เจ้าดัง', 'ชาบูบุฟเฟต์', 'สลัดผักสุขภาพดี'], correct: [], timeLimitS: 30 },
      ],
    },
    {
      title: 'รอบตัดสิน',
      multiplier: 2,
      timed: false,
      questions: [
        { type: 'puzzle', prompt: 'เรียงเหตุการณ์ของบริษัท จากเก่าที่สุดไปใหม่ที่สุด', options: ['ก่อตั้งบริษัท', 'เปิดสาขาแรก', 'ย้ายออฟฟิศใหม่', 'ฉลองครบ 30 ปี'], correct: [], timeLimitS: 30 },
        { type: 'type', prompt: 'หัวหน้าทีมของเรามีชื่อเล่นว่าอะไร', options: ['พี่โอ๊ต', 'โอ๊ต', 'Oat'], correct: [], timeLimitS: 30 },
        { type: 'slider', prompt: 'ทีมเรามีสมาชิกทั้งหมดกี่คน', options: [], correct: [], timeLimitS: 30, slider: { min: 0, max: 200, step: 1, answer: 48, margin: 3, unit: 'คน' } },
      ],
    },
  ],
};

// everything at the limit: 120-letter titles, 200-letter questions, 75-letter options, 40-letter answers, the
// widest numbers a slider takes with a 20-letter unit, the most a round multiplies by, and a picture
const options = (n, len) => Array.from({ length: n }, (_, i) => long(`${i + 1}) ตัวเลือกที่ยาวที่สุดเท่าที่จะพิมพ์ได้ `, len));
const WORST = {
  id: `narrow-worst-${tag}`,
  title: long(`เกมทดสอบจอแคบ ${tag} `, 120),
  rounds: [
    {
      title: long('ด่านแรกที่ชื่อยาวมากจนต้องขึ้นหลายบรรทัด ', 120),
      subtitle: long('คำอธิบายด่านที่ยาวที่สุดเท่าที่ระบบยอมให้ ', 120),
      multiplier: 4,
      timed: false,
      questions: [
        { type: 'quiz', prompt: long(T, 200), options: options(4, 75), correct: [1], timeLimitS: 30, multiplier: 2, imageUrl: IMG },
        { type: 'truefalse', prompt: long(T, 200), options: options(2, 75), correct: [0], timeLimitS: 30 },
        { type: 'poll', prompt: long(T, 200), options: options(4, 75), correct: [], timeLimitS: 30, multiplier: 0 },
      ],
    },
    {
      title: 'ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZ-no-spaces-at-all-ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTU',
      subtitle: long('คำอธิบายด่านที่สอง ', 120),
      questions: [
        { type: 'puzzle', prompt: long(T, 200), options: options(4, 75), correct: [], timeLimitS: 30 },
        { type: 'type', prompt: long(T, 200), options: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCD', ...options(3, 40)], correct: [], timeLimitS: 30 },
        { type: 'slider', prompt: long(T, 200), options: [], correct: [], timeLimitS: 30, slider: { min: -1_000_000_000, max: 1_000_000_000, step: 200_000, answer: 999_800_000, margin: 100_000_000, unit: long('หน่วยที่ยาวที่สุดนะครับ', 20) } },
      ],
    },
  ],
};
for (const g of [NORMAL, WORST]) g.rounds.forEach((r, ri) => ((r.id = `r${ri + 1}`), r.questions.forEach((q, qi) => (q.id = `q${ri + 1}-${qi + 1}`))));

const PLAYERS = 6;
/** bot k is right when k % 3 != 0 */
const answerFor = (game, q, k) => {
  const src = game.rounds.flatMap((r) => r.questions).find((x) => x.id === q.id);
  const good = k % 3 !== 0;
  switch (q.type) {
    case 'quiz':
    case 'truefalse':
      return { choice: good ? src.correct[0] : (src.correct[0] + 1) % src.options.length };
    case 'poll':
      return { choice: k % src.options.length };
    case 'puzzle': {
      const right = src.options.map((t) => q.options.indexOf(t));
      return { order: good ? right : [...right].reverse() };
    }
    case 'type':
      return { text: good ? src.options[k % src.options.length] : long('คำตอบผิดที่ยาวเต็มสี่สิบตัวอักษร ', 40) };
    case 'slider': {
      const s = src.slider;
      return { value: good ? s.answer - (k % 2) * s.step : s.min + k * s.step };
    }
  }
};

// server clock minus ours, as the player app works it out
let skew = 0;
{
  const s = connect();
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const sent = Date.now();
    const at = await s.timeout(5000).emitWithAck('time:sync');
    const rtt = Date.now() - sent;
    if (rtt < best) ((best = rtt), (skew = at - (sent + rtt / 2)));
  }
  s.close();
}
const serverNow = () => Date.now() + skew;

const browser = await chromium.launch({ ...launchOptions });
const png = await (async () => {
  const p = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await p.setContent('<body style="margin:0"><div style="width:1200px;height:800px;background:linear-gradient(135deg,#ff7a1a,#e0388b 50%,#3d5afe)"></div>');
  // through a file: a picture this big comes back over Playwright's own connection in one piece, and a 1200x800
  // gradient is past what that connection takes
  const at = join(tmpdir(), 'narrow-ui-cover.png');
  await p.screenshot({ path: at });
  await p.close();
  return readFileSync(at);
})();

const errors = [];
const VIEWS = [
  ['host 390', 'host', 390, 844],
  ['stage 390', 'stage', 390, 844],
  ['host 360', 'host', 360, 740],
  ['stage 360', 'stage', 360, 740],
  ['stage landscape', 'stage', 844, 390],
  ['host landscape', 'host', 844, 390],
  ['host landscape 360', 'host', 740, 360],
  // a small tablet, an iPad mini and an iPad, upright
  ['host 640', 'host', 640, 960],
  ['host 744', 'host', 744, 1133],
  ['host 768', 'host', 768, 1024],
  // a 1366×768 laptop's browser window, a 720p and a 1080p projector
  ['host laptop', 'host', 1366, 657, false],
  // 1920×1080 at 125%: the most common office laptop; the last height that gets the smaller sizes; the least that doesn't
  ['host 1536', 'host', 1536, 730, false],
  ['host 900', 'host', 1600, 900, false],
  ['host 1080p', 'host', 1920, 905, false],
  ['stage 720p', 'stage', 1280, 720, false],
  ['stage 1080p', 'stage', 1920, 1080, false],
];
const views = [];
// --pages=stage or --pages=host: half the pages at a time, for a machine short of memory
const PAGES = process.argv.find((x) => x.startsWith('--pages='))?.slice(8);
// --views="host 360,stage 360": only these, by their names above, to look again at one place
const NAMES = process.argv.find((x) => x.startsWith('--views='))?.slice(8).split(',');
if (NAMES?.some((n) => !VIEWS.some((v) => v[0] === n))) throw new Error(`no such view in ${NAMES}`);
for (const [name, kind, width, height, phone = true] of VIEWS.filter((v) => (!PAGES || v[1] === PAGES) && (!NAMES || NAMES.includes(v[0])))) {
  const ctx = await browser.newContext({ locale: 'th-TH', viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  await ctx.route('https://narrow-test.invalid/**', (route) => route.fulfill({ body: png, contentType: 'image/png' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools/.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  page.on('dialog', (d) => d.dismiss());
  views.push({ name, kind, page });
}

/**
 * What doesn't fit: the header's controls off screen or covered, anything sticking out sideways, text cut off by a
 * box that clips it (an ellipsis is fine) or running into other text, and what shows of the scene above its top
 * (out of reach) or under the dock. `strict`: the scene also has to fit without scrolling.
 */
const measureFn = (strict) => {
    const readAt = Date.now();
    const vw = innerWidth;
    const out = [];
    const cs = (el) => getComputedStyle(el);
    const under = (el, test) => {
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) if (test(cs(e), e)) return true;
      return false;
    };
    const fixed = (el) => under(el, (c) => c.position === 'fixed');
    const shown = (el) => !under(el, (c) => c.opacity === '0' || c.visibility === 'hidden' || c.display === 'none');
    const say = (s, n = 18) => s.replace(/\s+/g, ' ').trim().slice(0, n);
    const name = (el) => `${el.tagName}.${el.className.toString().slice(0, 40)} "${say(el.textContent, 16)}"`;
    const outer = (list) => list.filter((el, _, all) => !all.some((p) => p !== el && p.contains(el)));
    const R = (r) => `${Math.round(r.left)},${Math.round(r.top)}..${Math.round(r.right)},${Math.round(r.bottom)}`;

    // the header: every control on screen, the buttons clickable where they show, one row
    const header = document.querySelector('header');
    for (const el of header ? header.querySelectorAll(':scope > *, :scope > * > *') : []) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const label = say(el.getAttribute('aria-label') ?? el.textContent, 24);
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`header "${label}" at ${Math.round(r.left)}..${Math.round(r.right)} of ${vw}`);
      else if (el.matches('button')) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!el.contains(hit)) out.push(`header "${label}" is under ${hit?.tagName}.${hit?.className?.toString().slice(0, 40)}`);
      }
    }
    const headerH = Math.round(header?.getBoundingClientRect().height ?? 0);
    if (headerH > 76) out.push(`header ${headerH}px tall`);

    // the dock: every button on screen and clickable, its words on one line inside it
    const dock = document.querySelector('.btn.btn-gold')?.closest('.fixed');
    const wraps = (el) => {
      const mids = [];
      for (const x of [el, ...el.querySelectorAll('*')]) {
        // words kept for screen readers only
        if (x.getBoundingClientRect().width <= 1) continue;
        for (const n of x.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const q of range.getClientRects()) if (q.width > 1) mids.push((q.top + q.bottom) / 2);
        }
      }
      return mids.length > 0 && Math.max(...mids) - Math.min(...mids) > 0.6 * parseFloat(cs(el).fontSize);
    };
    for (const el of dock ? dock.querySelectorAll('button, a') : []) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const label = say(el.getAttribute('aria-label') ?? el.textContent, 24);
      if (r.left < -0.5 || r.right > vw + 0.5 || r.bottom > innerHeight + 0.5) out.push(`dock "${label}" at ${R(r)} of ${vw}x${innerHeight}`);
      else if (el.scrollWidth > el.clientWidth + 1) out.push(`dock "${label}" spills out of its button: ${el.scrollWidth} in ${el.clientWidth}px`);
      else if (wraps(el)) out.push(`dock "${label}" wraps onto two lines`);
      else {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!el.contains(hit)) out.push(`dock "${label}" is under ${hit?.tagName}.${hit?.className?.toString().slice(0, 40)}`);
      }
    }
    const dockTop = dock?.getBoundingClientRect().top ?? Infinity;

    // sideways: anything in the page wider than the screen (the root hides it, so nothing scrolls, but it is cut off).
    // What a box in the scene clips on purpose (a cover's art inside its frame) doesn't show, so it doesn't count;
    // what the scene itself or the page cuts off does
    const showing = (el) => {
      let r = el.getBoundingClientRect();
      r = { left: r.left, right: r.right, width: r.width };
      for (let e = el.parentElement; e && e.tagName !== 'MAIN' && e.tagName !== 'HEADER' && e !== document.body; e = e.parentElement) {
        const c = cs(e);
        if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
        const b = e.getBoundingClientRect();
        r = { left: Math.max(r.left, b.left), right: Math.min(r.right, b.right) };
        r.width = r.right - r.left;
        if (r.width <= 0) return null;
      }
      return r;
    };
    const wide = outer(
      [...document.querySelectorAll('main *, header *')].filter((el) => {
        const r = showing(el);
        return r && r.width > 0 && (r.right > vw + 1 || r.left < -1) && !fixed(el) && shown(el);
      }),
    );
    for (const el of wide.slice(0, 4)) out.push(`cut off sideways: ${name(el)} ${R(el.getBoundingClientRect())}`);

    const main = document.querySelector('main');
    if (!main) return { out, headerH, scrolls: 0 };
    const mb = main.getBoundingClientRect();
    const scroller = /auto|scroll/.test(cs(main).overflowY);
    const scrolls = Math.max(0, main.scrollHeight - main.clientHeight);
    // what reaches past the bottom, so a scroll says what it is for
    const lowest = () =>
      [...main.querySelectorAll('*')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ el, r }) => r.width > 0 && r.bottom > mb.bottom - main.clientTop + 1 && !el.closest('[aria-hidden="true"]') && shown(el))
        .filter(({ el }, _, all) => !all.some((o) => o.el !== el && el.contains(o.el)))
        .sort((a, b) => b.r.bottom - a.r.bottom)
        .slice(0, 3)
        .map(({ el, r }) => `${name(el)} to ${Math.round(r.bottom)}`)
        .join('; ');
    // when nothing visible reaches past the bottom, say what does: a decoration inflates scrollHeight the same way
    const lowestAll = () =>
      [...main.querySelectorAll('*')]
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.bottom > mb.bottom - main.clientTop + 1)
        .filter(({ el }, _, all) => !all.some((o) => o.el !== el && el.contains(o.el)))
        .sort((a, b) => b.r.bottom - a.r.bottom)
        .slice(0, 3)
        .map(({ el, r }) => name(el) + (el.closest('[aria-hidden="true"]') ? ' [decoration]' : '') + (shown(el) ? '' : ' [unseen]') + ' to ' + Math.round(r.bottom))
        .join('; ');
    const why = scrolls > 2 ? lowest() || ('nothing visible, but ' + (lowestAll() || 'nothing at all')) : '';
    if (strict && scrolls > 2) out.push(`the scene needs ${scrolls}px of scrolling (main to ${Math.round(mb.bottom)}): ${why}`);
    if (mb.bottom > dockTop + 1) out.push(`the scene runs under the dock: to ${Math.round(mb.bottom)}, the dock from ${Math.round(dockTop)}`);

    // up and down: what shows of the scene (text, pictures, colored boxes)
    const seen = (el) => {
      const c = cs(el);
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return true;
      if (/^(IMG|SVG|CANVAS|BUTTON)$/i.test(el.tagName)) return true;
      return c.backgroundColor !== 'rgba(0, 0, 0, 0)' || c.backgroundImage !== 'none';
    };
    // a list in the scene that scrolls by itself (the lobby's players) keeps what it holds inside it
    const innerScroll = (el) => {
      for (let e = el.parentElement; e && e !== main; e = e.parentElement) if (/auto|scroll/.test(cs(e).overflowY)) return true;
      return false;
    };
    const boxes = [...main.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && seen(el) && shown(el) && !fixed(el) && !innerScroll(el);
    });
    // above the top: when the scene scrolls, out of reach; when it doesn't, over the header. A decoration may go
    // anywhere, the same exemption the side margins make below: the podium's spotlights are a cone turned about its
    // own top, so the box around it reaches over the scene while the light it paints stays inside and clipped
    const reach = boxes.filter((el) => !el.closest('[aria-hidden="true"]'));
    for (const el of outer(reach.filter((el) => el.getBoundingClientRect().top < mb.top - 1)).slice(0, 4))
      out.push(`above the scene's top ${Math.round(mb.top)}: ${name(el)} ${R(el.getBoundingClientRect())}`);
    if (!scroller)
      for (const el of outer(reach.filter((el) => el.getBoundingClientRect().bottom > mb.bottom + 1)).slice(0, 4))
        out.push(`below the scene's bottom ${Math.round(mb.bottom)}: ${name(el)} ${R(el.getBoundingClientRect())}`);
    // the side margins: what shows of the scene keeps inside main's padding (what is past the screen's edge is
    // already said above; a decoration may go anywhere)
    const lo = mb.left + parseFloat(cs(main).paddingLeft) - 1;
    const hi = mb.right - parseFloat(cs(main).paddingRight) + 1;
    // what a one-line text paints, rather than its glyphs' box: an emoji's box is wider than the picture drawn in it
    const pen = document.createElement('canvas').getContext('2d');
    const ink = (el, r) => {
      if (el.children.length || !el.textContent.trim()) return r;
      const range = document.createRange();
      range.selectNodeContents(el);
      const lines = [...range.getClientRects()].filter((q) => q.width > 1);
      if (lines.length !== 1) return r;
      const c = cs(el);
      pen.font = `${c.fontStyle} ${c.fontWeight} ${c.fontSize} ${c.fontFamily}`;
      const m = pen.measureText(el.textContent.trim());
      const left = Math.max(r.left, lines[0].left - m.actualBoundingBoxLeft);
      const right = Math.min(r.right, lines[0].left + m.actualBoundingBoxRight);
      return { left, right, width: right - left };
    };
    // a marker centred on a point of the scene (the slider's needle on the end of its scale) may hang over by a few px
    const over = (r) => Math.max(lo - r.left, r.right - hi);
    const marker = (r) => over(r) <= 4 && (r.left + r.right) / 2 >= lo && (r.left + r.right) / 2 <= hi;
    const margins = boxes.filter((el) => {
      const r = showing(el) && ink(el, showing(el));
      return r && r.width > 0 && (r.left < lo || r.right > hi) && !marker(r) && r.left >= -1 && r.right <= vw + 1 && !el.closest('[aria-hidden="true"]');
    });
    for (const el of outer(margins).slice(0, 4)) {
      const r = ink(el, showing(el));
      out.push(`into the side margin (${Math.round(lo + 1)}..${Math.round(hi - 1)}): ${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
    }

    // text: cut off by a box that clips it, or running into other text
    const pieces = [];
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const el = n.parentElement;
      if (!n.textContent.trim() || !el || el.closest('svg') || fixed(el) || !shown(el)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      let rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1).map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
      for (let e = el; e && e !== document.documentElement && rects.length; e = e.parentElement) {
        const c = cs(e);
        if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
        const b = e.getBoundingClientRect();
        const fine = c.textOverflow === 'ellipsis' || (c.webkitLineClamp && c.webkitLineClamp !== 'none') || /auto|scroll/.test(c.overflowX + c.overflowY);
        // glyphs of a tall Thai line reach a little past their box: only a clear cut counts
        const cut = rects.some((r) => r.left < b.left - 2 || r.right > b.right + 2 || r.top < b.top - 5 || r.bottom > b.bottom + 5);
        if (cut && !fine && e.offsetWidth > 2) out.push(`text cut off by ${e.tagName}.${e.className.toString().slice(0, 30)}: "${say(n.textContent)}"`);
        rects = rects
          .map((r) => ({ left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) }))
          .filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1);
      }
      // a line's box runs from the font's highest mark to its lowest (tall for Thai), well past the letters
      // themselves: lines run into each other only where the letters' bodies do
      const fs = parseFloat(cs(el).fontSize);
      const core = (r) => {
        const mid = (r.top + r.bottom) / 2;
        return { left: r.left, right: r.right, top: Math.max(r.top, mid - 0.4 * fs), bottom: Math.min(r.bottom, mid + 0.4 * fs) };
      };
      let alpha = 1;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) alpha *= parseFloat(cs(e).opacity);
      if (rects.length && alpha > 0.95) pieces.push({ el, text: say(n.textContent), rects: rects.map(core) });
    }
    // text under something else that shows: a card that comes in over the end of a line. The text's own box is made
    // to catch the probe, which a decoration over it (pointer-events: none) lets through. What is over it hides it
    // where it paints: a box with a fill (glass too), a picture, or letters, which with nothing behind them paint only
    // the middle of their lines (a big PIN's box reaches up over its label, a medal's over the score under it)
    const letters = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const fs = parseFloat(cs(el).fontSize);
      const lines = [...range.getClientRects()].filter((q) => q.width > 1);
      return lines.map((q) => {
        const across = lines.length === 1 ? ink(el, q) : q;
        const mid = (q.top + q.bottom) / 2;
        return { left: across.left, right: across.right, top: Math.max(q.top, mid - 0.4 * fs), bottom: Math.min(q.bottom, mid + 0.4 * fs) };
      });
    };
    const paints = (el, x, y) => {
      const c = cs(el);
      if (/^(IMG|SVG|CANVAS|VIDEO)$/i.test(el.tagName) || el.closest('svg')) return true;
      if (!/^rgba\([^)]*, 0\)$|\/ 0\)$/.test(c.backgroundColor) ||c.backgroundImage !== 'none' || c.backdropFilter !== 'none') return true;
      if (el.children.length || !el.textContent.trim()) return false;
      return letters(el).some((q) => x >= q.left && x <= q.right && y >= q.top && y <= q.bottom);
    };
    const buried = [];
    for (const p of pieces) {
      const was = p.el.style.pointerEvents;
      p.el.style.pointerEvents = 'auto';
      // a line the scene has scrolled down out of view leaves a sliver at its edge, where the dock begins: that is
      // no line to read, and a scroll brings it out whole (the -end pictures)
      for (const r of p.rects.filter((r) => r.right - r.left > 6 && r.bottom - r.top >= 4)) {
        const y = (r.top + r.bottom) / 2;
        for (const x of [r.left + 2, (r.left + r.right) / 2, r.right - 2]) {
          // from the top down to the text itself (or what holds it)
          for (const e of document.elementsFromPoint(x, y)) {
            if (e === p.el || e.contains(p.el)) break;
            if (p.el.contains(e) || !shown(e) || !paints(e, x, y)) continue;
            buried.push(`text under ${name(e)}: "${p.text}" (its line ${r.top.toFixed(1)}..${r.bottom.toFixed(1)}, that from ${e.getBoundingClientRect().top.toFixed(1)}, main to ${mb.bottom.toFixed(1)})`);
            break;
          }
        }
      }
      p.el.style.pointerEvents = was;
    }
    out.push(...[...new Set(buried)].slice(0, 4));
    const hits = [];
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i];
        const b = pieces[j];
        if (a.el === b.el) continue;
        const clash = a.rects.some((r) =>
          b.rects.some((s) => {
            const w = Math.min(r.right, s.right) - Math.max(r.left, s.left);
            const h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top);
            return w > 4 && h > Math.max(5, 0.3 * Math.min(r.bottom - r.top, s.bottom - s.top));
          }),
        );
        if (clash) hits.push(`text runs into text: "${a.text}" and "${b.text}"`);
      }
    out.push(...hits.slice(0, 4));
    const scenes = [...document.querySelectorAll('section[data-scene]')].map((el) => el.dataset.scene);
    return { out: [...new Set(out)], headerH, scrolls, why, at: readAt, scene: scenes[scenes.length - 1] ?? '' };
  };
const measure = (page, strict) => page.evaluate(measureFn, strict);

/**
 * the stamp over the middle stays a second before the reveal, and reaching 13 busy pages from here can take longer
 * than that: each page measures itself `delay` ms after its stamp shows (landed by then), on the question scene it
 * is on now, for collecting after. A question that has already ended (its stamp gone) is skipped
 */
const armStamp = (page, strict, delay) =>
  page.evaluate(`(() => {
    const measure = ${measureFn.toString()};
    const last = () => [...document.querySelectorAll('section[data-scene]')].at(-1);
    const want = last()?.dataset.scene ?? '';
    window.__stamp = null;
    if (!want.startsWith('question-')) return void (window.__stamp = { skipped: want });
    const tick = () => {
      const sec = last();
      if (sec?.dataset.scene !== want) return void (window.__stamp = { skipped: 'moved on to ' + sec?.dataset.scene });
      if (!sec.querySelector('[role=status]')) return void requestAnimationFrame(tick);
      const seen = performance.now();
      setTimeout(() => {
        const fired = performance.now();
        const m = measure(${JSON.stringify(strict)});
        window.__stamp = { ...m, late: Math.round(fired - seen - ${delay}), cost: Math.round(performance.now() - fired) };
      }, ${delay});
    };
    requestAnimationFrame(tick);
  })()`);

const file = (game, phase, view) => `${OUT}${game}-${phase}-${view.replace(/\W+/g, '_')}`;
const scrolled = [];

/**
 * measures every page at once (a lead-in lasts 3 seconds), then takes their pictures. `scene`: the scene each page
 * has to be on, waited for unless `known` (the game is known to be on it, with no time to lose), checked after
 */
const judge = (game, phase, ms, scene) =>
  views.forEach((v, i) => {
    const m = ms[i];
    if (m.skipped) return;
    // a page that sent nothing back used to crash the walk below, which buried the real reason under a stack trace
    if (!m.scene || !Array.isArray(m.out))
      return void check(false, `${game} ${phase} ${v.name}: the page sent no measurements back (${JSON.stringify(m ?? null).slice(0, 120)})`);
    // a scene that had already moved on would pass or fail for the wrong one
    if (scene) check(m.scene.startsWith(scene), `${game} ${phase} ${v.name}: measured the ${scene} scene (saw ${m.scene || 'none'})`);
    check(!m.out.length, `${game} ${phase} ${v.name}${m.out.length ? `\n    ${m.out.join('\n    ')}` : ''}`);
    if (m.scrolls > 2) scrolled.push(`${game} ${phase} ${v.name}: ${m.scrolls}px: ${m.why}`);
  });

/** collects what armStamp's pages measured, with pictures taken as soon as everyone has answered */
const stampShot = async (game, phase) => {
  const t0 = Date.now();
  const shots = SHOTS ? Promise.all(views.map((v) => v.page.screenshot({ path: `${file(game, phase, v.name)}.png` }))) : null;
  const ms = await Promise.all(
    views.map((v) =>
      inPage(v.page, () => window.__stamp).catch(() => ({ out: [], scrolls: 0, scene: 'no stamp within 8 s' })),
    ),
  );
  await shots;
  const skipped = ms.filter((m) => m.skipped);
  if (skipped.length === ms.length) return console.log(`  ${game} ${phase}: skipped, the question had ended (${skipped[0].skipped})`);
  check(!skipped.length, `${game} ${phase}: every page stamped (${skipped.map((m) => m.skipped).join(', ')})`);
  judge(game, phase, ms, 'question-');
  if (process.env.TIMING) console.log(`  ${game} ${phase}: collected in ${Date.now() - t0} ms, measures late by up to ${Math.max(...ms.map((m) => m.late ?? 0))} ms, slowest walk ${Math.max(...ms.map((m) => m.cost ?? 0))} ms`);
};

const shoot = async (game, phase, wait, strict, scene = '', known = false) => {
  const t0 = Date.now();
  if (scene && !known)
    await Promise.all(
      views.map((v) =>
        inPage(v.page, (prefix) => [...document.querySelectorAll('section[data-scene]')].at(-1)?.dataset.scene.startsWith(prefix), scene).catch(() => {}),
      ),
    );
  const t1 = Date.now();
  await sleep(typeof wait === 'function' ? wait() : wait);
  const t2 = Date.now();
  const ms = await Promise.all(views.map((v) => measure(v.page, strict)));
  const measuredAt = Math.max(...ms.map((m) => (m.at ?? Date.now()) + skew));
  const t3 = Date.now();
  judge(game, phase, ms, scene);
  if (SHOTS) {
    await Promise.all(views.map((v) => v.page.screenshot({ path: `${file(game, phase, v.name)}.png` })));
    // a scene that scrolls: also its end
    await Promise.all(
      views.map(async (v, i) => {
        if (ms[i].scrolls <= 2) return;
        await v.page.evaluate(() => document.querySelector('main').scrollTo(0, 1e6));
        await v.page.screenshot({ path: `${file(game, phase, v.name)}-end.png` });
        await v.page.evaluate(() => document.querySelector('main').scrollTo(0, 0));
      }),
    );
  }
  if (process.env.TIMING) console.log(`  ${game} ${phase}: scene in ${t1 - t0} ms, measured in ${t3 - t2} ms, shots ${Date.now() - t3} ms`);
  return { ms, measuredAt };
};

async function play(label, game, strict) {
  const host = connect();
  let S = null;
  let drops = 0;
  let closing = false;
  host.on('stage:state', (s) => (S = s));
  const created = await host.timeout(10000).emitWithAck('host:create', { game });
  if (!created.ok) throw new Error(`host:create failed: ${created.error}`);
  const { pin, hostToken, stageToken } = created;
  host.on('disconnect', (why) => {
    if (closing) return;
    drops++;
    console.log(`${label}: the Host's socket dropped (${why})`);
  });
  host.on('connect', () => host.emit('host:attach', { pin, hostToken }));
  console.log(`${label}: PIN ${pin} on ${WEB}`);
  // a room standing still because nobody is holding its button looks exactly like a scene that will not come,
  // so every timeout says where the room really was and whether the Host was still connected to it
  const where = () => `phase ${S?.phase}, step ${S?.step}, host ${host.connected ? 'connected' : 'dropped'}${drops ? `, ${drops} drop(s)` : ''}`;
  const until = async (fn, what, ms = 45000) => {
    const end = Date.now() + ms;
    while (!(S && fn(S))) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what} (${where()})`);
      await sleep(40);
    }
  };
  const bots = [];
  // answers the server would not take: the reason a scene never came, in the harness's own words
  const refused = [];
  // question id -> let the bots answer it
  const gates = new Map();
  const gate = (id) => {
    if (!gates.has(id)) {
      let open;
      const opened = new Promise((r) => (open = r));
      gates.set(id, { opened, open });
    }
    return gates.get(id);
  };
  try {
    for (const v of views) {
      if (v.kind === 'host') await v.page.context().addInitScript(({ k, t }) => localStorage.setItem(k, t), { k: `ib.host.${pin}`, t: JSON.stringify(hostToken) });
      await v.page.goto(`${WEB}/${v.kind}/${pin}${v.kind === 'stage' ? `#${stageToken}` : ''}`);
      await v.page.locator('section[data-scene]').first().waitFor();
      // the real typeface, not the stand-in the browser draws until the page's own Thai fonts arrive
      await v.page.evaluate(() => document.fonts.ready.then(() => true)).catch(() => {});
    }
    await shoot(label, 'lobby-empty', 1500, strict);
    for (let k = 0; k < PLAYERS; k++) {
      const s = connect();
      const done = new Set();
      s.on('player:state', (st) => {
        const q = st.question;
        if (st.phase !== 'question' || !q || done.has(q.id)) return;
        done.add(q.id);
        // a while after answering opens, so the screens show the question with its answers still coming in
        void gate(q.id).opened.then(() =>
          setTimeout(
            () =>
              s.emit('player:answer', { questionId: q.id, ...answerFor(game, q, k) }, (r) => {
                if (r && !r.ok) refused.push(`player ${k + 1} on ${q.id}: ${r.error}`);
              }),
            200 + k * 250,
          ),
        );
      });
      const j = await s.timeout(10000).emitWithAck('player:join', { pin, nickname: long(`${k + 1} นักเล่นสายฮาประจำทีมขาย`, 24), avatar: ['🦊', '🐼', '🐸', '🦄', '🐙', '🐯'][k] });
      if (!j.ok) throw new Error(`join: ${j.error}`);
      // back as the same player, with the same score, the way the player's page comes back
      s.on('connect', () => s.emit('player:resume', { pin, token: j.token }));
      bots.push(s);
    }
    await until((s) => s.playerCount === PLAYERS, 'players');
    await shoot(label, 'lobby', 1200, strict);

    host.emit('host:next');
    let last = 'lobby';
    const keyOf = (s) => `${s.phase}-${s.round?.index}-${s.question?.id}`;
    for (;;) {
      await until((s) => keyOf(s) !== last, `the scene after ${last}`);
      const s = S;
      const seenAt = Date.now();
      last = keyOf(s);
      const q = s.question;
      const at = q ? `q${q.number}-${q.type}` : `r${(s.round?.index ?? 0) + 1}`;
      if (s.phase === 'round') await shoot(label, `${at}-round`, () => Math.max(250, Math.min(1300, seenAt + 2800 - Date.now())), strict, 'round-');
      else if (s.phase === 'question') {
        // the lead-in's badge, question and read bar are all in by 0.4 s (0.55 s once the blinds have opened)
        const { measuredAt } = await shoot(label, `${at}-1-lead-in`, 750, strict, 'question-');
        check(measuredAt < q.startsAt, `${label} ${at}: the lead-in was still up when it was measured`);
        await sleep(Math.max(0, q.startsAt - serverNow()));
        // the last answer tile is in by 0.65 s
        await shoot(label, `${at}-2-answering`, 900, strict, 'question-');
        await Promise.all(views.map((v) => armStamp(v.page, strict, 250)));
        gate(q.id).open();
        // everyone answers: the big screen stamps it over the middle for a second before the reveal
        await until((s) => s.phase !== 'question' || s.answeredCount >= PLAYERS, `everyone answering ${at}`);
        await stampShot(label, `${at}-2b-all-answered`);
      } else if (s.phase === 'reveal') {
        // the slider's needle lands (and its numbers come in) after 2.3 s
        await shoot(label, `${at}-3-reveal`, 2700, strict, 'reveal-');
        host.emit('host:next');
      } else if (s.phase === 'leaderboard') {
        await shoot(label, `${at}-4-leaderboard`, 1900, strict, 'leaderboard-');
        host.emit('host:next');
      } else if (s.phase === 'podium') {
        // after the winner, with the awards in and settled (they come in from below, one after the other)
        await shoot(label, 'podium', 7000, strict, 'podium');
        break;
      }
    }
  } catch (e) {
    check(false, `${label}: the game ran through: ${e.message}`);
  }
  check(!refused.length, `${label}: every answer was taken${refused.length ? `\n  ${refused.join('\n  ')}` : ''}`);
  const closed = await host.timeout(10000).emitWithAck('host:close', { pin, hostToken }).catch(() => ({ ok: false }));
  check(closed.ok, `${label}: the room is closed`);
  for (const b of bots) b.close();
  closing = true;
  host.close();
}

if (ONLY !== 'worst') await play('normal', NORMAL, true);
if (ONLY !== 'normal') await play('worst', WORST, false);
check(!errors.length, `no console or page errors${errors.length ? `\n  ${errors.slice(0, 12).join('\n  ')}` : ''}`);
await browser.close();
console.log(scrolled.length ? `scenes that scroll:\n  ${scrolled.join('\n  ')}` : 'no scene scrolls');
console.log(`screenshots in ${OUT}`);
console.log(`${passed} passed`);
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
