import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readDocBytes, slideXmlText, tidyText, wordXmlText } from './doc-text';

/** the documents a person picks for "ให้ AI ออกข้อสอบ", written by hand the way Word and PowerPoint write them */

function zip(files: Record<string, string>, opts: { encrypted?: boolean } = {}) {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = new Uint8Array(deflateRawSync(raw));
    const nameBytes = enc.encode(name);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, opts.encrypted ? 1 : 0, true);
    cv.setUint16(10, 8, true);
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

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const para = (inner: string, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${inner}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${para(run('นโยบายการลา'), '<w:pStyle w:val="Heading1"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs>')}
${para(`${run('พนักงานลาพักร้อนได้ ')}<w:r><w:rPr><w:b/></w:rPr><w:t>10 วัน</w:t></w:r>${run(' ต่อปี')}<w:r><w:t/></w:r>`)}
${para(`<w:del><w:r><w:delText>ข้อความที่ลบแล้ว</w:delText></w:r></w:del>${run('ต้องแจ้ง &amp; บันทึก &lt;HR&gt;')}`)}
${para(`<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:t>3</w:t></w:r>`)}
${para(`${run('บรรทัดแรก')}<w:r><w:br/></w:r>${run('บรรทัดสอง')}<w:r><w:tab/></w:r>${run('หลังแท็บ')}`)}
<w:tbl><w:tblPr/>
<w:tr><w:tc>${para(run('ประเภท'))}</w:tc><w:tc>${para(run('วัน'))}</w:tc></w:tr>
<w:tr><w:tc>${para(run('ลาป่วย'))}${para(run('มีใบแพทย์'))}</w:tc><w:tc>${para(run('30'))}</w:tc></w:tr>
</w:tbl>
${para(`<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:txbx><w:txbxContent>${para(run('ในกล่องข้อความ'))}</w:txbxContent></wps:txbx></w:drawing></mc:Choice><mc:Fallback><w:pict><v:textbox><w:txbxContent>${para(run('ในกล่องข้อความ'))}</w:txbxContent></v:textbox></w:pict></mc:Fallback></mc:AlternateContent></w:r>`)}
${para('')}${para('')}${para('')}
${para(run('จบ   '))}
<w:sectPr/></w:body></w:document>`;

test('Word: paragraphs in order, a table a row a line, no deleted text, field codes, tab stops or second copies', () => {
  assert.equal(
    tidyText(wordXmlText(DOCUMENT)),
    [
      'นโยบายการลา',
      'พนักงานลาพักร้อนได้ 10 วัน ต่อปี',
      'ต้องแจ้ง & บันทึก <HR>',
      '3',
      'บรรทัดแรก',
      'บรรทัดสอง\tหลังแท็บ',
      'ประเภท\tวัน',
      'ลาป่วย\nมีใบแพทย์\t30',
      'ในกล่องข้อความ',
      '',
      'จบ',
    ].join('\n'),
  );
});

test('a .docx file opens to its text, named after the file', async () => {
  const docx = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': DOCUMENT, 'word/styles.xml': '<w:styles/>' });
  const res = await readDocBytes(docx, 'นโยบาย HR.v2.docx');
  assert.ok(res.ok, !res.ok ? res.error : '');
  assert.equal(res.name, 'นโยบาย HR.v2');
  assert.ok(res.text.startsWith('นโยบายการลา\nพนักงานลาพักร้อนได้ 10 วัน ต่อปี'));
  assert.ok(!res.text.includes('ข้อความที่ลบแล้ว'));
  assert.ok(!res.text.includes('PAGE'));
  assert.equal(res.text.split('ในกล่องข้อความ').length, 2, 'the text box is read once');
});

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const shape = (...paras: string[]) => `<p:sp><p:txBody><a:bodyPr/>${paras.map((t) => `<a:p><a:r><a:rPr lang="th-TH"/><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const slide = (...shapes: string[]) => `<p:sld ${P}><p:cSld><p:spTree>${shapes.join('')}<p:sp><p:txBody><a:p><a:fld id="{1}" type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const rels = (...targets: [string, string][]) =>
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${targets.map(([id, t]) => `<Relationship Id="${id}" Type="x" Target="${t}"/>`).join('')}</Relationships>`;

function pptx(order: string[], withList = true) {
  return zip({
    '[Content_Types].xml': '<Types/>',
    'ppt/presentation.xml': `<p:presentation ${P}>${withList ? `<p:sldIdLst>${order.map((id, i) => `<p:sldId id="${256 + i}" r:id="${id}"/>`).join('')}</p:sldIdLst>` : ''}</p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels(['rId7', 'slides/slide1.xml'], ['rId8', 'slides/slide2.xml'], ['rId9', 'slides/slide3.xml'], ['rId1', 'slideMasters/slideMaster1.xml']),
    'ppt/slides/slide1.xml': slide(shape('ความปลอดภัยของข้อมูล'), shape('รหัสผ่านยาวอย่างน้อย 12 ตัว', 'เปลี่ยนทุก 90 วัน &amp; ห้ามแชร์')),
    'ppt/slides/_rels/slide1.xml.rels': rels(['rId1', '../slideLayouts/slideLayout1.xml'], ['rId2', '../notesSlides/notesSlide1.xml']),
    'ppt/notesSlides/notesSlide1.xml': `<p:notes ${P}><p:cSld><p:spTree>${shape('เน้นเรื่องรหัสผ่านซ้ำ')}</p:spTree></p:cSld></p:notes>`,
    'ppt/slides/slide2.xml': slide(shape('ฟิชชิง'), shape('อย่ากดลิงก์จากอีเมลที่ไม่รู้จัก')),
    // a slide with only a picture and a slide number: nothing to read
    'ppt/slides/slide3.xml': slide('<p:pic/>'),
  });
}

