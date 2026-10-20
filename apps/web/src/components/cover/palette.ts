import type { CoverArt, CoverColor } from '@icebreaker/shared';

export interface CoverShades {
  /** the color as a game maker reads it */
  name: string;
  /** background gradient, top left to bottom right */
  bg: [string, string];
  /** darker and lighter shapes on it */
  deep: string;
  light: string;
  /** a color from across the wheel, for the odd shape that pops */
  pop: string;
}

/** Our brand colors, each with the shades a cover needs. */
export const COVER_SHADES: Record<CoverColor, CoverShades> = {
  orange: { name: 'ส้ม', bg: ['#ff9b3d', '#ff6a13'], deep: '#d94a00', light: '#ffd3a8', pop: '#3d5afe' },
  teal: { name: 'เขียวอมฟ้า', bg: ['#1fc8b8', '#00978b'], deep: '#006f66', light: '#a6f0e8', pop: '#ffc83d' },
  pink: { name: 'ชมพู', bg: ['#f45ca4', '#d02b7c'], deep: '#a3165c', light: '#ffc2dd', pop: '#ffc83d' },
  purple: { name: 'ม่วง', bg: ['#8a6dff', '#5a37e6'], deep: '#3f20b8', light: '#d6ccff', pop: '#00d1ff' },
  blue: { name: 'น้ำเงิน', bg: ['#5c77ff', '#2f49e8'], deep: '#1f33b5', light: '#c5cfff', pop: '#ff7a1a' },
  sky: { name: 'ฟ้า', bg: ['#3ddcff', '#00a3dc'], deep: '#0077a6', light: '#ccf6ff', pop: '#6c4bf4' },
  green: { name: 'เขียว', bg: ['#34d189', '#119a58'], deep: '#0b7342', light: '#c2f2d9', pop: '#ffc83d' },
  gold: { name: 'เหลือง', bg: ['#ffd862', '#ffb11f'], deep: '#d98a00', light: '#fff2c7', pop: '#e0388b' },
};

export const ART_NAMES: Record<CoverArt, string> = {
  icebreaker: 'ละลายน้ำแข็ง',
  security: 'ความปลอดภัย',
  party: 'ปาร์ตี้',
  emoji: 'อีโมจิ',
  numbers: 'ตัวเลข',
  townhall: 'ทาวน์ฮอลล์',
  onboarding: 'ออกเดินทาง',
  thailand: 'เมืองไทย',
};

/** Emojis to pick from in one tap; any other single emoji can be typed. */
export const SUGGESTED_EMOJIS = ['🎉', '🧠', '🚀', '💡', '🏆', '🎯', '🔥', '🤝', '❤️', '🌏', '🎤', '📚', '🔐', '🍜', '⚽', '🎵'];
