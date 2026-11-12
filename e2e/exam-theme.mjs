// The exam pages' light look. Exams open dark; the sun button in their top bar turns them light, and this browser
// remembers it: a reload, a later visit and every other open tab come back light, with no dark frame first. Only
// the exam pages change: the home page, /host, the login page and the admin pages stay dark. Every bit of text on
// every exam screen (the list, a start page, a question before and after it is checked, a mock paper, the hand-in
// dialog, the result) is read in both looks and must reach 4.5:1 against what is behind it (3:1 for large text).
// A phone never scrolls sideways, with the button in the paper's crowded top bar too.
//   node exam-theme.mjs [--base=http://localhost:3000] [--shots=<dir>]
// Signed out only: everything here is on the sample games.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { launchOptions } from './lib/rig.mjs';

const WEB = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? '';

const SAMPLE = 'tpl-pika';
const KEY = 'ib.look.exam';
const PAGE_GREY = 'rgb(244, 244, 246)';

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
  page.on('console', (m) => m.type() === 'error' && !/favicon|DevTools/.test(m.text()) && errors.push(`${who}: ${m.text().slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());
};
/** a context that reports any Content Security Policy refusal, and notes the look the page had on its first frame */
const context = async (options) => {
  const ctx = await browser.newContext(options);
  await ctx.exposeBinding('__cspRefused', (_, what) => errors.push(`CSP refused: ${what}`));
  await ctx.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => window.__cspRefused?.(`${e.violatedDirective} ${e.blockedURI} ${e.sample ?? ''}`));
    // the first frame is drawn after this callback: what it sees is what the reader saw first
    requestAnimationFrame(() => {
      const themed = document.querySelector('.exam-themed');
      window.__firstFrame = {
        look: document.documentElement.getAttribute('data-exam-theme'),
        page: themed ? getComputedStyle(themed).backgroundColor : null,
      };
    });
  });
  return ctx;
};

const squash = (s) => s.replace(/\s+/g, ' ').trim();
const textOf = async (loc) => squash(await loc.first().innerText());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const look = (page) => page.evaluate(() => document.documentElement.getAttribute('data-exam-theme'));
const remembered = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const toggle = (page) => page.getByTestId('exam-theme');
/** what is under the exam: its page color */
const ground = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.exam-themed') ?? document.body).backgroundColor);
const bodyGround = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
/** the button's own colors and the page's are moving for 120ms after a click */
const settle = (page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => r()));
    for (const a of document.getAnimations()) {
      try {
        if (a.effect?.getTiming().iterations !== Infinity) a.finish();
      } catch {
        // an animation that cannot be finished is one that runs for ever (a pulse): left as it is
      }
    }
  });
/** flips the look under the page without touching the button: for reading a screen (with a dialog open, say) both ways */
const setLook = async (page, light) => {
  await page.evaluate((l) => (l ? document.documentElement.setAttribute('data-exam-theme', 'light') : document.documentElement.removeAttribute('data-exam-theme')), light);
  await settle(page);
};

/**
 * Every bit of text on the screen (or inside `root`) against what is behind it, worked out the way the browser
 * draws it: the backgrounds of the element and everything around it painted one over the other, then the text
 * color (with any fading) on top. A gradient counts as its plain color under it.
 */
const contrast = (page, root = 'body') =>
  page.evaluate((root) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const paint = (color, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalAlpha = 1;
    };
    const read = () => Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const clear = (c) => /^rgba\(0, 0, 0, 0\)$|^transparent$/.test(c);

    const top = document.querySelector(root);
    const fails = [];
    let read_ = 0;
    const seen = new Set();
    const walk = document.createTreeWalker(top, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      // decoration, controls switched off, and what is only there for a screen reader
      if (el.closest('[aria-hidden="true"], :disabled, script, style, noscript, template, option')) continue;
      const style = getComputedStyle(el);
      if (style.visibility !== 'visible' || clear(style.color) || clear(style.webkitTextFillColor)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const box = range.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1 || style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)') continue;
      const chain = [];
      let fade = 1;
      for (let e = el; e; e = e.parentElement) {
        chain.unshift(e);
        fade *= Number(getComputedStyle(e).opacity);
      }
      if (fade < 0.1) continue;
      paint(getComputedStyle(document.documentElement).colorScheme === 'dark' ? '#121212' : '#ffffff');
      for (const e of chain) paint(getComputedStyle(e).backgroundColor);
      const bg = read();
      paint(style.color, fade);
      const fg = read();
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const need = large ? 3 : 4.5;
      const got = ratio(fg, bg);
      read_++;
      if (got < need - 0.01)
        fails.push(
          `${got.toFixed(2)}:1 < ${need} "${squashed(n.textContent).slice(0, 40)}" rgb(${fg}) on rgb(${bg}) <${el.tagName.toLowerCase()} class="${String(el.className).slice(0, 90)}">`,
        );
    }
    function squashed(s) {
      return s.replace(/\s+/g, ' ').trim();
    }
    return { read: read_, fails };
  }, root);

/** reads the screen both ways (light first, as the reader has it), then puts the look back */
const readable = async (page, what, { root = 'body', shot = '' } = {}) => {
  const was = (await look(page)) === 'light';
  for (const light of [true, false]) {
    await setLook(page, light);
    const { read, fails } = await contrast(page, root);
    check(read >= 3 && fails.length === 0, `${what}, ${light ? 'light' : 'dark'}: all ${read} bits of text readable${fails.length ? `:\n    ${fails.slice(0, 12).join('\n    ')}` : ''}`);
    if (shot) await shoot(page, `${shot}-${light ? 'light' : 'dark'}`, root === 'body');
  }
  await setLook(page, was);
};

// the sitting's page, as exam.mjs reads it
const on = (page) => ({
  heading: page.locator('#exam-prompt'),
  options: page.locator('[data-choice]'),
  status: page.locator('main [role=status]'),
  button: (name) => page.locator('main').getByRole('button', { name, exact: true }),
});
const startPage = (page) => page.getByRole('button', { name: 'เริ่มทำข้อสอบ' });
const begin = async (page, { count, mode = 'practice', pace = null }) => {
  await page.getByRole('textbox', { name: 'จำนวนข้อ' }).fill(String(count));
  await page.getByRole('textbox', { name: 'จำนวนข้อ' }).blur();
  await page.locator(`input[name=exam-mode][value=${mode}]`).check();
  if (pace !== null) await page.locator('main select').selectOption(String(pace));
  await startPage(page).click();
  await on(page).heading.waitFor({ timeout: 10000 });
};
const forget = (page) => page.evaluate((k) => localStorage.removeItem(k), `ib.exam.${SAMPLE}`);
const sitting = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null'), `ib.exam.${SAMPLE}`);

// ============ the button
const desk = await context({ viewport: { width: 1280, height: 900 } });
const page = await desk.newPage();
watch(page, 'desk');

await page.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
const night = await ground(page);
check(
  (await look(page)) === null && (await remembered(page)) === null && night !== PAGE_GREY,
  `exams open dark by default (${night})`,
);
check((await toggle(page).count()) === 1, 'the exam list has one look button, in its top bar');
check(
  (await toggle(page).getAttribute('aria-pressed')) === 'false' && (await toggle(page).getAttribute('title')) === 'เปลี่ยนเป็นโหมดสว่าง',
  'it says what it does: "เปลี่ยนเป็นโหมดสว่าง", not pressed',
);
await toggle(page).click();
await settle(page);
check((await look(page)) === 'light', 'pressing it turns the page light at once');
check((await ground(page)) === PAGE_GREY && (await bodyGround(page)) === PAGE_GREY, `on the soft grey page, under the exam and past its ends (${await ground(page)})`);
check(
  (await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)) === 'light',
  'with light scrollbars and form controls',
);
check(
  (await toggle(page).getAttribute('aria-pressed')) === 'true' && (await toggle(page).getAttribute('title')) === 'เปลี่ยนเป็นโหมดมืด',
  'the button now offers the dark one back',
);
check((await remembered(page)) === '"light"', 'and this browser remembers it');
await readable(page, 'the exam list', { shot: '01-index' });

// a reload, and a later visit, come back light from the first frame
await page.reload({ waitUntil: 'networkidle' });
const first = await page.evaluate(() => window.__firstFrame);
check(first?.look === 'light' && first.page === PAGE_GREY, `a reload is light from its first frame, with no dark flash (${JSON.stringify(first)})`);
check((await look(page)) === 'light' && (await toggle(page).getAttribute('aria-pressed')) === 'true', 'and still light once the page has come alive');
const later = await desk.newPage();
watch(later, 'later');
await later.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
const laterFirst = await later.evaluate(() => window.__firstFrame);
check(laterFirst?.look === 'light' && laterFirst.page === PAGE_GREY, 'a new tab straight onto an exam is light from its first frame too');

// the other tab follows, both ways
await toggle(page).click();
await later.waitForFunction(() => !document.documentElement.hasAttribute('data-exam-theme'), null, { timeout: 3000 }).catch(() => {});
check(
  (await look(later)) === null && (await toggle(later).getAttribute('aria-pressed')) === 'false',
  'turning it dark in one tab turns the other tab dark too',
);
await toggle(later).click();
await page.waitForFunction(() => document.documentElement.hasAttribute('data-exam-theme'), null, { timeout: 3000 }).catch(() => {});
check((await look(page)) === 'light' && (await toggle(page).getAttribute('aria-pressed')) === 'true', 'and light again from the other one');
await later.close();

// the keyboard works it as well
await toggle(page).focus();
await page.keyboard.press('Space');
check((await look(page)) === null, 'Space on the button turns it dark');
await page.keyboard.press('Enter');
check((await look(page)) === 'light' && (await remembered(page)) === '"light"', 'Enter turns it light again');

// ============ everywhere else stays as it was
await page.getByRole('link', { name: 'กลับหน้าแรก' }).first().click();
await page.waitForFunction(() => !document.querySelector('.exam-themed'), null, { timeout: 10000 });
await settle(page);
check(
  (await bodyGround(page)) !== PAGE_GREY && (await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)) !== 'light',
  `leaving for the home page in the app, the home page is dark (${await bodyGround(page)})`,
);
await page.goBack({ waitUntil: 'networkidle' });
await page.locator('.exam-themed').first().waitFor({ timeout: 10000 });
await settle(page);
check((await ground(page)) === PAGE_GREY, 'and back on the exam list it is light again');

for (const path of ['/', '/host', '/login', '/admin']) {
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle' });
  const bg = await bodyGround(page);
  check(
    bg !== PAGE_GREY && (await page.locator('.exam-themed').count()) === 0 && (await toggle(page).count()) === 0,
    `${path} stays dark, without the look button, while exams are light (${bg} at ${new URL(page.url()).pathname})`,
  );
}

// the exam styles outside an exam (the admin pages use them) keep the dark look
await page.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
const outside = await page.evaluate(() => {
  const box = document.createElement('div');
  box.className = 'exam-page';
  box.innerHTML = '<div class="exam-card"><p class="text-ex-fg">admin</p></div>';
  document.body.append(box);
  const card = getComputedStyle(box.firstElementChild).backgroundColor;
  const text = getComputedStyle(box.querySelector('p')).color;
  const inside = getComputedStyle(document.querySelector('.exam-themed .exam-card') ?? document.body).backgroundColor;
  box.remove();
  return { card, text, inside };
});
check(
  outside.card !== 'rgb(255, 255, 255)' && outside.text !== 'rgb(22, 22, 29)' && outside.inside === 'rgb(255, 255, 255)',
  `exam cards outside an exam stay dark (${outside.card}) while the exam's own are white (${outside.inside})`,
);

// a link that leads nowhere is an exam page too
await page.goto(`${WEB}/exam/zzzz-nope`, { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'ไม่พบข้อสอบนี้' }).waitFor({ timeout: 10000 });
check((await ground(page)) === PAGE_GREY && (await toggle(page).count()) === 1, '"ไม่พบข้อสอบนี้" is light, with the button');
await readable(page, '"ไม่พบข้อสอบนี้"');
// looking up a code that leads nowhere logs the 404
for (let i = errors.length - 1; i >= 0; i--) if (/status of 404/.test(errors[i])) errors.splice(i, 1);

// ============ every screen of a sitting, read in both looks
await page.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
await forget(page);
await page.reload({ waitUntil: 'networkidle' });
await startPage(page).waitFor({ timeout: 15000 });
check((await toggle(page).count()) === 1, "a game's start page has the button");
await readable(page, 'the start page', { shot: '02-start' });

await begin(page, { count: 3 });
const R = on(page);
const paper = await sitting(page);
const right = (i) => paper.items[i].question.correct[0];
const wrong = (i) => (right(i) + 1) % paper.items[i].question.options.length;
check((await toggle(page).count()) === 1 && (await page.locator('header').getByTestId('exam-theme').count()) === 1, "the paper keeps the button in its own top bar");
check((await ground(page)) === PAGE_GREY, 'the paper is light');
await readable(page, 'a question', { shot: '03-question' });

await R.options.nth(right(0)).click();
await settle(page);
await readable(page, 'a question with an answer picked', { shot: '04-picked' });
await R.button('ตรวจคำตอบ').click();
await R.status.waitFor({ timeout: 5000 });
await settle(page);
await readable(page, 'a right answer, checked, with its explanation', { shot: '05-right' });

await R.button('ข้อต่อไป →').click();
await R.options.nth(wrong(1)).click();
await R.button('ตรวจคำตอบ').click();
await R.status.waitFor({ timeout: 5000 });
await settle(page);
await readable(page, 'a wrong answer, checked', { shot: '06-wrong' });

// the button on the paper itself
await page.locator('header').getByTestId('exam-theme').click();
await settle(page);
check((await look(page)) === null && (await ground(page)) === night, 'the button on the paper turns it dark');
await shoot(page, '06-wrong-dark-by-button');
await page.locator('header').getByTestId('exam-theme').click();
await settle(page);
check((await look(page)) === 'light' && (await ground(page)) === PAGE_GREY, 'and light again');
// the keys still answer after the button had the focus
await R.button('ข้อต่อไป →').click();
await R.button('ดูเฉลย').click();
await R.status.waitFor({ timeout: 5000 });
await page.keyboard.press('f');
await settle(page);
check((await page.locator('main article').getByRole('button', { name: /ติดธง/ }).getAttribute('aria-pressed')) === 'true', 'the keys still work on the paper (F flags)');
await readable(page, 'a question shown without an answer, flagged', { shot: '07-skipped' });

await R.button('ดูสรุปผล').click();
await page.locator('[data-exam-score]').waitFor({ timeout: 5000 });
await settle(page);
check((await toggle(page).count()) === 1 && (await ground(page)) === PAGE_GREY, 'the result is light, with the button');
await readable(page, 'the result', { shot: '08-result' });
await page.getByRole('group', { name: 'กรองข้อที่แสดง' }).getByRole('button', { name: /^ตอบผิด/ }).click().catch(() => {});
await settle(page);
await readable(page, 'the result, filtered');

// a mock paper, against the clock, and the hand-in dialog
await forget(page);
await page.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
await begin(page, { count: 3, mode: 'mock', pace: 60 });
await R.options.nth(0).click();
await settle(page);
await readable(page, 'a mock paper with an answer', { shot: '09-mock' });
await page.locator('header').getByRole('button', { name: 'ส่งข้อสอบ' }).click();
const ask = page.getByRole('dialog');
await ask.waitFor({ timeout: 5000 });
await settle(page);
await readable(page, 'the hand-in dialog', { root: '[role=dialog]' });
for (const light of [true, false]) {
  await setLook(page, light);
  await shoot(page, `10-confirm-${light ? 'light' : 'dark'}`);
}
await setLook(page, true);
await ask.getByRole('button', { name: 'ส่งข้อสอบ' }).click();
await page.locator('[data-exam-score]').waitFor({ timeout: 5000 });
await settle(page);
await readable(page, 'a mock result', { shot: '11-mock-result' });
check((await remembered(page)) === '"light"' && (await look(page)) === 'light', 'the look held all the way through');

// ============ phones
for (const width of [375, 320]) {
  const phone = await context({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  watch(p, `phone ${width}`);
  await p.goto(`${WEB}/exam`, { waitUntil: 'networkidle' });
  await p.evaluate((k) => localStorage.setItem(k, '"light"'), KEY);
  await p.reload({ waitUntil: 'networkidle' });
  const inView = async (where) => {
    const b = await toggle(p).boundingBox();
    return check(
      Boolean(b) && b.x >= 0 && b.x + b.width <= width && b.width >= 40 && (await noSideScroll(p)),
      `${width}px, ${where}: the button is on screen, big enough to tap, and nothing scrolls sideways`,
    );
  };
  check((await look(p)) === 'light' && (await ground(p)) === PAGE_GREY, `${width}px: the list is light`);
  await inView('the list');
  await shoot(p, `12-phone-${width}-index`);
  await p.goto(`${WEB}/exam/${SAMPLE}`, { waitUntil: 'networkidle' });
  await forget(p);
  await p.reload({ waitUntil: 'networkidle' });
  await startPage(p).waitFor({ timeout: 15000 });
  await inView('the start page');
  await shoot(p, `13-phone-${width}-start`, true);
  // the most crowded top bar: leave, the clock, the look button and hand in
  await begin(p, { count: 2, mode: 'mock', pace: 60 });
  await inView('a timed mock paper');
  const bar = await p.locator('header button, header [role=timer]').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, what: e.getAttribute('aria-label') ?? e.textContent.trim() };
    }),
  );
  const overlapping = bar.flatMap((a, i) => bar.slice(i + 1).filter((b) => a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1).map((b) => `${a.what} × ${b.what}`));
  check(bar.length >= 4 && overlapping.length === 0 && bar.every((x) => x.l >= 0 && x.r <= width), `${width}px: the paper's top bar fits, nothing on top of anything (${bar.length} parts${overlapping.length ? `; ${overlapping.join(', ')}` : ''})`);
  await readable(p, `${width}px, a timed mock paper`, { shot: `14-phone-${width}-mock` });
  await toggle(p).tap();
  await settle(p);
  check((await look(p)) === null && (await ground(p)) === night, `${width}px: tapping the button turns it dark`);
  await phone.close();
}

check(errors.length === 0, `no errors in the browser, no script refused by the page's security policy, no hydration warnings${errors.length ? `:\n  ${errors.join('\n  ')}` : ''}`);
await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
