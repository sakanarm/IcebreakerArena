import { askedCount, isBank } from './room-game';
import type { Game, GameCover, Question } from './types';
import { hasCorrectTiles } from './validate';

/**
 * Exam mode: one person works through a game's multiple-choice questions at their own pace, with no
 * room and no host. Everything here is plain arithmetic on a game, so the page that runs an exam and
 * the tests agree on what a paper holds, which questions a sitting draws and how it is marked.
 */

/** A question an exam can ask: one with tiles and a right answer among them. */
export interface ExamQuestion {
  id: string;
  type: 'quiz' | 'truefalse';
  prompt: string;
  options: string[];
  /** any of these counts as right, as in a live room */
  correct: number[];
  imageUrl?: string;
  explanation?: string;
}

/** A round of the game, as a subject to revise */
export interface ExamTopic {
  id: string;
  title: string;
  questions: ExamQuestion[];
}

/** Everything a game offers an exam: its topics and all their questions. */
export interface ExamPaper {
  title: string;
  description?: string;
  cover?: GameCover;
  topics: ExamTopic[];
  /** how many questions the maker meant one sitting to ask, when a round is a question bank */
  suggested?: number;
}

/**
 * Whether an exam can ask this question: quiz and true/false only — a poll has no right answer, and
 * typing, ordering and guessing a number are not "pick one of four". The rest guards a draft that is
 * still being written: an exam of someone's own unfinished game simply leaves those questions out.
 */
export function isExamQuestion(q: Question): boolean {
  if (!hasCorrectTiles(q.type)) return false;
  if (!q.prompt.trim() || q.options.length < 2 || q.options.some((o) => !o.trim())) return false;
  return q.correct.length > 0 && q.correct.every((c) => Number.isInteger(c) && c >= 0 && c < q.options.length);
}

const forExam = (q: Question): ExamQuestion => ({
  id: q.id,
  type: q.type as ExamQuestion['type'],
  prompt: q.prompt,
  options: [...q.options],
  correct: [...q.correct],
  ...(q.imageUrl ? { imageUrl: q.imageUrl } : {}),
  ...(q.explanation ? { explanation: q.explanation } : {}),
});

/**
 * The paper a game makes. A round with nothing an exam can ask is left out. The paper carries what
 * the game carries: pass a game through `toRoomGame()` first when the paper is for people who may not
 * see explanations written from a knowledge base page.
 */
export function buildExam(game: Game): ExamPaper {
  const topics: ExamTopic[] = [];
  let suggested = 0;
  let banked = false;
  for (const r of game.rounds) {
    const questions = r.questions.filter(isExamQuestion).map(forExam);
    if (questions.length === 0) continue;
    topics.push({ id: r.id, title: r.title.trim(), questions });
    // a bank's draw, as far as its exam questions go; any other round counts whole
    const asked = isBank(r) ? Math.min(askedCount(r), questions.length) : questions.length;
    if (asked < questions.length) banked = true;
    suggested += asked;
  }
  return {
    title: game.title.trim(),
    ...(game.description?.trim() ? { description: game.description.trim() } : {}),
    ...(game.cover ? { cover: game.cover } : {}),
    topics,
    ...(banked ? { suggested } : {}),
  };
}

/** every question on the paper, or in the topics named */
export function examSize(paper: ExamPaper, topicIds?: readonly string[]): number {
  return paper.topics.reduce((n, t) => (topicIds && !topicIds.includes(t.id) ? n : n + t.questions.length), 0);
}

/** One question of a sitting, with the topic it came from so the result can be read per topic. */
export interface ExamItem {
  topicId: string;
  topicTitle: string;
  question: ExamQuestion;
}

export interface ExamDraw {
  /** the topics to draw from; unset or empty = all of them */
  topicIds?: readonly string[];
  /** how many questions; unset = all there are. Never more than there are, never less than one. */
  count?: number;
  /** true: the questions come in a random order. false: topic by topic, in the order written. */
  shuffle?: boolean;
}

