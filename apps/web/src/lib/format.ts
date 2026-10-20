import type { QuestionType } from '@icebreaker/shared';

export const fmt = (n: number) => Math.round(n).toLocaleString('th-TH');

export const secondsLabel = (ms: number | null) => (ms === null ? '–' : `${(ms / 1000).toFixed(1)} วิ`);

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part * 100) / whole) : 0);

export const TYPE_LABEL: Record<QuestionType, string> = {
  quiz: 'ควิซ',
  truefalse: 'จริงหรือเท็จ',
  poll: 'โพล',
  puzzle: 'เรียงลำดับ',
  type: 'พิมพ์คำตอบ',
  slider: 'ทายตัวเลข',
};

export const TYPE_ICON: Record<QuestionType, string> = {
  quiz: '❓',
  truefalse: '⚖️',
  poll: '🗳️',
  puzzle: '🧩',
  type: '⌨️',
  slider: '🎚️',
};

/** a slider number as players read it: years and heights without a comma (2007, not 2,007), big numbers with one */
export const fmtValue = (n: number, unit?: string) =>
  `${Math.abs(n) >= 10_000 ? n.toLocaleString('th-TH') : String(n)}${unit ? ` ${unit}` : ''}`;

export const ordinal = (rank: number) => `อันดับที่ ${rank}`;

/** "ด่าน 2: ด่านโหวต", or just the title while it is still the default name ("ด่านที่ 2") */
export function roundLabel(index: number, title: string, sep = ': ') {
  const t = title.trim();
  if (!t) return `ด่าน ${index + 1}`;
  return /^ด่านที่\s*\d+$/.test(t) ? t : `ด่าน ${index + 1}${sep}${t}`;
}
