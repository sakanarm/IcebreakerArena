// The sample games, seen the way a visitor sees them: nobody signed in. Opens /host, checks every card in
// "เกมตัวอย่าง" draws a cover, says how many rounds and questions it has, and offers a start button, then
// starts one and waits for its lobby to show the PIN and the QR.
//   node samples-signed-out.mjs [--base=http://localhost:3000] [--title=รู้จัก Pika] [--shots=<dir>]
// Against production: node samples-signed-out.mjs --base=https://dmhub.mfec.dev/PikaArena
// It leaves one empty lobby behind, which the server closes by itself (EMPTY_LIMIT_MS, 30 minutes).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { launchOptions } from './lib/rig.mjs';

const WEB = (process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'http://localhost:3000').replace(/\/$/, '');
const TITLE = process.argv.find((a) => a.startsWith('--title='))?.slice(8) ?? 'รู้จัก Pika, PikaScrape และ Pika Arena';
const SHOTS = process.argv.find((a) => a.startsWith('--shots='))?.slice(8) ?? '';

let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
};
const shoot = async (page, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => check(false, `no page error (${e.message})`));
page.on('console', (m) => m.type() === 'error' && check(false, `no console error (${m.text().slice(0, 120)})`));

await page.goto(`${WEB}/host`, { waitUntil: 'networkidle' });
await page.waitForSelector('text=เกมตัวอย่าง', { timeout: 20000 });
check(true, 'the host page shows เกมตัวอย่าง with nobody signed in');
check(!(await page.getByRole('button', { name: 'ออกจากระบบ' }).count()), 'nobody is signed in');

const cards = page.locator('article');
const count = await cards.count();
check(count > 0, `the samples are on the page (${count} cards)`);
for (let i = 0; i < count; i++) {
  const card = cards.nth(i);
  const name = (await card.locator('h3').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
  const text = await card.innerText();
  check((await card.locator('svg').count()) > 0, `"${name}" draws a cover`);
  check(/\d+ ด่าน[\s·]+\d+ ข้อ/.test(text), `"${name}" says how many rounds and questions it has`);
  check((await card.getByRole('button', { name: /เริ่มห้อง/ }).count()) > 0, `"${name}" has a start button`);
}
await shoot(page, 'samples');

const mine = cards.filter({ hasText: TITLE }).first();
check((await mine.count()) > 0, `"${TITLE}" is one of them`);
await mine.getByRole('button', { name: /เริ่มห้อง/ }).first().click();
await page.waitForURL(/\/host\/\d{6}(\?|#|$)/, { timeout: 30000 });
const pin = page.url().match(/\/host\/(\d{6})/)?.[1];
check(Boolean(pin), `a room opened from its card (PIN ${pin})`);
await page.waitForSelector(`text=${pin}`, { timeout: 20000 });
const lobby = await page.innerText('body');
check(lobby.includes(TITLE), 'the lobby names the game');
check(lobby.includes('/play'), 'the lobby tells players where to go');
check(await page.locator('svg, canvas, img').first().isVisible(), 'the lobby draws the QR');
await page.waitForTimeout(2000); // it animates in; shoot it settled
await shoot(page, 'lobby');

await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
