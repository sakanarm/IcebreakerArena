import { parseCsv, type SheetIn } from '@pika-arena/shared';

/**
 * Opens a question bank file in the browser: Excel (.xlsx), CSV or tab-separated text. Nothing is
 * uploaded to read it, and no library is needed: an .xlsx is a zip of XML files, and the browser
 * inflates zip entries itself (DecompressionStream).
 */

export const SHEET_FILE_MAX_BYTES = 5 * 1024 * 1024;
/** what the XML inside may inflate to, all told: a zip bomb stops here */
const INFLATED_MAX_BYTES = 60 * 1024 * 1024;
/** a sheet bigger than this is not a question bank */
const MAX_ROWS = 5000;
const MAX_COLS = 50;

export type SheetFile = { ok: true; sheets: SheetIn[] } | { ok: false; error: string };

export const SHEET_ACCEPT = '.xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

export async function readSheetFile(file: File): Promise<SheetFile> {
  if (file.size > SHEET_FILE_MAX_BYTES) return { ok: false, error: 'ไฟล์ใหญ่เกิน 5 MB: คลังคำถามไม่ควรใหญ่ขนาดนี้ ลองลบรูปหรือชีตที่ไม่ใช้ออก' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readSheetBytes(bytes, file.name);
}

export async function readSheetBytes(bytes: Uint8Array, name: string): Promise<SheetFile> {
  const lower = name.toLowerCase();
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    try {
      return { ok: true, sheets: await readXlsx(bytes) };
    } catch (e) {
      return { ok: false, error: e instanceof SheetError ? e.message : 'เปิดไฟล์ Excel นี้ไม่ได้ ลองบันทึกใหม่เป็น .xlsx หรือ .csv' };
    }
  }
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return { ok: false, error: 'ไฟล์ .xls แบบเก่ายังเปิดไม่ได้: ใน Excel เลือก File → Save As → Excel Workbook (.xlsx) แล้วอัปโหลดใหม่' };
  }
  if (/\.(xlsx|xlsm|ods|numbers|xls)$/.test(lower)) {
    return { ok: false, error: 'เปิดไฟล์นี้ไม่ได้: ใช้ไฟล์ Excel (.xlsx) หรือ CSV' };
  }
  const text = decodeText(bytes);
  if (text === null) return { ok: false, error: 'ไฟล์นี้ไม่ใช่ตาราง: ใช้ไฟล์ Excel (.xlsx) หรือ CSV' };
  return { ok: true, sheets: [{ name: name.replace(/\.[^.]+$/, '') || 'ไฟล์', rows: trim(parseCsv(text)) }] };
}

/**
 * CSV from Excel comes in UTF-8 ("CSV UTF-8"), UTF-16 ("Unicode Text", tab-separated) or, from a
 * Thai Windows saving plain "CSV", the Thai code page. Anything with NUL bytes after that is binary.
 */
export function decodeText(bytes: Uint8Array): string | null {
  let text: string;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le').decode(bytes.subarray(2));
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be').decode(bytes.subarray(2));
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-874').decode(bytes);
    }
  }
  return text.includes('\u0000') ? null : text;
}

const trim = (rows: string[][]) => rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS));

/** what went wrong opening a zip, so a Word or PowerPoint reader (doc-text.ts) can say it in its own words */
export type ZipProblem = 'broken' | 'locked' | 'big' | 'method' | 'other';

export class SheetError extends Error {
  constructor(
    message: string,
    readonly kind: ZipProblem = 'other',
  ) {
    super(message);
  }
}

// ---------- zip ----------

