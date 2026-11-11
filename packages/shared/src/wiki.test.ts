import assert from 'node:assert/strict';
import { test } from 'node:test';
import { factKey, hasContactInfo, parseWikiPage } from './wiki';

/** a page shaped the way the knowledge base writes them, down to the citation on every bullet */
const PAGE = `# Pika Arena

## Summary
Pika Arena เป็นระบบเกมตอบคำถามสำหรับกิจกรรมภายในของ MFEC
ใช้งานผ่านเบราว์เซอร์โดยไม่ต้องติดตั้งแอป

## Details
- **ความจุห้อง**: ห้องเกมหนึ่งห้องรองรับผู้เล่นพร้อมกันได้สูงสุด 1,000 คน [[sources/2026-11-09-arena-rules.md]]
- ระบบเปิดใช้งานจริงครั้งแรกเมื่อ 20 ตุลาคม 2026 [[sources/2026-11-09-arena-rules.md]]
- ฐานข้อมูลที่ใช้เก็บเกมคือ PostgreSQL
  และรันกระบวนการด้วย pm2 [[systems/pika-arena.md]]
  - เครื่อง production ใช้ Node เวอร์ชัน 20

## Related
- [[topics/kahoot-comparison.md]]
- [[systems/pika.md]]
`;

test('a page gives up its summary, its facts and the pages it points at', () => {
  const page = parseWikiPage(PAGE);
  assert.match(page.summary, /^Pika Arena เป็นระบบเกมตอบคำถาม/);
  assert.match(page.summary, /ไม่ต้องติดตั้งแอป$/);
  assert.equal(page.facts.length, 3);
  assert.deepEqual(page.related, ['topics/kahoot-comparison.md', 'systems/pika.md']);
});

test('a fact keeps its own citation and loses the brackets and the markdown', () => {
  const [first] = parseWikiPage(PAGE).facts;
  assert.equal(first.text, 'ความจุห้อง: ห้องเกมหนึ่งห้องรองรับผู้เล่นพร้อมกันได้สูงสุด 1,000 คน');
  assert.equal(first.cite, 'sources/2026-11-09-arena-rules.md');
  assert.ok(!first.text.includes('['), first.text);
  assert.ok(!first.text.includes('**'), first.text);
});

test('a wrapped line and a nested bullet belong to the fact above them', () => {
  const third = parseWikiPage(PAGE).facts[2];
  assert.equal(third.text, 'ฐานข้อมูลที่ใช้เก็บเกมคือ PostgreSQL และรันกระบวนการด้วย pm2 เครื่อง production ใช้ Node เวอร์ชัน 20');
  assert.equal(third.cite, 'systems/pika-arena.md');
});

test('a page written without headings still gives up its bullets', () => {
  const page = parseWikiPage('บางเรื่องที่ต้องรู้\n\n- ข้อแรกที่ยาวพอจะเป็นคำถาม\n- ข้อที่สองที่ยาวพอเช่นกัน\n');
  assert.deepEqual(
    page.facts.map((f) => f.text),
    ['ข้อแรกที่ยาวพอจะเป็นคำถาม', 'ข้อที่สองที่ยาวพอเช่นกัน'],
  );
  assert.equal(page.summary, 'บางเรื่องที่ต้องรู้');
});

test('an empty page is empty, not a crash', () => {
  for (const input of ['', '   ', '# หัวข้อเดียว', null, undefined]) {
    const page = parseWikiPage(input as unknown as string);
    assert.deepEqual(page.facts, []);
    assert.deepEqual(page.related, []);
  }
});

test('a markdown link keeps its words and drops its url', () => {
  const [fact] = parseWikiPage('## Details\n- ดูขั้นตอนได้ที่ [คู่มือการใช้งาน](https://example.test/guide) ของทีม').facts;
  assert.equal(fact.text, 'ดูขั้นตอนได้ที่ คู่มือการใช้งาน ของทีม');
});

test('contact details are recognised however they are written', () => {
  for (const text of ['ติดต่อได้ที่ someone@mfec.co.th', 'โทร 02-123-4567 ต่อ 100', 'เบอร์มือถือ 081 234 5678', 'ติดต่อ 02-345-6789'])
    assert.ok(hasContactInfo(text), text);
  for (const text of ['ระบบเปิดใช้เมื่อ 20 ตุลาคม 2026', 'ห้องรองรับ 1,000 คน', 'เวอร์ชัน 20.20.0 ใช้งานอยู่'])
    assert.ok(!hasContactInfo(text), text);
});

test('two facts are the same when only punctuation and spacing differ', () => {
  assert.equal(factKey('ห้องรองรับ 1,000 คน'), factKey('ห้องรองรับ 1,000 คน.'));
  assert.notEqual(factKey('ห้องรองรับ 1,000 คน'), factKey('ห้องรองรับ 2,000 คน'));
});

/** the shape a real knowledge-base page came back in (2026-11-11): pointers inside sentences, notes below */
const SYSTEM_PAGE = `# Pika Arena

## Summary
เว็บเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรมภายในบริษัท

## Details
- เป็นเว็บเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรมภายในบริษัท — [[sources/2026-11-11-policy]]
- มีโหมดข้อสอบ ดูรายละเอียดที่ [[topics/pika-arena-exam-mode]] — [[sources/2026-11-11-policy]]
- ระบบเก็บรายงานผลการเล่นไว้ 90 วัน ดูที่ [[topics/game-report-retention-90-days]] — [[sources/2026-11-11-policy]]
- ข้อมูลเพิ่มเติม (see also [[topics/other]])

## Pages updated from this source
- [[systems/pika-arena]] — ข้อจำกัดของระบบและการเข้าร่วม

## Notes
- ยังไม่มีข้อมูลเรื่องราคา การติดตั้ง หรือผู้รับผิดชอบระบบ
`;

test('a pointer to another page comes out whole, and the source is still the citation', () => {
  const facts = parseWikiPage(SYSTEM_PAGE).facts;
  assert.deepEqual(
    facts.map((f) => f.text),
    ['เป็นเว็บเกมตอบคำถามสำหรับกิจกรรมละลายพฤติกรรมภายในบริษัท', 'มีโหมดข้อสอบ', 'ระบบเก็บรายงานผลการเล่นไว้ 90 วัน', 'ข้อมูลเพิ่มเติม'],
  );
  assert.ok(facts.slice(0, 3).every((f) => f.cite === 'sources/2026-11-11-policy'), JSON.stringify(facts));
  assert.equal(facts[3].cite, undefined);
});

test('notes about the page and the pages a source updated are not facts', () => {
  const text = parseWikiPage(SYSTEM_PAGE).facts.map((f) => f.text).join(' | ');
  assert.ok(!text.includes('ราคา'), text);
  assert.ok(!text.includes('ข้อจำกัดของระบบ'), text);
});

test('a page with Details keeps only them; one without keeps the bullets it has', () => {
  const md = '## Summary\nภาพรวม\n\n## ขั้นตอน\n- ขั้นแรกของงานที่ยาวพอจะถามได้\n';
  assert.deepEqual(parseWikiPage(md).facts.map((f) => f.text), ['ขั้นแรกของงานที่ยาวพอจะถามได้']);
  assert.deepEqual(parseWikiPage(`${md}\n## Details\n- ข้อเท็จจริงที่หน้านี้ระบุไว้ชัดเจน\n`).facts.map((f) => f.text), ['ข้อเท็จจริงที่หน้านี้ระบุไว้ชัดเจน']);
});