/**
 * The questions of one sitting. Each chosen topic gets a share of the count in proportion to its
 * size — and at least one question while the count allows — so ticking a small topic next to a large
 * one still brings it up. Within a topic the questions are picked at random, none twice.
 * `random` is Math.random's shape; a test passes its own to get the same draw twice.
 */
export function drawExam(paper: ExamPaper, { topicIds, count, shuffle = true }: ExamDraw = {}, random: () => number = Math.random): ExamItem[] {
  const topics = paper.topics.filter((t) => t.questions.length > 0 && (!topicIds?.length || topicIds.includes(t.id)));
  const all = topics.reduce((n, t) => n + t.questions.length, 0);
  if (all === 0) return [];
  const want = typeof count === 'number' && Number.isFinite(count) ? Math.floor(count) : all;
  const n = Math.max(1, Math.min(want, all));
  const shares = allot(
    topics.map((t) => t.questions.length),
    n,
  );
  const items: ExamItem[] = [];
  topics.forEach((t, ti) => {
    // the positions picked, put back in the order written: a shuffle below mixes them if asked
    const picked = pickIndexes(t.questions.length, shares[ti]!, random).sort((a, b) => a - b);
    for (const i of picked) items.push({ topicId: t.id, topicTitle: t.title, question: t.questions[i]! });
  });
  return shuffle ? shuffleAll(items, random) : items;
}

/**
 * n places shared among groups of the given sizes (n ≤ their sum): one each first when n allows,
 * the rest in proportion to what each group still has, leftovers to the largest remainders.
 */
export function allot(sizes: readonly number[], n: number): number[] {
  const base = n >= sizes.length ? 1 : 0;
  const room = sizes.map((s) => s - base);
  const rest = n - base * sizes.length;
  const total = room.reduce((a, b) => a + b, 0);
  const exact = room.map((r) => (total > 0 ? (rest * r) / total : 0));
  const shares = exact.map((x) => Math.floor(x));
  let left = rest - shares.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || room[b.i]! - room[a.i]! || a.i - b.i);
  for (const { i } of byRemainder) {
    if (left <= 0) break;
    if (shares[i]! < room[i]!) {
      shares[i]!++;
      left--;
    }
  }
  return shares.map((s) => s + base);
}

/** n distinct positions out of `size`, at random */
function pickIndexes(size: number, n: number, random: () => number): number[] {
  const pool = Array.from({ length: size }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = Math.min(size - 1, i + Math.floor(random() * (size - i)));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, n);
}

function shuffleAll<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** whether picking option `choice` answers the question right */
export const isRightChoice = (q: Pick<ExamQuestion, 'correct'>, choice: number | null | undefined): boolean =>
  typeof choice === 'number' && q.correct.includes(choice);

export interface ExamTopicScore {
  id: string;
  title: string;
  total: number;
  correct: number;
  /** 0–100, rounded */
  percent: number;
}

export interface ExamScore {
  total: number;
  correct: number;
  wrong: number;
  /** left unanswered */
  skipped: number;
  /** 0–100, rounded; an unanswered question counts against it, as in an exam */
  percent: number;
  /** in the order the topics first come up in the sitting */
  topics: ExamTopicScore[];
}

const percentOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Marks a sitting. `answers[i]` is the option picked for `items[i]`, or null when it was left blank. */
export function scoreExam(items: readonly ExamItem[], answers: readonly (number | null | undefined)[]): ExamScore {
  const topics = new Map<string, ExamTopicScore>();
  let correct = 0;
  let skipped = 0;
  items.forEach((item, i) => {
    const a = answers[i];
    const answered = typeof a === 'number';
    const right = isRightChoice(item.question, a);
    if (right) correct++;
    else if (!answered) skipped++;
    const t = topics.get(item.topicId) ?? { id: item.topicId, title: item.topicTitle, total: 0, correct: 0, percent: 0 };
    t.total++;
    if (right) t.correct++;
    topics.set(item.topicId, t);
  });
  const total = items.length;
  return {
    total,
    correct,
    wrong: total - correct - skipped,
    skipped,
    percent: percentOf(correct, total),
    topics: [...topics.values()].map((t) => ({ ...t, percent: percentOf(t.correct, t.total) })),
  };
}
