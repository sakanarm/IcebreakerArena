/**
 * How long each beat of a live game lasts. The server runs the clock, and the big screen and the game-length
 * estimate draw it to the same numbers, so they live here once: change one and every side moves with it.
 */

/** reading time before answering opens; the doc's 3 s, longer for long questions */
export function leadInMs(prompt: string): number {
  return Math.min(6000, Math.max(3000, 1500 + prompt.length * 45));
}

/** a round's title card, then its first question comes by itself (the card's bar runs this long) */
export const ROUND_INTRO_MS = 3500;

/** answers still in flight when the timer hits 0 are accepted */
export const ANSWER_GRACE_MS = 300;

/** time is up: the reveal waits this long (answers stop at the grace above), while the Stage stamps "หมดเวลา!" */
export const TIME_UP_HOLD_MS = 1000;

/** everyone has answered: the reveal waits this long, while the Stage stamps "ตอบครบแล้ว!" */
export const ALL_ANSWERED_DELAY_MS = 1000;
