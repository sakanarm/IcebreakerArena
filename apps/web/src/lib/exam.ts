import { SAMPLE_GAMES, buildExam, drawExam, toRoomGame, type ExamItem, type ExamPaper } from '@pika-arena/shared';
import type { PublishedExam } from '@/server/exams';
import { ApiError, api, apiMessage } from './api';
import { cloud, isServerId } from './cloud';
import { dropBlankOptions, listMyGames } from './games';
import { load, remove, save } from './storage';

/**
 * Exam mode in the browser: where the paper behind /exam/<code> comes from, and the sitting one
 * person is working through. A sitting is kept in this browser only: nothing about who sat what,
 * or how they did, is sent anywhere.
 */

/** sample: a sample game. link: an exam link someone opened. own: the logged-in maker's own game. browser: a game kept in this browser. */
export type PaperOrigin = 'sample' | 'link' | 'own' | 'browser';

export type LoadedPaper =
  | { status: 'ready'; paper: ExamPaper; origin: PaperOrigin }
  /** no such exam (a closed link, a deleted game); `login` when logging in might show it */
  | { status: 'missing'; login: boolean }
  | { status: 'failed'; message: string };

/**
 * The paper for a code: a sample game's id, an exam link, the logged-in maker's own game (so they can
 * sit it before handing a link out), or a game in this browser's storage.
 */
export async function loadPaper(code: string): Promise<LoadedPaper> {
  const sample = SAMPLE_GAMES.find((g) => g.id === code);
  if (sample) return { status: 'ready', paper: buildExam(toRoomGame(sample)), origin: 'sample' };

  if (isServerId(code)) {
    try {
      const { exam } = await api<{ exam: PublishedExam }>(`/exams/${code}`);
      return { status: 'ready', paper: exam.paper, origin: 'link' };
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 404) return { status: 'failed', message: apiMessage(e) };
    }
    try {
      // the maker's own game comes whole: they wrote it, explanations and all
      const rec = await cloud.get(code);
      return { status: 'ready', paper: buildExam(dropBlankOptions(rec.game)), origin: 'own' };
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return { status: 'missing', login: true };
      if (e instanceof ApiError && [404, 409].includes(e.status)) return { status: 'missing', login: false };
      return { status: 'failed', message: apiMessage(e) };
    }
  }

  const mine = listMyGames().find((g) => g.id === code);
  return mine ? { status: 'ready', paper: buildExam(dropBlankOptions(mine)), origin: 'browser' } : { status: 'missing', login: false };
}

/** practice: each answer is checked at once. mock: nothing is shown until the paper is handed in. */
export type ExamMode = 'practice' | 'mock';

/** One sitting: the questions drawn for it and what the person has done so far. It carries the questions themselves, so it reads the same after the game behind it changes. */
export interface Attempt {
  v: 1;
  code: string;
  title: string;
  mode: ExamMode;
  items: ExamItem[];
  /** the option chosen for each item, by its place in `items` */
  answers: (number | null)[];
  /** practice: the items whose answer has been shown */
  checked: boolean[];
  /** items marked to come back to */
  flags: boolean[];
  /** the item on screen */
  at: number;
  startedAt: number;
  /** mock with a time limit: when the paper is handed in by itself */
  deadline: number | null;
  finishedAt: number | null;
  /** time with the paper open and the person there, for a sitting without a time limit */
  spentMs: number;
}

const key = (code: string) => `ib.exam.${code}`;

const isItem = (x: unknown): x is ExamItem => {
  const q = (x as ExamItem | null)?.question;
  return (
    !!q &&
    typeof (x as ExamItem).topicId === 'string' &&
    typeof (x as ExamItem).topicTitle === 'string' &&
    typeof q.id === 'string' &&
    typeof q.prompt === 'string' &&
    Array.isArray(q.options) &&
    q.options.length >= 2 &&
    q.options.every((o) => typeof o === 'string') &&
    Array.isArray(q.correct) &&
    q.correct.every((c) => Number.isInteger(c))
  );
};

