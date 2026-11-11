import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readSheets } from '@pika-arena/shared';
import { decodeText, readSheetBytes, xmlText } from './sheet-file';

/** made by openpyxl (scratch script in the PR): merged cells, rich text, numbers, booleans, a hidden sheet */
const BANK = new Uint8Array(readFileSync(new URL('./fixtures/bank.xlsx', import.meta.url)));

test('an Excel workbook reads as its visible sheets, cells where Excel shows them', async () => {
  const res = await readSheetBytes(BANK, 'bank.xlsx');
  assert.ok(res.ok, !res.ok ? res.error : '');
  assert.deepEqual(
    res.sheets.map((s) => s.name),
    ['ความปลอดภัย', 'สรุป'],
  );
  const rows = res.sheets[0].rows;
  assert.deepEqual(rows[0], ['คลังข้อสอบ IT Security']);
  assert.deepEqual(rows[1], []);
  assert.deepEqual(rows[2], ['หัวข้อ', 'คำถาม', 'ก', 'ข', 'ค', 'ง', 'คำตอบ', 'คำอธิบาย', 'เวลา']);
  assert.deepEqual(rows[3], ['รหัสผ่าน', 'รหัสผ่านแบบใดปลอดภัยที่สุด', '123456', 'วันเกิด', 'วลียาว & เดายาก <ผสมตัวเลข>', 'ชื่อบริษัท', 'ค', 'บรรทัดแรก\nบรรทัดสอง', '45']);
  assert.deepEqual(rows[4], ['', 'ผลบวก 0.1 + 0.2 เท่ากับเท่าไร', '0.3', '0.5', '1', '2', '1']);
  assert.deepEqual(rows[5], ['', 'ควรเปลี่ยนรหัสผ่านทันทีเมื่อรู้ว่ารั่ว', 'TRUE', 'FALSE', '', '', 'TRUE']);
  assert.equal(rows[6][1], 'ห้าม แชร์รหัสผ่านทางแชต');
  assert.equal(rows[7][0] ?? '', '');
  assert.equal(rows[9][1], 'แถวที่ไม่มีคำตอบ');
  assert.deepEqual(res.sheets[1].rows, [['ทั้งหมด', '5']]);

  const read = readSheets(res.sheets);
  assert.deepEqual(
    read.rounds.map((r) => [r.title, r.questions.map((q) => q.correct)]),
    [
      ['รหัสผ่าน', [[2], [0]]],
      ['ฟิชชิง', [[0], [1]]],
    ],
  );
  assert.equal(read.rounds[0].questions[0].timeLimitS, 45);
  assert.equal(read.rounds[0].questions[1].type, 'truefalse');
  assert.deepEqual(
    read.problems.map((p) => [p.sheet, p.row]),
    [
      ['ความปลอดภัย', 5], // "1": the first option, or the option that reads 1?
      ['ความปลอดภัย', 10],
    ],
  );
  assert.match(read.problems[0].message, /กำกวม/);
  assert.match(read.notes.join(), /ชีต “สรุป”: ข้ามไป/);
});

/** a one-sheet .xlsx written by hand, the way other tools write them: inline strings, no row or cell refs */
function tinyXlsx(sheetXml: string, opts: { encrypted?: boolean; stored?: boolean } = {}) {
  const files: Record<string, string> = {
    '[Content_Types].xml': '<Types/>',
    '_rels/.rels':
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="A &amp; B" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/s1.xml"/></Relationships>',
    'xl/worksheets/s1.xml': sheetXml,
  };
  return zip(files, opts);
}

