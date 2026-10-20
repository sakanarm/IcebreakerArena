import type { Game, GameCover } from './types';

/** Colors a game maker can pick for the cover. The shades live with the drawing (apps/web). */
export const COVER_COLORS = ['orange', 'teal', 'pink', 'purple', 'blue', 'sky', 'green', 'gold'] as const;
export type CoverColor = (typeof COVER_COLORS)[number];

/** Covers drawn by hand that ship with the app: the built-in games use them, and any game can pick one. */
export const COVER_ARTS = ['icebreaker', 'security', 'party', 'emoji', 'numbers', 'townhall', 'onboarding', 'thailand'] as const;
export type CoverArt = (typeof COVER_ARTS)[number];

/** room for the longest emoji sequences (families, couples with skin tones, subdivision flags) */
const EMOJI_MAX = 24;

/** one part of an emoji: a flag, a keycap, or a picture with its style, skin tone and tags (subdivision flags) */
const EMOJI_PART = String.raw`(?:\p{Regional_Indicator}{2}|[0-9#*]\u{FE0F}?\u{20E3}|\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}]?\p{Emoji_Modifier}?\u{FE0F}?(?:[\u{E0020}-\u{E007E}]+\u{E007F})?)`;
/** parts joined by ZWJ, as in families and jobs */
const EMOJI = new RegExp(String.raw`^${EMOJI_PART}(?:\u{200D}${EMOJI_PART})*$`, 'u');

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** One emoji as Unicode spells it (UTS #51), so no letters, digits, marks or loose joiners ride along. */
export const isCoverEmoji = (s: string): boolean => s.length > 0 && s.length <= EMOJI_MAX && EMOJI.test(s);

/** What a cover may hold: known colors and pictures and a single emoji. Anything else is dropped, never an error. */
export function cleanCover(input: unknown): GameCover | undefined {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  const v = input as Record<string, unknown>;
  const cover: GameCover = {};
  if (oneOf(COVER_COLORS, v.color)) cover.color = v.color;
  const emoji = typeof v.emoji === 'string' ? v.emoji.trim() : '';
  if (isCoverEmoji(emoji)) cover.emoji = emoji;
  if (oneOf(COVER_ARTS, v.art)) cover.art = v.art;
  return Object.keys(cover).length > 0 ? cover : undefined;
}

/** FNV-1a over the title: the same title always gives the same number, on the server and in every browser. */
export function coverSeed(title: string): number {
  let h = 0x811c9dc5;
  const s = title.trim();
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** The cover's color: the one picked, else one that comes from the title. */
export const coverColor = (game: Pick<Game, 'title' | 'cover'>): CoverColor =>
  game.cover?.color ?? COVER_COLORS[coverSeed(game.title) % COVER_COLORS.length];