export interface ZipEntry {
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

export function readZip(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // the end-of-central-directory record sits in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new SheetError('ไฟล์ Excel นี้เสียหรือยังบันทึกไม่เสร็จ ลองบันทึกใหม่', 'broken');
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const utf8 = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) throw new SheetError('ไฟล์ Excel นี้เสีย ลองบันทึกใหม่', 'broken');
    const flags = view.getUint16(at + 8, true);
    if (flags & 1) throw new SheetError('ไฟล์นี้ตั้งรหัสผ่านไว้: เอารหัสผ่านออกใน Excel ก่อน แล้วอัปโหลดใหม่', 'locked');
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new SheetError('ไฟล์ Excel นี้เสีย ลองบันทึกใหม่', 'broken');
    const offset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    entries.set(name.replace(/^\//, ''), { method, compressed, size, offset });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function inflate(bytes: Uint8Array, entry: ZipEntry, budget: { left: number }): Promise<string> {
  if (entry.size > budget.left) throw new SheetError('ไฟล์นี้ใหญ่เกินกว่าจะเป็นคลังคำถาม', 'big');
  const data = bytes.subarray(entry.offset, entry.offset + entry.compressed);
  let out: Uint8Array;
  if (entry.method === 0) out = data;
  else if (entry.method === 8) {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      // the size in the directory can lie; count what actually comes out
      if (total > budget.left) {
        await reader.cancel();
        throw new SheetError('ไฟล์นี้ใหญ่เกินกว่าจะเป็นคลังคำถาม', 'big');
      }
      chunks.push(value);
    }
    out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
  } else throw new SheetError('ไฟล์ Excel นี้บีบอัดแบบที่เปิดไม่ได้ ลองบันทึกใหม่เป็น .xlsx', 'method');
  budget.left -= out.length;
  return new TextDecoder().decode(out);
}

// ---------- xlsx ----------

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** XML text: entities, character references, and Excel's own _x000D_ escapes */
export function xmlText(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ref: string) => {
      if (ref[0] === '#') {
        const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return XML_ENTITIES[ref] ?? m;
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? xmlText(m[2] ?? m[3] ?? '') : undefined;
};

/** the text of a shared string or an inline string: every <t>, rich-text runs included, but not the phonetic guide */
function stringItem(xml: string): string {
  const plain = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of plain.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += xmlText(m[1] ?? '');
  return out;
}

/** "BC12" → column 54 (0-based), row 11 (0-based) */
function cellRef(ref: string): [number, number] | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return [col - 1, Number(m[2]) - 1];
}

/** numbers as a person typed them: 0.30000000000000004 → 0.3 */
function numberText(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(Number(n.toPrecision(15))) : v;
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let nextRow = 0;
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = attr(rm[1], 'r');
    const rowAt = r ? Number(r) - 1 : nextRow;
    nextRow = rowAt + 1;
    if (rowAt >= MAX_ROWS) break;
    const cells: string[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = (ref ? cellRef(ref)?.[0] : undefined) ?? nextCol;
      nextCol = col + 1;
      if (col >= MAX_COLS) continue;
      const type = attr(cm[1], 't') ?? 'n';
      const inner = cm[2] ?? '';
      const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = '';
      if (type === 's') text = v !== undefined ? (shared[Number(v)] ?? '') : '';
      else if (type === 'inlineStr') text = stringItem(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? '');
      else if (type === 'b') text = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else if (type === 'e') text = '';
      else if (type === 'str') text = v !== undefined ? xmlText(v) : '';
      else text = v !== undefined ? numberText(xmlText(v)) : '';
      while (cells.length < col) cells.push('');
      cells[col] = text;
    }
    while (rows.length < rowAt) rows.push([]);
    rows[rowAt] = cells;
  }
  return rows;
}

/** resolves a relationship target against the folder of the part that points to it */
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

async function readXlsx(bytes: Uint8Array): Promise<SheetIn[]> {
  const zip = readZip(bytes);
  const budget = { left: INFLATED_MAX_BYTES };
  const part = async (path: string) => {
    const entry = zip.get(path);
    return entry ? inflate(bytes, entry, budget) : null;
  };
  // the workbook is wherever the package's own relationships say it is
  const rootRels = (await part('_rels/.rels')) ?? '';
  const officeDoc = [...rootRels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((t) => (attr(t, 'Type') ?? '').endsWith('/officeDocument'));
  const workbookPath = officeDoc ? resolve('', attr(officeDoc, 'Target') ?? '') : 'xl/workbook.xml';
  const workbook = await part(workbookPath);
  if (workbook === null) {
    if (zip.has('content.xml')) throw new SheetError('ไฟล์ OpenDocument (.ods) ยังเปิดไม่ได้: บันทึกเป็น .xlsx หรือ .csv ก่อน');
    throw new SheetError('ไฟล์นี้ไม่ใช่ไฟล์ Excel (.xlsx)');
  }
  const relsPath = resolve(workbookPath, `_rels/${workbookPath.split('/').pop()}.rels`);
  const rels = new Map<string, { target: string; type: string }>();
  for (const m of ((await part(relsPath)) ?? '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    if (id) rels.set(id, { target: resolve(workbookPath, attr(m[0], 'Target') ?? ''), type: attr(m[0], 'Type') ?? '' });
  }
  const sharedPath = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target ?? resolve(workbookPath, 'sharedStrings.xml');
  const sharedXml = (await part(sharedPath)) ?? '';
  const shared = [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\s*\/>/g)].map((m) => stringItem(m[1] ?? ''));

  const sheets: SheetIn[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = m[0];
    const state = attr(tag, 'state');
    if (state === 'hidden' || state === 'veryHidden') continue;
    const rid = attr(tag, 'r:id') ?? /\s[\w]+:id\s*=\s*"([^"]*)"/.exec(tag)?.[1];
    const target = rid ? rels.get(rid) : undefined;
    // chart sheets and dialog sheets have no cells
    if (!target || !target.type.endsWith('/worksheet')) continue;
    const xml = await part(target.target);
    if (xml === null) continue;
    sheets.push({ name: attr(tag, 'name') ?? `ชีต ${sheets.length + 1}`, rows: sheetRows(xml, shared) });
  }
  if (sheets.length === 0) throw new SheetError('ไม่พบชีตที่มีข้อมูลในไฟล์นี้');
  return sheets;
}