function zip(files: Record<string, string>, opts: { encrypted?: boolean; stored?: boolean } = {}) {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = opts.stored ? raw : new Uint8Array(deflateRawSync(raw));
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, opts.stored ? 0 : 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, opts.encrypted ? 1 : 0, true);
    cv.setUint16(10, opts.stored ? 0 : 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

test('a hand-written workbook: inline strings, cells without refs, a gap row, an escaped name, stored entries', async () => {
  const xml =
    '<worksheet><sheetData>' +
    '<row><c t="inlineStr"><is><t>คำถาม</t></is></c><c t="inlineStr"><is><t>ก</t></is></c><c t="inlineStr"><is><t>ข</t></is></c><c t="inlineStr"><is><t>คำตอบ</t></is></c></row>' +
    '<row r="3"><c r="A3" t="str"><v>x &lt; y_x000D_</v></c><c r="C3"><v>7</v></c><c r="D3" t="b"><v>1</v></c><c r="E3" t="e"><v>#DIV/0!</v></c></row>' +
    '</sheetData></worksheet>';
  for (const stored of [false, true]) {
    const res = await readSheetBytes(tinyXlsx(xml, { stored }), 'x.xlsx');
    assert.ok(res.ok, !res.ok ? res.error : '');
    assert.equal(res.sheets[0].name, 'A & B');
    assert.deepEqual(res.sheets[0].rows, [['คำถาม', 'ก', 'ข', 'คำตอบ'], [], ['x < y\r', '', '7', 'TRUE', '']]);
  }
});

test('files that are not a readable workbook say what to do', async () => {
  const enc = new TextEncoder();
  const msg = async (bytes: Uint8Array, name: string) => {
    const res = await readSheetBytes(bytes, name);
    assert.equal(res.ok, false);
    return res.ok ? '' : res.error;
  };
  assert.match(await msg(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'old.xls'), /\.xls แบบเก่า/);
  assert.match(await msg(tinyXlsx('<worksheet/>', { encrypted: true }), 'locked.xlsx'), /รหัสผ่าน/);
  assert.match(await msg(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), 'cut.xlsx'), /เสีย/);
  assert.match(await msg(zip({ 'content.xml': '<x/>' }), 'calc.ods'), /\.ods/);
  assert.match(await msg(zip({ 'word/document.xml': '<x/>' }), 'doc.docx'), /ไม่ใช่ไฟล์ Excel/);
  assert.match(await msg(new Uint8Array([1, 0, 2, 0, 3]), 'thing.bin'), /ไม่ใช่ตาราง/);
  assert.match(await msg(enc.encode('a,b'), 'renamed.xlsx'), /ใช้ไฟล์ Excel/);
  // a zip bomb stops at the inflate budget instead of filling memory
  const bomb = tinyXlsx(`<worksheet><sheetData>${'<row/>'.repeat(12_000_000)}</sheetData></worksheet>`);
  assert.ok(bomb.length < 1_000_000);
  assert.match(await msg(bomb, 'bomb.xlsx'), /ใหญ่เกิน/);
});

test('CSV in UTF-8 with a BOM, UTF-16 "Unicode Text", and the Thai code page all read the same', async () => {
  const thai = 'คำถาม,ก,ข,คำตอบ\r\nสีของท้องฟ้า,ฟ้า,แดง,ก\r\n';
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(thai)]);
  const tabbed = thai.replace(/,/g, '\t');
  const utf16 = new Uint8Array(2 + tabbed.length * 2);
  utf16[0] = 0xff;
  utf16[1] = 0xfe;
  for (let i = 0; i < tabbed.length; i++) new DataView(utf16.buffer).setUint16(2 + i * 2, tabbed.charCodeAt(i), true);
  // windows-874 puts Thai at 0xA1 + (code point − U+0E01)
  const tis = new Uint8Array([...thai].map((ch) => (ch.charCodeAt(0) >= 0x0e01 ? ch.charCodeAt(0) - 0x0e01 + 0xa1 : ch.charCodeAt(0))));
  for (const [bytes, name] of [
    [utf8, 'bank.csv'],
    [utf16, 'bank.txt'],
    [tis, 'bank.csv'],
  ] as const) {
    const res = await readSheetBytes(bytes, name);
    assert.ok(res.ok, name);
    assert.equal(res.sheets[0].name, 'bank');
    assert.deepEqual(res.sheets[0].rows, [
      ['คำถาม', 'ก', 'ข', 'คำตอบ'],
      ['สีของท้องฟ้า', 'ฟ้า', 'แดง', 'ก'],
    ]);
  }
  assert.equal(decodeText(new Uint8Array([0x61, 0, 0x62])), null);
});

test('xmlText: entities, character references, Excel escapes, and junk left alone', () => {
  assert.equal(xmlText('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'), `a & b <c> "d" 'e'`);
  assert.equal(xmlText('&#3585;&#x0E02;_x0009_'), 'กข\t');
  assert.equal(xmlText('&nope; &#xFFFFFFF;'), '&nope; &#xFFFFFFF;');
});
