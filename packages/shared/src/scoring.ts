import type { QuestionType } from './types';

export const FULL_POINTS = 1000;
/** answers this fast always get full points */
export const INSTANT_MS = 500;
export const POLL_POINTS = 100;
export const STREAK_STEP = 100;
export const STREAK_MAX_BONUS = 500;

/**
 * Kahoot-style speed score: round(1000 × (1 − (t/T)/2)).
 * Falls with time but never below half; an answer within 0.5 s gets the full 1,000.
 */
export function speedPoints(responseMs: number, timeLimitS: number): number {
  const limitMs = timeLimitS * 1000;
  if (responseMs <= INSTANT_MS) return FULL_POINTS;
  const t = Math.min(Math.max(responseMs, 0), limitMs);
  return Math.round(FULL_POINTS * (1 - t / limitMs / 2));
}

export interface ScoreInput {
  type: QuestionType;
  answered: boolean;
  /** null for poll */
  correct: boolean | null;
  responseMs: number;
  timeLimitS: number;
  /** false = accuracy mode: every correct answer gets 1,000 */
  timed: boolean;
  /** question × round multiplier */
  multiplier: number;
  streakBefore: number;
  streakBonus: boolean;
}

export interface ScoreOutput {
  points: number;
  streak: number;
}

export function scoreAnswer(i: ScoreInput): ScoreOutput {
  // a poll has no right answer: everyone who votes gets 100, and the streak is left alone
  if (i.type === 'poll') {
    return { points: i.answered ? Math.round(POLL_POINTS * i.multiplier) : 0, streak: i.streakBefore };
  }
  if (!i.answered || !i.correct) return { points: 0, streak: 0 };

  const streak = i.streakBefore + 1;
  const base = i.timed ? speedPoints(i.responseMs, i.timeLimitS) : FULL_POINTS;
  const bonus =
    i.streakBonus && i.multiplier > 0 ? Math.min(STREAK_STEP * (streak - 1), STREAK_MAX_BONUS) : 0;
  return { points: Math.round(base * i.multiplier) + bonus, streak };
}
