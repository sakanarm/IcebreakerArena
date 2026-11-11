import { SheetError, decodeText, inflate, readZip, xmlText, type ZipEntry } from './sheet-file';

/**
 * The text of a document, read in the browser, for "ให้ AI ออกข้อสอบ": Word (.docx), PowerPoint (.pptx)
 * with its speaker notes, or plain text and Markdown. Only the text is sent on (the file itself never
 * leaves the machine), which keeps the request small whatever pictures the file holds.
 * PDF is not read here: the person copies its text and pastes it instead.
 */

export const DOC_FILE_MAX_BYTES = 50 * 1024 * 1024;
/** the XML inside may inflate to this much, all told */
const INFLATED_MAX_BYTES = 40 * 1024 * 1024;
const MAX_SLIDES = 400;

export const DOC_ACCEPT = [
  '.docx',
  '.pptx',
  '.txt',
  '.md',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
].join(',');

export type DocText = { ok: true; text: string; name: string } | { ok: false; error: string };

const PDF_HELP = 'ยังอ่านไฟล์ PDF โดยตรงไม่ได้: เปิด PDF กด Ctrl+A แล้ว Ctrl+C คัดลอกข้อความทั้งหมด แล้ววางในช่องข้อความแทน';

export async function readDocFile(file: File): Promise<DocText> {
  if (file.size > DOC_FILE_MAX_BYTES) return { ok: false, error: 'ไฟล์ใหญ่เกิน 50 MB: คัดลอกเฉพาะเนื้อหาที่ต้องการมาวางแทน' };
  return readDocBytes(new Uint8Array(await file.arrayBuffer()), file.name);
}

export async function readDocBytes(bytes: Uint8Array, fileName: string): Promise<DocText> {
  const name = fileName.replace(/\.[^.]+$/, '');
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf') || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) return { ok: false, error: PDF_HELP };
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return { ok: false, error: 'ไฟล์ .doc หรือ .ppt แบบเก่ายังเปิดไม่ได้: บันทึกเป็น .docx หรือ .pptx ก่อน แล้วเลือกใหม่' };
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      const zip = readZip(bytes);
      const budget = { left: INFLATED_MAX_BYTES };
      let text: string;
      if (zip.has('word/document.xml')) text = await docxText(bytes, zip, budget);
      else if (zip.has('ppt/presentation.xml')) text = await pptxText(bytes, zip, budget);
      else if (zip.has('xl/workbook.xml')) return { ok: false, error: 'ไฟล์ Excel ที่มีคำถามอยู่แล้ว ใช้แท็บ “อัปโหลดไฟล์” นำเข้าได้เลย ไม่ต้องให้ AI ออกใหม่' };
      else return { ok: false, error: 'เปิดไฟล์นี้ไม่ได้: ใช้ไฟล์ Word (.docx), PowerPoint (.pptx) หรือข้อความ (.txt, .md)' };
      text = tidyText(text);
      if (!text) return { ok: false, error: 'ไม่พบข้อความในไฟล์นี้ (อาจมีแต่รูป) คัดลอกเนื้อหามาวางแทน' };
      return { ok: true, text, name };
    } catch (e) {
      const kind = e instanceof SheetError ? e.kind : 'other';
      const error =
        kind === 'locked'
          ? 'ไฟล์นี้ตั้งรหัสผ่านไว้: เอารหัสผ่านออกก่อน แล้วเลือกใหม่'
          : kind === 'big'
            ? 'ไฟล์นี้มีข้อความมากเกินไป คัดลอกเฉพาะส่วนที่ต้องการมาวางแทน'
            : 'เปิดไฟล์นี้ไม่ได้ อาจเสียหรือยังบันทึกไม่เสร็จ ลองบันทึกใหม่ หรือคัดลอกเนื้อหามาวางแทน';
      return { ok: false, error };
    }
  }
  if (/\.(docx?|pptx?|odt|odp|pages|key|rtf)$/.test(lower)) return { ok: false, error: 'เปิดไฟล์นี้ไม่ได้: บันทึกเป็น .docx หรือ .pptx ก่อน หรือคัดลอกเนื้อหามาวางแทน' };
  const text = decodeText(bytes);
  if (text === null) return { ok: false, error: 'ไฟล์นี้ไม่ใช่เอกสารที่อ่านได้: ใช้ .docx, .pptx, .txt หรือ .md' };
  const tidy = tidyText(text);
  if (!tidy) return { ok: false, error: 'ไฟล์นี้ว่างเปล่า' };
  return { ok: true, text: tidy, name };
}