test('PowerPoint: the slides in the order they are shown, with the speaker notes, without slide numbers', async () => {
  const res = await readDocBytes(pptx(['rId8', 'rId7', 'rId9']), 'อบรม.pptx');
  assert.ok(res.ok, !res.ok ? res.error : '');
  assert.equal(res.name, 'อบรม');
  assert.equal(
    res.text,
    [
      '--- สไลด์ 1 ---',
      'ฟิชชิง',
      'อย่ากดลิงก์จากอีเมลที่ไม่รู้จัก',
      '',
      '--- สไลด์ 2 ---',
      'ความปลอดภัยของข้อมูล',
      'รหัสผ่านยาวอย่างน้อย 12 ตัว',
      'เปลี่ยนทุก 90 วัน & ห้ามแชร์',
      '(โน้ตผู้บรรยาย) เน้นเรื่องรหัสผ่านซ้ำ',
    ].join('\n'),
  );
  // a presentation without a slide list: the files' own numbers
  const plain = await readDocBytes(pptx([], false), 'x.pptx');
  assert.ok(plain.ok);
  assert.match(plain.text, /^--- สไลด์ 1 ---\nความปลอดภัยของข้อมูล/);
  assert.equal(slideXmlText('<a:p><a:r><a:t>ก</a:t></a:r><a:br/><a:r><a:t>ข</a:t></a:r></a:p>'), 'ก\nข\n');
});

test('text and Markdown files, in UTF-8 or with a BOM, Windows line endings tidied', async () => {
  const enc = new TextEncoder();
  const res = await readDocBytes(enc.encode('﻿# หัวข้อ\r\n\r\n\r\n\r\nเนื้อหา   \r\nบรรทัดสอง\r\n'), 'บันทึก.md');
  assert.deepEqual(res, { ok: true, text: '# หัวข้อ\n\nเนื้อหา\nบรรทัดสอง', name: 'บันทึก' });
  assert.deepEqual(await readDocBytes(enc.encode(' \n\n '), 'ว่าง.txt'), { ok: false, error: 'ไฟล์นี้ว่างเปล่า' });
});

test('files it cannot read say what to do instead', async () => {
  const say = async (bytes: Uint8Array, name: string) => {
    const r = await readDocBytes(bytes, name);
    assert.equal(r.ok, false, name);
    return r.ok ? '' : r.error;
  };
  const enc = new TextEncoder();
  assert.match(await say(enc.encode('%PDF-1.7\n...'), 'สรุป.pdf'), /PDF.*Ctrl\+A/);
  assert.match(await say(enc.encode('%PDF-1.4'), 'renamed.txt'), /PDF/, 'a PDF is known by its first bytes, not its name');
  assert.match(await say(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), 'old.doc'), /\.docx/);
  assert.match(await say(zip({ 'xl/workbook.xml': '<workbook/>' }), 'bank.xlsx'), /อัปโหลดไฟล์/);
  assert.match(await say(zip({ 'mimetype': 'x', 'content.xml': '<x/>' }), 'a.zip'), /\.docx.*\.pptx/);
  assert.match(await say(zip({ 'word/document.xml': DOCUMENT }, { encrypted: true }), 'locked.docx'), /รหัสผ่าน/);
  assert.match(await say(zip({ 'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>` }), 'pictures.docx'), /อาจมีแต่รูป/);
  const broken = zip({ 'word/document.xml': DOCUMENT }).slice(0, 200);
  assert.match(await say(broken, 'half.docx'), /อาจเสีย/);
  assert.match(await say(enc.encode('not a zip'), 'odd.docx'), /บันทึกเป็น \.docx/);
  assert.match(await say(new Uint8Array([0x00, 0xff, 0xfe, 0x00, 0x01, 0x02, 0x03, 0x00, 0x00]), 'blob.bin'), /ไม่ใช่เอกสาร/);
});
