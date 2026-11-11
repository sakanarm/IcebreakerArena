/**
 * Turning facts from the knowledge base into questions, by rule and without a model.
 *
 * Why rules at all, when a model writes nicer Thai: a model asked to make questions from a page
 * writes four-option questions almost every time, invents the three wrong ones, and has to be
 * believed about where each answer came from. These rules pick the type from the shape of the
 * sentence, never write a word of their own, and keep every question pinned to the bullet it
 * came from — so what a person reviews is the page's own wording, not a paraphrase of it.
 *
 *   one clear number        → slider, with the number blanked out
 *   "X คือ Y"               → type the answer, with X blanked out
 *   a term and three others → quiz, the wrong tiles being real terms from the other facts
 *   anything else           → true / false, sometimes with the number moved so it is false
 *
 * Every blank falls on a run of digits, latin letters, a date or a quoted phrase, or on the part
 * of a sentence before คือ — never in the middle of a Thai word, which would need a tokenizer
 * and would be wrong in public the one time it slipped.
 *
 * A question made here is a draft: the person who asked for it reads every one before it is
 * saved, and the editor is where it gets its final wording.
 *
 * The exam style (`style: 'exam'`) asks the same facts as a practice paper would: four choices
 * wherever the sentence allows it — a term against three real terms, a number against three
 * neighbours on its own scale, a definition against the set's other definitions — and true/false
 * otherwise. Never a slider or a typed answer, which an exam page cannot show.
 */
import { clip } from './text';
import type { Game, Question, QuestionType, Round, SliderSpec } from './types';
import { LIMITS } from './validate';
import { FACT_MAX_CHARS, FACT_MIN_CHARS, factKey, hasContactInfo, type FactSkip, type WikiFact } from './wiki';

/** A fact and the page it was read from. */
export interface SourceFact extends WikiFact {
  /** the page's path, e.g. `topics/leave-policy.md` */
  page: string;
  pageTitle?: string;
}

/** A fact with the question type the rules chose for it. */
export interface FactPlan extends SourceFact {
  type: QuestionType;
}

export interface DroppedFact extends SourceFact {
  why: FactSkip;
}

/** One quiz draws on at most this many pages, so a game stays about something. */
export const MAX_PAGES = 10;
/** and takes at most this many facts from any one page, so one long page cannot fill the game */
export const MAX_PER_PAGE = 3;
/** an exam is a bank to practise on, so it keeps far more of each page */
export const EXAM_PER_PAGE = 15;

/** A party game (every question type) or a practice paper (four choices, true/false otherwise). */
export type QuizStyle = 'game' | 'exam';

export interface MakeOptions {
  style?: QuizStyle;
  /** the set's definitions, as wrong choices for "X คืออะไร" (see `definitionPool`) */
  defs?: readonly string[];
}

export const BLANK = '____';

// ---------- finding the parts of a sentence that can be blanked out ----------

interface Span {
  start: number;
  end: number;
  text: string;
}

interface NumberSpan extends Span {
  value: number;
  unit?: string;
}

/** Units worth keeping on a slider; the longest match wins, so ล้านบาท beats บาท. */
const UNITS = [
  'ล้านบาท',
  'เปอร์เซ็นต์',
  'กิโลเมตร',
  'กิโลกรัม',
  'ชั่วโมง',
  'วินาที',
  'เครื่อง',
  'นาที',
  'หลัก',
  'ด่าน',
  'เดือน',
  'แห่ง',
  'ครั้ง',
  'บาท',
  'เมตร',
  'ชม.',
  'กก.',
  'ซม.',
  'กม.',
  'คน',
  'ปี',
  'วัน',
  'ข้อ',
  'ทีม',
  'รอบ',
  'ชุด',
  'TB',
  'GB',
  'MB',
  'KB',
  '%',
].sort((a, b) => b.length - a.length);

const DIGITS = /\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?/g;

