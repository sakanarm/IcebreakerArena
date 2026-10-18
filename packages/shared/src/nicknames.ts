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

/** Strips control characters and markup-ish brackets, collapses spaces, and caps the length. */
export function cleanNickname(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICKNAME_MAX);
}
