import { clip } from './text';

/** Emoji avatars: no artwork to license, and they render on every phone. */
export const AVATARS = [
  '🦊', '🐼', '🐯', '🐸', '🐙', '🦄', '🐧', '🐨', '🦁', '🐵',
  '🐰', '🐻', '🐳', '🦉', '🐝', '🐢', '🦖', '🐱', '🐶', '🦋',
] as const;

export const NICKNAME_MAX = 24;

const ANIMALS_TH = [
  'แมวน้ำ', 'นกฮูก', 'ช้างน้อย', 'เสือดาว', 'แพนด้า', 'ปลาวาฬ', 'หมีขาว', 'กระต่าย',
  'จิงโจ้', 'นากทะเล', 'เพนกวิน', 'ยีราฟ', 'ลามะ', 'โลมา', 'จิ้งจอก', 'หมึกยักษ์',
];
const VIBES_TH = [
  'สายชิล', 'ขยันโค้ด', 'นอนดึก', 'ไฟแรง', 'ใจเย็น', 'ตอบไว', 'ติดกาแฟ', 'รักเดดไลน์',
  'ยิ้มเก่ง', 'สายลุย', 'คิดไว', 'เดโมเก่ง', 'บั๊กหาย', 'สายแคร์', 'แรงดี', 'สายฮา',
];
const ADJ_EN = [
  'Swift', 'Brave', 'Clever', 'Turbo', 'Cosmic', 'Happy', 'Mighty', 'Lucky',
  'Zen', 'Pixel', 'Sneaky', 'Jolly', 'Rapid', 'Witty', 'Sunny', 'Bold',
];
const ANIMALS_EN = [
  'Panda', 'Otter', 'Falcon', 'Koala', 'Tiger', 'Llama', 'Dolphin', 'Fox',
  'Penguin', 'Gecko', 'Owl', 'Whale', 'Bunny', 'Yak', 'Lynx', 'Moose',
];

const pick = <T>(list: readonly T[], rand: () => number): T => list[Math.floor(rand() * list.length)]!;

/** Random fun nickname, Thai or English, so nobody has to think of one (and fewer rude names). */
export function randomNickname(rand: () => number = Math.random): string {
  return rand() < 0.6
    ? `${pick(ANIMALS_TH, rand)}${pick(VIBES_TH, rand)}`
    : `${pick(ADJ_EN, rand)} ${pick(ANIMALS_EN, rand)}`;
}

export function randomAvatar(rand: () => number = Math.random): string {
  return pick(AVATARS, rand);
}

/**
 * What takes no room on screen: zero-width spaces and joiners, the bidi controls that turn the names after them
 * around, the BOM and soft hyphen, and the blank letters (Hangul fillers, the braille blank) that look like no name.
 * Without them "Bob" and "Bob" with a zero-width space are the same name, so the second one becomes "Bob 2".
 */
const INVISIBLE = /[\p{Cf}\u034f\u115f\u1160\u2800\u3164\uffa0]/gu;

/** a zero-width joiner between two emoji makes one emoji of them (👩‍💻): that one stays */
const joinsEmoji = (s: string, at: number) =>
  /\p{Extended_Pictographic}[\u{1f3fb}-\u{1f3ff}\ufe0f]?$/u.test(s.slice(0, at)) && /^\p{Extended_Pictographic}/u.test(s.slice(at + 1));

/**
 * Strips control characters, invisible ones and markup-ish brackets, keeps marks from piling up (Zalgo text; Thai
 * puts at most two over one letter), collapses spaces, and caps the length without splitting a letter or an emoji.
 */
export function cleanNickname(raw: string): string {
  const name = raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(INVISIBLE, (c: string, at: number, s: string) => (c === '\u200d' && joinsEmoji(s, at) ? c : ''))
    .replace(/(\p{M}{3})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(name, NICKNAME_MAX).trim();
}