/**
 * Numbers a question can be built on. A run of digits that belongs to something else — a version
 * (pm2), a path, a time (09:30), a port in a url — is left alone, since blanking it asks about
 * nothing.
 */
export function numberSpans(text: string): NumberSpan[] {
  const out: NumberSpan[] = [];
  for (const m of text.matchAll(DIGITS)) {
    const start = m.index!;
    const end = start + m[0].length;
    const before = text[start - 1] ?? '';
    const after = text.slice(end);
    // …and a run that carries on into another number is a version or an address: 20.20.0, 1.2.3
    if (/[A-Za-z\d.,:/\\]/.test(before) || /^[A-Za-z:/\\]/.test(after) || /^[.,]\d/.test(after)) continue;
    const value = Number(m[0].replace(/,/g, ''));
    if (!Number.isFinite(value) || Math.abs(value) > LIMITS.sliderAbs) continue;
    const rest = after.replace(/^\s*/, '');
    const unit = UNITS.find((u) => rest.startsWith(u));
    out.push({ start, end, text: m[0], value, ...(unit ? { unit } : {}) });
  }
  return out;
}

const MONTHS = 'มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม';
const DATE = new RegExp(`(?:\\d{1,2} ?)?(?:${MONTHS}) ?(?:พ\\.ศ\\. ?|ค\\.ศ\\. ?)?\\d{4}`, 'g');
const LATIN = /[A-Za-z][A-Za-z0-9+#&._-]*(?: [A-Z0-9][A-Za-z0-9+#&._-]*)*/g;
const QUOTED = /[“"«]([^”"»\n]{2,60})[”"»]/g;

/** Latin words that are never the point of a sentence, so never the answer to a question. */
const STOP = new Set([
  'the',
  'and',
  'or',
  'of',
  'for',
  'in',
  'on',
  'at',
  'to',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'by',
  'with',
  'from',
  'as',
  'it',
  'this',
  'that',
]);

/** The kinds of blank a cloze question can fall on, in the order they make the best question. */
export type TermKind = 'quoted' | 'date' | 'latin';

export interface TermSpan extends Span {
  kind: TermKind;
}

/** Phrases a question can be built around: a quoted phrase, a date, or a run of latin words. */
export function termSpans(text: string): TermSpan[] {
  const out: TermSpan[] = [];
  const add = (kind: TermKind, start: number, raw: string) => {
    const lead = raw.length - raw.replace(/^[\s"“«]+/, '').length;
    const term = raw.slice(lead).replace(/[\s"”».,;:]+$/, '');
    if (term.length < 2 || term.length > LIMITS.optionMax) return;
    if (/^[A-Za-z]+$/.test(term) && STOP.has(term.toLowerCase())) return;
    // a number on its own is a slider's job, not a tile's
    if (/^[\d.,]+$/.test(term)) return;
    out.push({ kind, start: start + lead, end: start + lead + term.length, text: term });
  };
  for (const m of text.matchAll(QUOTED)) add('quoted', m.index! + m[0].indexOf(m[1]), m[1]);
  for (const m of text.matchAll(DATE)) add('date', m.index!, m[0]);
  for (const m of text.matchAll(LATIN)) add('latin', m.index!, m[0]);
  // an overlap means the same words were found twice; keep the better kind
  const rank: Record<TermKind, number> = { quoted: 0, date: 1, latin: 2 };
  return out
    .sort((a, b) => rank[a.kind] - rank[b.kind] || b.text.length - a.text.length)
    .filter((s, i, all) => !all.slice(0, i).some((p) => s.start < p.end && p.start < s.end));
}

/** Words that make a statement too vague to turn around into a false one. */
const HEDGE = /ประมาณ|ราว|กว่า|เกือบ|มากกว่า|น้อยกว่า|อย่างน้อย|ไม่เกิน|สูงสุด|ต่ำสุด|up to|about|around/i;

// Thai writes "X คือY" as often as "X คือ Y"
const DEFINITION = /^(.{2,40}?) ?(คือ|หมายถึง|ย่อมาจาก) ?(.{8,})$/;

// ---------- deciding which question a fact becomes ----------

/** Every term in a set of facts, so a cloze question's wrong tiles are real words from the subject. */
export function termPool(facts: readonly SourceFact[]): TermSpan[] {
  const seen = new Set<string>();
  const pool: TermSpan[] = [];
  for (const f of facts)
    for (const t of termSpans(f.text)) {
      const key = t.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(t);
    }
  return pool;
}

/** Whether a term can be blanked out of this sentence: it must be in it exactly once. */
const blankable = (text: string, term: TermSpan) => text.indexOf(term.text) === term.start && text.indexOf(term.text, term.start + 1) === -1;

function distractorsFor(answer: TermSpan, text: string, pool: readonly TermSpan[], seed: number, sameKindOnly = false): string[] {
  const low = answer.text.toLowerCase();
  const sentence = text.toLowerCase();
  const usable = pool.filter((t) => {
    const k = t.text.toLowerCase();
    return k !== low && !k.includes(low) && !low.includes(k) && !sentence.includes(k);
  });
  const same = usable.filter((t) => t.kind === answer.kind);
  if (sameKindOnly && same.length < 3) return [];
  // a date is only ever guessed against other dates: "20 ตุลาคม 2026 / PostgreSQL / pm2" answers itself
  const alike = answer.kind === 'date' || same.length >= 3 ? same : usable.filter((t) => t.kind !== 'date');
  // stable but not always the same three: the seed is the fact's place in the set
  return alike
    .map((t) => t.text)
    .sort((a, b) => hash(a, seed) - hash(b, seed))
    .slice(0, 3);
}

/** A small stable hash, so the same facts always make the same game (tests, and a retry). */
function hash(s: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 2 ** 32;
}

/**
 * The question type this fact makes the best question as, given what else is in the set.
 * Shown on the review screen before anything is built, and changeable there.
 */
export function pickType(fact: SourceFact, pool: readonly TermSpan[], opts: MakeOptions = {}): QuestionType {
  const text = fact.text;
  if (opts.style === 'exam') return examChoice(text, pool, opts.defs ?? [], 0) ? 'quiz' : 'truefalse';
  const numbers = numberSpans(text);
  if (numbers.length === 1 && Number.isInteger(numbers[0].value)) return 'slider';
  const term = termSpans(text).find((t) => blankable(text, t));
  if (term && distractorsFor(term, text, pool, 0).length === 3) return 'quiz';
  if (definitionBlank(text)) return 'type';
  return 'truefalse';
}

/**
 * "X คือ Y" read as a question: ask for whichever side is short enough to type. Asking for Y
 * ("ฐานข้อมูลที่ใช้คือ ____") is the better question, so it is tried first; asking for X is the
 * fallback for a sentence whose definition runs long.
 */
function definitionBlank(text: string): { prompt: string; answer: string } | null {
  const def = DEFINITION.exec(text);
  if (!def) return null;
  const [, subject, verb, rest] = def;
  const ask = (before: string, answer: string, after: string) =>
    answer.length <= LIMITS.typedMax && answer.length >= 2 ? { prompt: `เติมคำในช่องว่าง: ${before}${BLANK}${after}`, answer } : null;
  return ask(`${subject} ${verb} `, rest, '') ?? ask('', subject, ` ${verb} ${rest}`);
}

/**
 * Which facts can be used, and which cannot and why. Contact details are dropped before anything
 * else sees them; the rest is about keeping one page from filling the whole game.
 */
export function planFacts(
  facts: readonly SourceFact[],
  opts: { perPage?: number; style?: QuizStyle } = {},
): { keep: FactPlan[]; dropped: DroppedFact[] } {
  const cap = Math.max(1, Math.floor(opts.perPage ?? (opts.style === 'exam' ? EXAM_PER_PAGE : MAX_PER_PAGE)));
  const keep: FactPlan[] = [];
  const dropped: DroppedFact[] = [];
  const seen: string[] = [];
  const perPage = new Map<string, number>();
  const usable = facts.filter((f) => !hasContactInfo(f.text)).map((f) => ({ ...f, text: withSubject(f.text.trim(), f.pageTitle) }));
  const pool = termPool(usable);
  const defs = definitionPool(usable);

  for (const fact of facts) {
    const drop = (why: FactSkip) => dropped.push({ ...fact, why });
    const text = withSubject(fact.text.trim(), fact.pageTitle);
    const key = looseKey(text);
    if (text.length < FACT_MIN_CHARS) drop('short');
    else if (hasContactInfo(text)) drop('contact');
    else if (text.length > FACT_MAX_CHARS) drop('long');
    else if (seen.some((k) => sameFact(k, key))) drop('duplicate');
    else if ((perPage.get(fact.page) ?? 0) >= cap) drop('per-page');
    else {
      seen.push(key);
      perPage.set(fact.page, (perPage.get(fact.page) ?? 0) + 1);
      keep.push({ ...fact, text, type: pickType({ ...fact, text }, pool, { style: opts.style, defs }) });
    }
  }
  return { keep, dropped };
}

/** How a page starts a fact about itself: "เป็นเว็บเกม…" under the heading "Pika Arena". */
const SUBJECTLESS = /^(?:เป็น|มี|ใช้|รองรับ|สามารถ|ช่วย|ทำงาน|ไม่มี|ไม่ใช่|ไม่รองรับ|ไม่สามารถ)/;

/**
 * A fact that leaves out its subject because the page is about it gets the page's name in front,
 * so it still reads as a question on its own. Only a short name with no number in it: a title like
 * "การเก็บรายงาน 90 วัน" would bring a number into a sentence that was not about it.
 */
export function withSubject(text: string, pageTitle?: string): string {
  const title = pageTitle?.trim();
  if (!title || title.length > 30 || /\d/.test(title) || !SUBJECTLESS.test(text) || text.startsWith(title)) return text;
  const joined = `${title} ${text}`;
  return joined.length <= FACT_MAX_CHARS ? joined : text;
}

/** "X คือ Y" and "X เป็น Y" say the same Y; the key a duplicate is found by leaves the subject out. */
function looseKey(text: string): string {
  const m = /^.{1,40}?\s?(?:คือ|เป็น)\s?(.{15,})$/.exec(text);
  return factKey(m ? m[1] : text);
}

/** The same fact, or one that only adds a clause to another ("…90 วัน" and "…90 วัน แล้วลบทิ้ง"). */
function sameFact(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 15 && long.includes(short);
}

/**
 * The answers of every "X คือ Y" in a set whose Y is Thai prose short enough to be a choice: the
 * wrong choices for "X คืออะไร" are then other things the same pages define. A Y that is a name
 * ("PostgreSQL") is a term, and a term is asked as a blank among other terms instead.
 */
export function definitionPool(facts: readonly SourceFact[]): string[] {
  const out = new Set<string>();
  for (const f of facts) {
    const def = DEFINITION.exec(f.text.trim());
    if (def && THAI.test(def[3]) && def[3].length <= LIMITS.optionMax) out.add(def[3].trim());
  }
  return [...out];
}

const THAI = /[฀-๿]/;

// ---------- the exam style: four choices wherever the sentence allows ----------

interface Choice {
  prompt: string;
  options: string[];
  correct: number;
}

/** 1, 2 or 5 times a power of ten, the nearest to `x`: the steps a reader expects between choices. */
function nearNice(x: number): number {
  const mag = 10 ** Math.floor(Math.log10(x));
  const r = x / mag;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * mag;
}

const decimalsOf = (s: string) => (/\.(\d+)$/.exec(s.replace(/,/g, ''))?.[1].length ?? 0);

/**
 * Four numbers on the answer's own scale, evenly spaced and in order: a year among the years
 * around it, 200 among 100 / 150 / 200 / 250. Where the answer sits among them depends on the seed,
 * so the right one is not always the second; nothing goes below zero for a count, or past 100 for
 * a percentage.
 */
export function numberChoices(raw: string, value: number, unit: string | undefined, seed: number): { options: string[]; correct: number } {
  const year = !unit && Number.isInteger(value) && value >= 1900 && value <= 2600;
  const pct = unit === '%' || unit === 'เปอร์เซ็นต์';
  let step = year || value === 0 ? 1 : nearNice(Math.abs(value) * 0.3);
  if (Number.isInteger(value)) step = Math.max(1, Math.round(step));
  const places = Math.max(decimalsOf(raw), decimalsOf(String(step)));
  const at = (j: number, i: number) => Number((value + (i - j) * step).toFixed(places));
  let j = Math.floor(hash(raw + unit, seed) * 4);
  const floor = value > 0 ? Number.EPSILON : value === 0 ? 0 : -Infinity;
  while (j > 0 && at(j, 0) < floor) j--;
  while (pct && value <= 100 && j < 3 && at(j, 3) > 100) j++;
  const write = (n: number) =>
    raw.includes(',') ? n.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }) : n.toFixed(places);
  return { options: [0, 1, 2, 3].map((i) => write(at(j, i))), correct: j };
}

/**
 * The four-choice question a sentence makes best, or null when it makes none:
 *   a term with three real terms of its own kind → blank it
 *   a number                                      → blank it among its neighbours
 *   "X คือ Y", with three other Ys in the set     → "X คืออะไร"
 *   a term with any three real terms              → blank it anyway
 */
function examChoice(text: string, pool: readonly TermSpan[], defs: readonly string[], seed: number): Choice | null {
  const cloze = (sameKindOnly: boolean): Choice | null => {
    const term = termSpans(text).find((t) => blankable(text, t));
    if (!term) return null;
    const wrong = distractorsFor(term, text, pool, seed, sameKindOnly);
    if (wrong.length < 3) return null;
    const options = shuffle([term.text, ...wrong], seed);
    return { prompt: `เติมคำในช่องว่าง: ${blankOut(text, term.start, term.end)}`, options, correct: options.indexOf(term.text) };
  };
  const numeric = (): Choice | null => {
    const numbers = numberSpans(text);
    if (numbers.length === 0 || numbers.length > 3) return null;
    const withUnit = numbers.filter((n) => n.unit);
    const from = withUnit.length ? withUnit : numbers;
    const n = from[Math.floor(hash(text, seed) * from.length)];
    const { options, correct } = numberChoices(n.text, n.value, n.unit, seed);
    return { prompt: `เติมคำในช่องว่าง: ${blankOut(text, n.start, n.end)}`, options, correct };
  };
  const definition = (): Choice | null => {
    const def = DEFINITION.exec(text);
    if (!def) return null;
    const [, subject, verb, rest] = def;
    const answer = rest.trim();
    if (!THAI.test(answer) || answer.length > LIMITS.optionMax) return null;
    const others = defs.filter((d) => d !== answer && !text.includes(d) && !d.includes(answer) && !answer.includes(d));
    if (others.length < 3) return null;
    const wrong = [...others].sort((a, b) => hash(a, seed) - hash(b, seed)).slice(0, 3);
    const options = shuffle([answer, ...wrong], seed);
    return { prompt: `${subject.trim()} ${verb}อะไร`, options, correct: options.indexOf(answer) };
  };
  const fits = (c: Choice | null) => (c && c.prompt.length <= LIMITS.promptMax && c.options.every((o) => o.length <= LIMITS.optionMax) ? c : null);
  return fits(cloze(true)) ?? fits(numeric()) ?? fits(definition()) ?? fits(cloze(false));
}

/** Verbs that read plainly once the ไม่ in front of them is gone: the opposite statement, and a false one. */
const NEGATED = /ไม่(?=ได้|ต้อง|สามารถ|มี|ใช่|เคย|อนุญาต|รองรับ|ใช้|ควร)/;

/**
 * The same sentence made false, for a true/false question in an exam: its one number moved, its
 * one "ไม่" taken out, or its term swapped for another from the set. Null when none of those can
 * be done honestly — a hedged sentence was never exact enough to be wrong.
 */
function falseVersion(text: string, pool: readonly TermSpan[], seed: number): string | null {
  if (HEDGE.test(text)) return null;
  const numbers = numberSpans(text);
  if (numbers.length === 1 && Number.isInteger(numbers[0].value)) {
    const n = numbers[0];
    return text.slice(0, n.start) + formatLike(n.text, moveNumber(n.value)) + text.slice(n.end);
  }
  if ((text.match(/ไม่/g) ?? []).length === 1 && NEGATED.test(text)) return text.replace(NEGATED, '');
  const term = termSpans(text).find((t) => blankable(text, t) && t.kind !== 'date');
  const [other] = term ? distractorsFor(term, text, pool, seed).filter((w) => !/\d/.test(w)) : [];
  return term && other ? text.slice(0, term.start) + other + text.slice(term.end) : null;
}

// ---------- building the question ----------

const blankOut = (text: string, start: number, end: number) => text.slice(0, start) + BLANK + text.slice(end);

/** The scale a slider gets for an answer: wide enough to be a guess, fine enough to be winnable. */
export function scaleFor(answer: number, unit?: string): SliderSpec {
  const pct = unit === '%' || unit === 'เปอร์เซ็นต์';
  if (pct && answer >= 0 && answer <= 100) return { min: 0, max: 100, step: 1, answer, margin: 5, unit };
  if (!unit && answer >= 1900 && answer <= 2600) return { min: answer - 10, max: answer + 10, step: 1, answer, margin: 1 };
  const span = Math.max(1, Math.round(Math.abs(answer) * 0.6));
  const step = niceStep(span);
  const k = Math.max(2, Math.round(span / step));
  // the scale is built outwards from the answer, so the answer always lands on a step
  const min = answer >= 0 && answer - step * k < 0 ? answer - step * Math.floor(answer / step) : answer - step * k;
  // a guess within an eighth of the scale still pays; on a scale so short that an eighth is nothing,
  // only the exact answer does — a margin of one step out of four would score almost any guess
  return { min, max: answer + step * k, step, answer, margin: step * Math.floor(k / 4), ...(unit ? { unit } : {}) };
}

/** 1, 2 or 5 times a power of ten: the steps a person expects to see on a scale. */
function niceStep(span: number): number {
  const raw = Math.max(1, span / 8);
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5]) if (raw <= m * mag) return m * mag;
  return 10 * mag;
}

/** A number far enough from the real one that the statement is plainly false, and still believable. */
function moveNumber(value: number): number {
  if (value >= 1900 && value <= 2600) return value - 3;
  if (value <= 4) return value + 2;
  const step = Math.max(1, Math.round(Math.abs(value) * 0.4));
  return value + step;
}

const TIME_FOR: Record<QuestionType, number> = { quiz: 20, truefalse: 20, poll: 20, puzzle: 30, type: 30, slider: 30 };

/**
 * One question from one fact, or null when the rules cannot make that type out of this sentence —
 * the caller then falls back, and the review screen says so.
 */
export function buildQuestion(plan: FactPlan, id: string, pool: readonly TermSpan[], seed: number, opts: MakeOptions = {}): Question | null {
  const text = plan.text;
  const exam = opts.style === 'exam';
  // an exam has only two kinds: whatever else was asked for is tried as four choices first
  const type: QuestionType = exam ? (plan.type === 'truefalse' ? 'truefalse' : 'quiz') : plan.type;
  const base = {
    id,
    timeLimitS: TIME_FOR[type],
    explanation: clip(text, LIMITS.explanationMax),
    source: { path: plan.page, ...(plan.pageTitle ? { title: plan.pageTitle } : {}), ...(plan.cite ? { cite: plan.cite } : {}) },
  };
  const fits = (prompt: string) => prompt.length <= LIMITS.promptMax;

  if (exam) {
    if (type === 'quiz') {
      const c = examChoice(text, pool, opts.defs ?? [], seed);
      return c ? { ...base, type: 'quiz', prompt: c.prompt, options: c.options, correct: [c.correct] } : null;
    }
    const lie = falseVersion(text, pool, seed);
    if (lie && fits(lie) && hash(text, seed) < 0.5) {
      return { ...base, type: 'truefalse', prompt: lie, options: ['จริง', 'เท็จ'], correct: [1], explanation: clip(`ที่ถูกคือ ${text}`, LIMITS.explanationMax) };
    }
    return fits(text) ? { ...base, type: 'truefalse', prompt: text, options: ['จริง', 'เท็จ'], correct: [0] } : null;
  }

  if (plan.type === 'slider') {
    const numbers = numberSpans(text);
    const n = numbers.find((x) => Number.isInteger(x.value));
    if (!n || numbers.length !== 1) return null;
    const prompt = `เติมตัวเลขให้ถูก: ${blankOut(text, n.start, n.end)}`;
    if (!fits(prompt)) return null;
    return { ...base, type: 'slider', prompt, options: [], correct: [], slider: scaleFor(n.value, n.unit) };
  }

  if (plan.type === 'type') {
    const def = definitionBlank(text);
    if (!def || !fits(def.prompt)) return null;
    return { ...base, type: 'type', prompt: def.prompt, options: [def.answer], correct: [] };
  }

  if (plan.type === 'quiz') {
    const term = termSpans(text).find((t) => blankable(text, t));
    if (!term) return null;
    const wrong = distractorsFor(term, text, pool, seed);
    if (wrong.length < 3) return null;
    const prompt = `เติมคำในช่องว่าง: ${blankOut(text, term.start, term.end)}`;
    if (!fits(prompt)) return null;
    const options = shuffle([term.text, ...wrong], seed);
    return { ...base, type: 'quiz', prompt, options, correct: [options.indexOf(term.text)] };
  }

  // true or false: the sentence as it stands, or the same sentence with its number moved
  const numbers = numberSpans(text);
  const movable = numbers.length === 1 && Number.isInteger(numbers[0].value) && !HEDGE.test(text);
  const askFalse = movable && hash(text, seed) < 0.5;
  if (askFalse) {
    const n = numbers[0];
    const prompt = text.slice(0, n.start) + formatLike(n.text, moveNumber(n.value)) + text.slice(n.end);
    if (fits(prompt)) {
      return { ...base, type: 'truefalse', prompt, options: ['จริง', 'เท็จ'], correct: [1], explanation: clip(`ที่ถูกคือ ${text}`, LIMITS.explanationMax) };
    }
  }
  if (!fits(text)) return null;
  return { ...base, type: 'truefalse', prompt: text, options: ['จริง', 'เท็จ'], correct: [0] };
}

/** A replacement number written the way the original was, so "1,654" does not become "2316". */
function formatLike(original: string, value: number): string {
  return original.includes(',') ? value.toLocaleString('en-US') : String(value);
}

function shuffle<T>(items: T[], seed: number): T[] {
  return items
    .map((item, i) => ({ item, k: hash(String(item), seed + i) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.item);
}

/** A question for every fact that can carry one, with the ones that cannot said plainly. */
export function buildQuestions(
  plans: readonly FactPlan[],
  opts: { style?: QuizStyle } = {},
): { questions: Question[]; facts: FactPlan[]; failed: FactPlan[] } {
  const pool = termPool(plans);
  const make: MakeOptions = { style: opts.style, defs: opts.style === 'exam' ? definitionPool(plans) : [] };
  const questions: Question[] = [];
  const facts: FactPlan[] = [];
  const failed: FactPlan[] = [];
  plans.forEach((plan, i) => {
    // a type the rules cannot make from this sentence falls back to one they always can
    const q =
      buildQuestion(plan, `q${i + 1}`, pool, i, make) ??
      (plan.type === 'truefalse' ? null : buildQuestion({ ...plan, type: 'truefalse' }, `q${i + 1}`, pool, i, make));
    if (q) {
      questions.push(q);
      facts.push(plan);
    } else failed.push(plan);
  });
  return { questions, facts, failed };
}

// ---------- assembling the game ----------

/** A round holds this many questions before a new one starts, so the leaderboard comes round often. */
const PER_ROUND = 5;

/** A page's own name for a round, falling back to its path without the folder or the extension. */
const roundTitle = (plan: FactPlan) => plan.pageTitle?.trim() || plan.page.split('/').pop()!.replace(/\.md$/i, '').replace(/[-_]/g, ' ');

/**
 * The game a set of reviewed facts becomes: one round per page while pages are big enough to fill
 * one, so a round is about something and its name says what. Pages that give only a fact or two
 * share a round, which is then numbered rather than named after one of them.
 */
export function buildGame(
  plans: readonly FactPlan[],
  options: { title: string; description?: string; style?: QuizStyle },
): { game: Game; failed: FactPlan[] } {
  const exam = options.style === 'exam';
  const { questions, facts, failed } = buildQuestions(plans.slice(0, LIMITS.questionsMax), { style: options.style });

  const groups: { pages: string[]; title: string; questions: Question[] }[] = [];
  facts.forEach((plan, i) => {
    const last = groups[groups.length - 1];
    if (last && (last.pages[last.pages.length - 1] === plan.page ? last.questions.length < PER_ROUND : last.questions.length < 3)) {
      if (!last.pages.includes(plan.page)) last.pages.push(plan.page);
      last.questions.push(questions[i]);
    } else groups.push({ pages: [plan.page], title: roundTitle(plan), questions: [questions[i]] });
  });
  // a round left holding one question is not a round; it joins the one before it
  if (groups.length > 1 && groups[groups.length - 1].questions.length < 2) {
    const tail = groups.pop()!;
    const prev = groups[groups.length - 1];
    prev.questions.push(...tail.questions);
    prev.pages.push(...tail.pages);
  }

  const rounds: Round[] = groups.slice(0, LIMITS.roundsMax).map((g, i) => ({
    id: `r${i + 1}`,
    title: clip(g.pages.length === 1 ? g.title : `ด่านที่ ${i + 1}`, LIMITS.titleMax),
    questions: g.questions,
  }));

  const pages = new Set(facts.map((f) => f.page)).size;
  const game: Game = {
    id: '',
    title: clip(options.title.trim() || (exam ? 'ข้อสอบจากคลังความรู้' : 'ควิซจากคลังความรู้'), LIMITS.titleMax),
    description: clip(
      options.description?.trim() ||
        (exam
          ? `ข้อสอบจากคลังความรู้ ${pages} หน้า ${questions.length} ข้อ พร้อมเฉลยจากต้นฉบับทุกข้อ`
          : `สร้างจากคลังความรู้ ${pages} หน้า ${questions.length} คำถาม ตรวจและแก้ก่อนนำไปเล่น`),
      LIMITS.descriptionMax,
    ),
    rounds: rounds.length ? rounds : [{ id: 'r1', title: 'ด่านที่ 1', questions: [] }],
    settings: { streakBonus: false },
    cover: { color: 'teal', emoji: exam ? '📝' : '📚' },
  };
  return { game, failed };
}
