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

const DEFINITION = /^(.{2,40}?) ?(คือ|หมายถึง|ย่อมาจาก) (.{8,})$/;

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

function distractorsFor(answer: TermSpan, text: string, pool: readonly TermSpan[], seed: number): string[] {
  const low = answer.text.toLowerCase();
  const sentence = text.toLowerCase();
  const usable = pool.filter((t) => {
    const k = t.text.toLowerCase();
    return k !== low && !k.includes(low) && !low.includes(k) && !sentence.includes(k);
  });
  const same = usable.filter((t) => t.kind === answer.kind);
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
export function pickType(fact: SourceFact, pool: readonly TermSpan[]): QuestionType {
  const text = fact.text;
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
export function planFacts(facts: readonly SourceFact[]): { keep: FactPlan[]; dropped: DroppedFact[] } {
  const keep: FactPlan[] = [];
  const dropped: DroppedFact[] = [];
  const seen = new Set<string>();
  const perPage = new Map<string, number>();
  const pool = termPool(facts.filter((f) => !hasContactInfo(f.text)));

  for (const fact of facts) {
    const drop = (why: FactSkip) => dropped.push({ ...fact, why });
    const text = fact.text.trim();
    if (text.length < FACT_MIN_CHARS) drop('short');
    else if (hasContactInfo(text)) drop('contact');
    else if (text.length > FACT_MAX_CHARS) drop('long');
    else if (seen.has(factKey(text))) drop('duplicate');
    else if ((perPage.get(fact.page) ?? 0) >= MAX_PER_PAGE) drop('per-page');
    else {
      seen.add(factKey(text));
      perPage.set(fact.page, (perPage.get(fact.page) ?? 0) + 1);
      keep.push({ ...fact, text, type: pickType({ ...fact, text }, pool) });
    }
  }
  return { keep, dropped };
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
export function buildQuestion(plan: FactPlan, id: string, pool: readonly TermSpan[], seed: number): Question | null {
  const text = plan.text;
  const base = {
    id,
    timeLimitS: TIME_FOR[plan.type],
    explanation: clip(text, LIMITS.explanationMax),
    source: { path: plan.page, ...(plan.pageTitle ? { title: plan.pageTitle } : {}), ...(plan.cite ? { cite: plan.cite } : {}) },
  };
  const fits = (prompt: string) => prompt.length <= LIMITS.promptMax;

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
export function buildQuestions(plans: readonly FactPlan[]): { questions: Question[]; facts: FactPlan[]; failed: FactPlan[] } {
  const pool = termPool(plans);
  const questions: Question[] = [];
  const facts: FactPlan[] = [];
  const failed: FactPlan[] = [];
  plans.forEach((plan, i) => {
    // a type the rules cannot make from this sentence falls back to one they always can
    const q = buildQuestion(plan, `q${i + 1}`, pool, i) ?? (plan.type === 'truefalse' ? null : buildQuestion({ ...plan, type: 'truefalse' }, `q${i + 1}`, pool, i));
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
export function buildGame(plans: readonly FactPlan[], options: { title: string; description?: string }): { game: Game; failed: FactPlan[] } {
  const { questions, facts, failed } = buildQuestions(plans.slice(0, LIMITS.questionsMax));

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
    title: clip(options.title.trim() || 'ควิซจากคลังความรู้', LIMITS.titleMax),
    description: clip(options.description?.trim() || `สร้างจากคลังความรู้ ${pages} หน้า ${questions.length} คำถาม ตรวจและแก้ก่อนนำไปเล่น`, LIMITS.descriptionMax),
    rounds: rounds.length ? rounds : [{ id: 'r1', title: 'ด่านที่ 1', questions: [] }],
    settings: { streakBonus: false },
    cover: { color: 'teal', emoji: '📚' },
  };
  return { game, failed };
}
