import type { SliderSpec } from './types';

/**
 * Typed answers are compared without case, spaces or punctuation, and with full-width and
 * look-alike characters folded (NFKC): "Tom-Yum", "tom yum" and "TOMYUM" all match "tomyum".
 * Thai that looks the same but was typed in another order matches too: ำ before its tone mark,
 * a tone mark before its vowel, เเ for แ, and Thai digits for 0–9.
 */
const IGNORED = /[\s​-‍⁠﻿.,!?'"`‘’“”~\-–—_/\\()[\]{}:;ฯ]+/gu;
/** vowels, tone marks and other signs written above or below a Thai letter */
const THAI_MARKS = /[ัิ-ฺ็-๎]{2,}/g;

export const normalizeTyped = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(IGNORED, '')
    .replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - 0x0e50))
    .replace(/เเ/g, 'แ')
    // NFKC turns ำ into ํ + า, so a tone mark typed after ำ lands after the า
    .replace(/ํา([่-๋])/g, '$1ํา')
    .replace(THAI_MARKS, (marks) => [...marks].sort().join(''));

/** The accepted answer a typed text matches, or -1. */
export function matchTyped(accepted: string[], text: string): number {
  const typed = normalizeTyped(text);
  if (!typed) return -1;
  return accepted.findIndex((a) => normalizeTyped(a) === typed);
}

/** A puzzle answer: every shown item exactly once. */
export function isOrder(order: unknown, n: number): order is number[] {
  if (!Array.isArray(order) || order.length !== n) return false;
  const seen = new Set<number>();
  for (const i of order) {
    if (!Number.isInteger(i) || i < 0 || i >= n || seen.has(i)) return false;
    seen.add(i);
  }
  return true;
}

/**
 * `shown[k]` is the authored position of the k-th item players see. The order is right when
 * the first item picked is the authored first, the second the authored second, and so on.
 */
export const isRightOrder = (shown: number[], order: number[]) => order.length === shown.length && order.every((d, pos) => shown[d] === pos);

/** A slider value the scale can show: a whole number on a step, between min and max. */
export const onScale = (s: Pick<SliderSpec, 'min' | 'max' | 'step'>, v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= s.min && v <= s.max && (v - s.min) % s.step === 0;

/**
 * 1 for the exact answer, falling to 0.5 at the edge of the margin, 0 beyond it.
 * Points are the usual score times this, so a near miss still pays.
 */
export function sliderCloseness(s: Pick<SliderSpec, 'answer' | 'margin'>, value: number): number {
  const off = Math.abs(value - s.answer);
  if (off === 0) return 1;
  if (off > s.margin) return 0;
  return 1 - (0.5 * off) / s.margin;
}

/** Where the phone's slider starts: the middle step. Players have to move it before they can send. */
export const sliderStart = (s: Pick<SliderSpec, 'min' | 'max' | 'step'>) => s.min + Math.round((s.max - s.min) / s.step / 2) * s.step;

/** The guesses chart splits the scale into at most 10 stretches, fewer when the scale has fewer steps. */
export const sliderBins = (s: Pick<SliderSpec, 'min' | 'max' | 'step'>) => Math.min(10, Math.floor((s.max - s.min) / s.step) + 1);

export function sliderBin(s: Pick<SliderSpec, 'min' | 'max' | 'step'>, value: number): number {
  const bins = sliderBins(s);
  return Math.min(bins - 1, Math.max(0, Math.floor(((value - s.min) / (s.max - s.min)) * bins)));
}

/** The lowest and highest value on the scale that each stretch of the chart holds. */
export function sliderBinRanges(s: Pick<SliderSpec, 'min' | 'max' | 'step'>): { lo: number; hi: number }[] {
  const ranges: { lo: number; hi: number }[] = [];
  if (!(s.step >= 1 && s.max > s.min)) return ranges;
  for (let v = s.min; v <= s.max; v += s.step) {
    const b = sliderBin(s, v);
    const r = (ranges[b] ??= { lo: v, hi: v });
    r.hi = v;
  }
  return ranges;
}
