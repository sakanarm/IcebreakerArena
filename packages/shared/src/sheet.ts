import type { Game, Question, Round } from './types';
import { LIMITS, validateGame } from './validate';

/**
 * A question bank typed in a spreadsheet: one question per row, under a header row such as
 *   หัวข้อ | คำถาม | ก | ข | ค | ง | คำตอบ | คำอธิบาย
 * Excel, Google Sheets and CSV files all come down to rows of text cells (the web app reads the
 * file); this turns the rows into rounds, and says which rows could not be used and why, so the
 * person can fix them in the sheet instead of losing them without a word.
 */

/** one sheet of a workbook, or the whole of a CSV file or a paste */
export interface SheetIn {
  name: string;
  rows: string[][];
}

export interface SheetProblem {
  /** set when the workbook had more than one sheet with questions */
  sheet?: string;
  /** the row number the spreadsheet shows, from 1 */
  row: number;
  message: string;
}

export interface SheetRead {
  /** every row that made a question, grouped by topic in the order the topics first appear */
  rounds: Round[];
  /** how many questions that is */
  count: number;
  /** rows that were skipped, one entry per row */
  problems: SheetProblem[];
  /** whole sheets that were skipped, and other things worth knowing */
  notes: string[];
}

/** the most option columns a row may fill; a game question takes four */
const OPTION_LETTERS = { th: 'กขคงจฉ', en: 'abcdef' } as const;
const DEFAULT_TIME_S = 30;
/** where to look for the header row: a title or a note may sit above it */
const HEADER_SCAN_ROWS = 20;

// ---------- CSV ----------

