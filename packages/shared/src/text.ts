import { LIMITS } from './validate';

/** At most `max` UTF-16 units, cut between characters so no emoji or Thai vowel is split. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let out = '';
  for (const { segment } of new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(s)) {
    if (out.length + segment.length > max) break;
    out += segment;
  }
  return out;
}

const COPY_SUFFIX = ' (สำเนา)';

/** "<title> (สำเนา)", shortened so it stays within the title limit. */
export const copyTitle = (title: string) => clip(title.trim(), LIMITS.titleMax - COPY_SUFFIX.length) + COPY_SUFFIX;