/** line endings, trailing spaces and runs of blank lines; the words stay as they are */
export function tidyText(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function entryText(bytes: Uint8Array, zip: Map<string, ZipEntry>, path: string, budget: { left: number }): Promise<string | null> {
  const entry = zip.get(path);
  return entry ? inflate(bytes, entry, budget) : null;
}

/** a text box or shape newer apps can draw is stored twice, the copy for older apps in mc:Fallback */
function withoutFallbacks(xml: string): string {
  return xml.replace(/<mc:Fallback\b[^>]*>[\s\S]*?<\/mc:Fallback>/g, '');
}

// ---------- Word ----------

/** the body's paragraphs in order; a table becomes one line a row, its cells split by tabs */
export function wordXmlText(xml: string): string {
  const body = withoutFallbacks(xml)
    // deleted text, field codes, and tab-stop settings (a <w:tab/> there is not a tab in the text)
    .replace(/<w:(delText|instrText|tabs)\b[^>]*>[\s\S]*?<\/w:\1>/g, '');
  let out = '';
  // an empty <w:t/> matches nothing here, so it adds nothing
  const token = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>|<\/w:(p|tc|tr)>/g;
  for (let m = token.exec(body); m; m = token.exec(body)) {
    const [, text, mark, end] = m;
    if (text !== undefined) out += xmlText(text);
    else if (mark === 'tab') out += '\t';
    else if (mark) out += '\n';
    else if (end === 'tc') out = `${out.replace(/\n+$/, '')}\t`;
    else if (end) out += '\n';
  }
  return out.replace(/\t+\n/g, '\n');
}

async function docxText(bytes: Uint8Array, zip: Map<string, ZipEntry>, budget: { left: number }): Promise<string> {
  return wordXmlText((await entryText(bytes, zip, 'word/document.xml', budget)) ?? '');
}

// ---------- PowerPoint ----------

/** a slide's (or notes page's) text, a line a paragraph; slide numbers and dates are fields, left out */
export function slideXmlText(xml: string): string {
  const body = withoutFallbacks(xml).replace(/<a:fld\b[^>]*>[\s\S]*?<\/a:fld>/g, '');
  let out = '';
  const token = /<a:t>([^<]*)<\/a:t>|<a:br\b[^>]*\/>|<\/a:p>/g;
  for (let m = token.exec(body); m; m = token.exec(body)) out += m[1] !== undefined ? xmlText(m[1]) : '\n';
  return out;
}

/** a relationships file as id → target, the target resolved against the folder of the part it belongs to */
function relationships(xml: string, folder: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target && !/TargetMode="External"/.test(m[0])) map.set(id, resolvePath(folder, xmlText(target)));
  }
  return map;
}

function resolvePath(folder: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = folder ? folder.split('/') : [];
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

async function pptxText(bytes: Uint8Array, zip: Map<string, ZipEntry>, budget: { left: number }): Promise<string> {
  // the order the slides are shown in, from the presentation itself; the files' own numbers otherwise
  const presentation = (await entryText(bytes, zip, 'ppt/presentation.xml', budget)) ?? '';
  const presRels = relationships((await entryText(bytes, zip, 'ppt/_rels/presentation.xml.rels', budget)) ?? '', 'ppt');
  let slides = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => presRels.get(m[1]!)).filter((p): p is string => !!p && zip.has(p));
  if (slides.length === 0) {
    const num = (p: string) => Number(/(\d+)\.xml$/.exec(p)?.[1] ?? 0);
    slides = [...zip.keys()].filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p)).sort((a, b) => num(a) - num(b));
  }
  const parts: string[] = [];
  for (const [i, path] of slides.slice(0, MAX_SLIDES).entries()) {
    const text = slideXmlText((await entryText(bytes, zip, path, budget)) ?? '').trim();
    const folder = path.slice(0, path.lastIndexOf('/'));
    const rels = relationships((await entryText(bytes, zip, `${folder}/_rels/${path.slice(folder.length + 1)}.rels`, budget)) ?? '', folder);
    const notesPath = [...rels.values()].find((t) => /notesSlides\/notesSlide\d+\.xml$/.test(t));
    const notes = notesPath ? slideXmlText((await entryText(bytes, zip, notesPath, budget)) ?? '').trim() : '';
    if (!text && !notes) continue;
    parts.push([`--- สไลด์ ${i + 1} ---`, text, notes ? `(โน้ตผู้บรรยาย) ${notes}` : ''].filter(Boolean).join('\n'));
  }
  return parts.join('\n\n');
}