/**
 * Reads CSV or tab-separated text (RFC 4180 quoting). Excel saves CSV with commas or, where the
 * comma is the decimal mark, semicolons; copying cells out of Excel or Google Sheets gives tabs.
 * The separator is the one of the three that the first line uses most.
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const sep = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
    } else cell += ch;
    i++;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function detectSeparator(text: string): string {
  const counts: Record<string, number> = { '\t': 0, ',': 0, ';': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (counts['\t'] + counts[','] + counts[';'] > 0) break;
    } else if (!quoted && ch in counts) counts[ch]++;
  }
  if (counts['\t'] > 0) return '\t';
  return counts[';'] > counts[','] ? ';' : ',';
}

// ---------- the header row ----------

type Field = 'topic' | 'prompt' | 'answer' | 'explanation' | 'image' | 'time';

const FIELD_NAMES: Record<Field, string[]> = {
  topic: ['หัวข้อ', 'หมวด', 'หมวดหมู่', 'ด่าน', 'บท', 'เรื่อง', 'ชุด', 'topic', 'category', 'section', 'round', 'chapter', 'subject'],
  prompt: ['คำถาม', 'โจทย์', 'โจทย์คำถาม', 'ข้อคำถาม', 'question', 'prompt', 'questiontext'],
  answer: ['คำตอบ', 'เฉลย', 'คำตอบที่ถูก', 'คำตอบที่ถูกต้อง', 'คำตอบถูก', 'ข้อที่ถูก', 'answer', 'answers', 'correct', 'correctanswer', 'key', 'answerkey'],
  explanation: ['คำอธิบาย', 'อธิบาย', 'คำอธิบายเฉลย', 'อธิบายเฉลย', 'เหตุผล', 'explanation', 'explain', 'why', 'rationale', 'reason'],
  image: ['รูป', 'รูปภาพ', 'ภาพ', 'ลิงก์รูป', 'ลิงค์รูป', 'image', 'imageurl', 'picture', 'img'],
  time: ['เวลา', 'เวลาวินาที', 'วินาที', 'time', 'timesec', 'timeseconds', 'timelimit', 'timelimitsec', 'seconds', 'sec'],
};

/** lower case, no spaces or punctuation, no "ที่": "ตัวเลือกที่ 1" → "ตัวเลือก1", "A." → "a" */
const headerKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/ที่/g, '')
    .replace(/[\s._:;()[\]{}<>#*\-–—/\\|"'`]+/g, '');

const OPTION_WORDS = ['ตัวเลือก', 'ตัวเลือกข้อ', 'ข้อ', 'choice', 'choices', 'option', 'options'];
const GENERIC_OPTION = new Set(['ตัวเลือก', 'choice', 'choices', 'option', 'options']);

/** 0-based position of an option column ("ก", "B", "ตัวเลือก 3", "option c"), or 'next' for a bare "ตัวเลือก" */
function optionColumn(key: string): number | 'next' | null {
  if (GENERIC_OPTION.has(key)) return 'next';
  for (const word of ['', ...OPTION_WORDS]) {
    if (!key.startsWith(word)) continue;
    const rest = key.slice(word.length);
    if (rest.length !== 1) continue;
    const pos = letterPosition(rest);
    if (pos !== null) return pos;
  }
  return null;
}

/** ก–ฉ, a–f, 1–6 → 0–5 */
function letterPosition(ch: string): number | null {
  const lower = ch.toLowerCase();
  let at: number = OPTION_LETTERS.th.indexOf(lower);
  if (at < 0) at = OPTION_LETTERS.en.indexOf(lower);
  if (at < 0 && /^[1-6]$/.test(lower)) at = Number(lower) - 1;
  return at >= 0 ? at : null;
}

interface Header {
  row: number;
  fields: Partial<Record<Field, number>>;
  /** column of each option position; a gap means the sheet skipped that letter */
  options: number[];
}

function readHeader(cells: string[]): Header | { missing: string[] } | null {
  const fields: Partial<Record<Field, number>> = {};
  const options: number[] = [];
  cells.forEach((cell, col) => {
    const key = headerKey(cell);
    if (!key) return;
    const field = (Object.keys(FIELD_NAMES) as Field[]).find((f) => FIELD_NAMES[f].some((name) => headerKey(name) === key));
    if (field) {
      if (fields[field] === undefined) fields[field] = col;
      return;
    }
    const at = optionColumn(key);
    if (at === null) return;
    const pos = at === 'next' ? options.length : at;
    if (options[pos] === undefined) options[pos] = col;
  });
  const optionCount = options.filter((c) => c !== undefined).length;
  if (fields.prompt === undefined) return null;
  const missing = [
    ...(optionCount < 2 ? ['คอลัมน์ตัวเลือก (ก ข ค ง)'] : []),
    ...(fields.answer === undefined ? ['คอลัมน์คำตอบ'] : []),
  ];
  if (missing.length) return { missing };
  return { row: 0, fields, options };
}

// ---------- answers ----------

const TRUE_WORDS = ['จริง', 'ถูก', 'ใช่', 'true', 't', 'yes', 'y', '✓', '✔'];
const FALSE_WORDS = ['เท็จ', 'ผิด', 'ไม่ใช่', 'false', 'f', 'no', 'n', '✗', '✘', 'x'];
const truthOf = (s: string): boolean | null => {
  const k = s.trim().toLowerCase();
  if (TRUE_WORDS.includes(k)) return true;
  if (FALSE_WORDS.includes(k)) return false;
  return null;
};

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "ข้อ ข", "(B)", "ค.", "3" → the bare letter or digit; anything else comes back as it was */
function bareLetter(token: string): string {
  return token
    .trim()
    .replace(/^(ตัวเลือก|ข้อ|choice|option)\s*(ที่)?\s*/i, '')
    .replace(/^[([]\s*/, '')
    .replace(/\s*[)\].]$/, '')
    .trim();
}

type AnswerResult = { columns: number[] } | { error: string };

/**
 * Which option columns an answer cell means. Letters and numbers count by position (ก/A/1 is the
 * first option); an answer can also be the right option's own words. Several right answers are
 * separated by commas, slashes or "และ". When the same cell could mean two different options —
 * "4" for the fourth option, while another option reads "4" — the row is refused rather than guessed.
 */
function readAnswer(cell: string, options: string[]): AnswerResult {
  const raw = cell.trim();
  if (!raw) return { error: 'ยังไม่ได้ใส่คำตอบ' };
  const one = readToken(raw, options);
  if (!('error' in one)) return { columns: [one.column] };
  if (one.ambiguous) return { error: one.error };

  const tokens = raw
    .split(/\s*(?:,|，|、|;|\/|\+|&|และ|\band\b)\s*/i)
    .map((t) => t.trim())
    .filter(Boolean);
  // "ก ข" and "A C": letters with only spaces between them
  const spaced = tokens.length === 1 ? raw.split(/\s+/).filter(Boolean) : [];
  const parts = spaced.length > 1 && spaced.every((t) => letterPosition(bareLetter(t)) !== null) ? spaced : tokens;
  if (parts.length < 2) return { error: one.error };
  const columns: number[] = [];
  for (const part of parts) {
    const res = readToken(part, options);
    if ('error' in res) return { error: res.error };
    columns.push(res.column);
  }
  return { columns: [...new Set(columns)] };
}

function readToken(token: string, options: string[]): { column: number } | { error: string; ambiguous?: true } {
  const text = byText(token, options);
  const letter = bareLetter(token);
  const pos = letter.length === 1 ? letterPosition(letter) : null;
  if (pos !== null && text !== null && pos !== text) return { error: ambiguous(token, pos, text), ambiguous: true };
  if (pos !== null) {
    if (!options[pos]?.trim()) return { error: `คำตอบ “${token}” ชี้ไปที่ตัวเลือกที่ ${pos + 1} ซึ่งว่างอยู่` };
    return { column: pos };
  }
  if (text !== null) return { column: text };
  return { error: `อ่านคำตอบ “${token}” ไม่ออก: ใส่เป็น ก ข ค ง (หรือ A B C D, 1 2 3 4) หรือพิมพ์ให้ตรงกับตัวเลือก` };
}

function byText(token: string, options: string[]): number | null {
  const at = options.findIndex((o) => o.trim() !== '' && sameText(o, token));
  return at >= 0 ? at : null;
}

const ambiguous = (token: string, pos: number, text: number) =>
  `คำตอบ “${token}” กำกวม: เป็นได้ทั้งตัวเลือกที่ ${pos + 1} และตัวเลือกที่ ${text + 1} ที่เขียนว่า “${token}” ` +
  `ใส่เป็นตัวอักษร (เช่น ${OPTION_LETTERS.th[pos]}) หรือข้อความของตัวเลือกให้ชัดเจน`;

// ---------- rows → questions ----------

const cellAt = (row: string[], col: number | undefined) => (col === undefined ? '' : (row[col] ?? '').trim());

function readQuestion(row: string[], header: Header): Question | { error: string } {
  const prompt = cellAt(row, header.fields.prompt);
  const columns = header.options.map((col) => cellAt(row, col));
  if (!prompt) return { error: 'ยังไม่มีคำถาม' };
  if (prompt.length > LIMITS.promptMax) return { error: `คำถามยาว ${prompt.length} ตัวอักษร เกิน ${LIMITS.promptMax}` };

  const filled = columns.map((o, i) => [o, i] as const).filter(([o]) => o !== '');
  if (filled.length < 2) return { error: 'ต้องมีตัวเลือกอย่างน้อย 2 ข้อ' };
  if (filled.length > 4) return { error: `มีตัวเลือก ${filled.length} ข้อ เกม 1 ข้อมีได้ไม่เกิน 4 ตัวเลือก` };
  const long = filled.find(([o]) => o.length > LIMITS.optionMax);
  if (long) return { error: `ตัวเลือกที่ ${long[1] + 1} ยาว ${long[0].length} ตัวอักษร เกิน ${LIMITS.optionMax}` };
  for (let a = 0; a < filled.length; a++) {
    for (let b = a + 1; b < filled.length; b++) {
      if (sameText(filled[a][0], filled[b][0])) return { error: `ตัวเลือกที่ ${filled[a][1] + 1} กับ ${filled[b][1] + 1} เหมือนกัน` };
    }
  }

  const answerCell = cellAt(row, header.fields.answer);
  // a true/false pair, by its words: "จริง/เท็จ", "ถูก/ผิด", "True/False" in either order
  const truths = filled.map(([o]) => truthOf(o));
  const trueFalse = filled.length === 2 && truths[0] !== null && truths[1] !== null && truths[0] !== truths[1];
  let picked: number[];
  const said = trueFalse ? truthOf(answerCell) : null;
  if (said !== null) {
    picked = [filled[truths.indexOf(said)][1]];
  } else {
    const res = readAnswer(answerCell, columns);
    if ('error' in res) return { error: res.error };
    picked = res.columns;
  }

  const explanation = cellAt(row, header.fields.explanation);
  if (explanation.length > LIMITS.explanationMax) {
    return { error: `คำอธิบายยาว ${explanation.length} ตัวอักษร เกิน ${LIMITS.explanationMax}` };
  }
  const imageUrl = cellAt(row, header.fields.image);
  if (imageUrl && !/^https:\/\/\S+$/.test(imageUrl)) return { error: 'ลิงก์รูปต้องขึ้นต้นด้วย https://' };
  if (imageUrl.length > LIMITS.imageUrlMax) return { error: `ลิงก์รูปยาวเกิน ${LIMITS.imageUrlMax} ตัวอักษร` };
  const timeCell = cellAt(row, header.fields.time);
  let timeLimitS = DEFAULT_TIME_S;
  if (timeCell) {
    const t = Number(timeCell.replace(/\s*(วินาที|วิ|s|sec|seconds?)$/i, ''));
    if (!Number.isInteger(t) || t < LIMITS.timeMinS || t > LIMITS.timeMaxS) {
      return { error: `เวลา “${timeCell}” ต้องเป็นเลขวินาที ${LIMITS.timeMinS}–${LIMITS.timeMaxS}` };
    }
    timeLimitS = t;
  }

  // true first, so a true/false question looks the same as one made in the editor
  const order = trueFalse && truths[0] === false ? [filled[1], filled[0]] : filled;
  const options = order.map(([o]) => o);
  const correct = order.map(([, col], i) => (picked.includes(col) ? i : -1)).filter((i) => i >= 0);
  return {
    id: '',
    type: trueFalse ? 'truefalse' : 'quiz',
    prompt,
    options,
    correct,
    timeLimitS,
    ...(imageUrl ? { imageUrl } : {}),
    ...(explanation ? { explanation } : {}),
  };
}

/** a sheet nobody named, so its name says nothing about the questions in it */
const isDefaultSheetName = (name: string) => /^(sheet|ชีต|แผ่นงาน|worksheet|feuil|tabelle|hoja)\s*\d*$/i.test(name.trim()) || !name.trim();

/**
 * Turns sheets into rounds of questions. A topic column makes one round per topic, in the order the
 * topics first appear; a blank topic carries on the one above it, the way a merged cell reads. With
 * no topic column, each sheet that has questions is a round named after the sheet.
 */
export function readSheets(sheets: SheetIn[]): SheetRead {
  const problems: SheetProblem[] = [];
  const notes: string[] = [];
  const rounds = new Map<string, Question[]>();
  const used = sheets.filter((s) => s.rows.some((r) => r.some((c) => c.trim())));
  const many = used.length > 1;

  for (const sheet of used) {
    let header: Header | null = null;
    let missing: string[] | null = null;
    for (let r = 0; r < Math.min(sheet.rows.length, HEADER_SCAN_ROWS) && !header; r++) {
      const found = readHeader(sheet.rows[r]);
      if (found && 'missing' in found) missing ??= found.missing;
      else if (found) header = { ...found, row: r };
    }
    const label = many ? `ชีต “${sheet.name}”: ` : '';
    if (!header) {
      notes.push(
        missing
          ? `${label}ข้ามไป เพราะไม่มี${missing.join(' และ ')}`
          : `${label}ข้ามไป เพราะไม่พบแถวหัวตาราง (ต้องมีคอลัมน์ คำถาม, ก, ข, ค, ง และ คำตอบ)`,
      );
      continue;
    }
    const fallbackTopic = many && !isDefaultSheetName(sheet.name) ? sheet.name.trim() : many ? `ชีต ${sheet.name.trim()}` : 'คำถามทั้งหมด';
    let topic = '';
    let added = 0;
    for (let r = header.row + 1; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      if (!row.some((c) => c.trim())) continue;
      const topicCell = cellAt(row, header.fields.topic);
      if (topicCell) topic = topicCell.slice(0, LIMITS.titleMax);
      const q = readQuestion(row, header);
      if ('error' in q) {
        problems.push({ ...(many ? { sheet: sheet.name } : {}), row: r + 1, message: q.error });
        continue;
      }
      const key = topic || fallbackTopic;
      if (!rounds.has(key)) rounds.set(key, []);
      rounds.get(key)!.push(q);
      added++;
    }
    if (added === 0 && !problems.some((p) => p.sheet === sheet.name || !many)) {
      notes.push(`${label}มีหัวตารางแต่ยังไม่มีคำถามใต้หัวตาราง`);
    }
  }
  if (used.length === 0) notes.push('ไฟล์นี้ว่างเปล่า');

  const list: Round[] = [...rounds.entries()].map(([title, questions], i) => ({
    id: `r${i + 1}`,
    title,
    questions: questions.map((q, j) => ({ ...q, id: `q${i + 1}-${j + 1}` })),
  }));
  return { rounds: list, count: list.reduce((n, r) => n + r.questions.length, 0), problems, notes };
}

// ---------- rounds → games ----------

export interface SheetGameOptions {
  title: string;
  description?: string;
  /** make each round a question bank that asks this many at random, when it has more */
  draw?: number;
}

export type SheetGames = { ok: true; games: Game[] } | { ok: false; errors: string[] };

/**
 * The rounds as games ready to save. A bank bigger than one game may hold (100 questions, 20
 * rounds) is split into parts, "ชื่อ (ชุดที่ 1/3)", each a whole game of its own; a round that does
 * not fit is split with it, keeping its title.
 */
export function sheetGames(rounds: Round[], opts: SheetGameOptions): SheetGames {
  const title = opts.title.trim();
  const parts: Round[][] = [[]];
  let inPart = 0;
  for (const round of rounds) {
    let rest = round.questions;
    while (rest.length > 0) {
      let part = parts[parts.length - 1];
      if (inPart >= LIMITS.questionsMax || part.length >= LIMITS.roundsMax) {
        part = [];
        parts.push(part);
        inPart = 0;
      }
      const take = rest.slice(0, LIMITS.questionsMax - inPart);
      rest = rest.slice(take.length);
      const draw = opts.draw && take.length > opts.draw ? opts.draw : undefined;
      part.push({ id: '', title: round.title, ...(draw ? { draw } : {}), questions: take });
      inPart += take.length;
    }
  }
  if (parts[0].length === 0) return { ok: false, errors: ['ยังไม่มีคำถามที่นำเข้าได้'] };
  const suffix = (i: number) => (parts.length > 1 ? ` (ชุดที่ ${i + 1}/${parts.length})` : '');
  const room = LIMITS.titleMax - suffix(parts.length - 1).length;
  const games: Game[] = [];
  const errors: string[] = [];
  parts.forEach((part, i) => {
    const res = validateGame({
      id: 'import',
      title: `${title.slice(0, room)}${suffix(i)}`,
      ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
      rounds: part,
      settings: { streakBonus: false },
    });
    if (res.ok) games.push(res.game);
    else errors.push(...res.errors.map((e) => (parts.length > 1 ? `ชุดที่ ${i + 1}: ${e}` : e)));
  });
  return errors.length ? { ok: false, errors } : { ok: true, games };
}

/** the header and two example rows of the template people download */
export const SHEET_TEMPLATE: string[][] = [
  ['หัวข้อ', 'คำถาม', 'ก', 'ข', 'ค', 'ง', 'คำตอบ', 'คำอธิบาย'],
  ['ความปลอดภัย', 'รหัสผ่านแบบใดปลอดภัยที่สุด', '123456', 'วันเกิดของเรา', 'วลียาวที่เดายากผสมตัวเลข', 'ชื่อบริษัท', 'ค', 'วลียาวที่คนอื่นเดาไม่ได้ เดาด้วยโปรแกรมก็ยาก'],
  ['ความปลอดภัย', 'ได้อีเมลขอให้ยืนยันรหัสผ่านด่วน ควรทำอย่างไร', 'กดลิงก์แล้วกรอกเลย', 'ตอบกลับพร้อมรหัสผ่าน', 'แจ้งทีม IT ว่าอาจเป็นฟิชชิง', 'ส่งต่อให้เพื่อน', 'ค', 'อีเมลเร่งให้กรอกรหัสผ่านมักเป็นฟิชชิง แจ้ง IT ให้ตรวจสอบ'],
  ['ทั่วไป', 'ข้อใดเป็นจำนวนเฉพาะ', '9', '15', '17', '21', 'ค', '17 หารลงตัวได้แค่ 1 กับตัวเอง'],
  ['ทั่วไป', 'โลกหมุนรอบดวงอาทิตย์', 'จริง', 'เท็จ', '', '', 'จริง', ''],
];