/** Anything can sit in storage (an older version, a hand edit): only a sitting that is whole is taken back. */
function isAttempt(x: unknown, code: string): x is Attempt {
  const a = x as Attempt | null;
  if (!a || typeof a !== 'object' || a.v !== 1 || a.code !== code) return false;
  if (a.mode !== 'practice' && a.mode !== 'mock') return false;
  if (!Array.isArray(a.items) || a.items.length === 0 || !a.items.every(isItem)) return false;
  const n = a.items.length;
  if (!Array.isArray(a.answers) || a.answers.length !== n || !a.answers.every((v) => v === null || (Number.isInteger(v) && v >= 0))) return false;
  if (!Array.isArray(a.checked) || a.checked.length !== n || !Array.isArray(a.flags) || a.flags.length !== n) return false;
  if (!Number.isInteger(a.at) || a.at < 0 || a.at >= n) return false;
  if (typeof a.title !== 'string' || !Number.isFinite(a.startedAt) || !Number.isFinite(a.spentMs)) return false;
  return (a.deadline === null || Number.isFinite(a.deadline)) && (a.finishedAt === null || Number.isFinite(a.finishedAt));
}

export function loadAttempt(code: string): Attempt | null {
  const a = load<unknown>(key(code), null);
  return isAttempt(a, code) ? a : null;
}

export const saveAttempt = (a: Attempt) => save(key(a.code), a);
export const dropAttempt = (code: string) => remove(key(code));

/** What the start page asks before a sitting. */
export interface ExamSetup {
  /** the topics to draw from; empty means all of them */
  topicIds: string[];
  count: number;
  mode: ExamMode;
  shuffle: boolean;
  /** mock: seconds allowed per question, 0 for no time limit */
  paceS: number;
}

export function startAttempt(code: string, paper: ExamPaper, setup: ExamSetup, now = Date.now()): Attempt {
  const items = drawExam(paper, { topicIds: setup.topicIds, count: setup.count, shuffle: setup.shuffle });
  return attemptOf(code, paper.title, items, setup.mode, setup.mode === 'mock' ? setup.paceS : 0, now);
}

/** A fresh sitting of these very questions (the ones missed last time, say). */
export function attemptOf(code: string, title: string, items: ExamItem[], mode: ExamMode, paceS = 0, now = Date.now()): Attempt {
  return {
    v: 1,
    code,
    title,
    mode,
    items,
    answers: items.map(() => null),
    checked: items.map(() => false),
    flags: items.map(() => false),
    at: 0,
    startedAt: now,
    deadline: paceS > 0 ? now + items.length * paceS * 1000 : null,
    finishedAt: null,
    spentMs: 0,
  };
}

/** Hands the paper in. A sitting with a time limit ends at its limit at the latest, however late the page noticed. */
export function finishAttempt(a: Attempt, now = Date.now()): Attempt {
  if (a.finishedAt !== null) return a;
  return { ...a, finishedAt: a.deadline === null ? now : Math.min(now, a.deadline) };
}

/** whether the time ran out (the paper was handed in by itself) */
export const ranOut = (a: Attempt) => a.deadline !== null && a.finishedAt !== null && a.finishedAt >= a.deadline;

/** How long the sitting took: by the clock when it was timed, otherwise the time actually spent on it. */
export function usedMs(a: Attempt, now = Date.now()): number {
  if (a.deadline === null) return a.spentMs;
  return Math.max(0, Math.min(a.finishedAt ?? now, a.deadline) - a.startedAt);
}

export const answeredCount = (a: Attempt) => a.answers.filter((v) => v !== null).length;

/** practice: the items already shown their answer; mock: the ones answered */
export const doneCount = (a: Attempt) => (a.mode === 'practice' ? a.checked.filter(Boolean).length : answeredCount(a));

/** "12:05", or "1:02:05" from an hour up */
export function clock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** "12 นาที 5 วินาที" */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [h > 0 ? `${h} ชั่วโมง` : '', m > 0 ? `${m} นาที` : '', h === 0 && (s % 60 > 0 || m === 0) ? `${s % 60} วินาที` : ''];
  return parts.filter(Boolean).join(' ');
}

/** A, B, C, D … for the options, as on a printed paper */
export const letter = (i: number) => String.fromCharCode(65 + i);

export const MODE_LABEL: Record<ExamMode, string> = { practice: 'ฝึกทำ', mock: 'จำลองสอบ' };
