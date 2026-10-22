/**
 * The podium's timeline, shared by the big screen and the phones so a medal lands on both at once.
 * All of it runs on each screen's own clock from when the podium comes on (the server only says it is on).
 */

import type { Easing } from 'motion/react';

export type Place = 1 | 2 | 3;

/**
 * ms after the podium comes on when each place is announced: 3rd, then 2nd, then a drum roll and the winner.
 * Each place has its moment to itself: its medal is down and the lights have settled on its player before the
 * next one starts.
 */
export const PLACE_AT: Record<Place, number> = { 3: 600, 2: 2000, 1: 4650 };
export const DRUMROLL_AT = 3000;
export const AWARDS_AT = 6000;

/** seconds after its place is announced: the stand rises from the floor, its player pops onto it */
export const RIDER_S = 0.3;
/** …then the winner's crown, and the medal falls onto the name */
export const CROWN_S = 0.5;
export const MEDAL_S = 0.7;
/** how long a medal falls before it hits the name (then it bounces once) */
export const FALL_S = 0.28;

/**
 * When a phone shows its player's result: the top three as their name comes onto the stand (their medal falls
 * as it does on the big screen), everyone else just after the winner's stand has risen.
 */
export function phoneRevealAt(rank: number | null): number {
  if (rank === 1 || rank === 2 || rank === 3) return PLACE_AT[rank] + RIDER_S * 1000;
  return PLACE_AT[1] + 50;
}

/** A medal's fall: from above, spinning, onto the mark, one small bounce. `drop` in px. */
export function medalFall(drop: number, delay: number) {
  const duration = FALL_S / 0.56;
  return {
    initial: { y: -drop, rotate: -200, opacity: 0 },
    animate: { y: [-drop, 0, -Math.round(drop * 0.1), 0], rotate: [-200, 0, 8, 0], opacity: 1 },
    transition: {
      y: { delay, duration, times: [0, 0.56, 0.78, 1], ease: ['easeIn', 'easeOut', 'easeIn'] as Easing[] },
      rotate: { delay, duration, times: [0, 0.56, 0.78, 1] },
      // its opacity keeps the moment even when reduced motion skips the fall
      opacity: { delay, duration: 0.08 },
    },
  };
}
