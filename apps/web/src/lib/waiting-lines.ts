import type { QuestionPublic } from '@icebreaker/shared';

/** how an answer went in, which sets what the phone says while it waits for the reveal */
export type WaitMood = 'fast' | 'close' | 'poll' | 'any';

const FIRST: Record<WaitMood, string[]> = {
  fast: ['ไวยิ่งกว่าแสง! ⚡', 'นิ้วไวสุดๆ', 'เร็วขนาดนี้ อ่านจบยัง? 😆', 'คิดไว ตอบไว!'],
  close: ['เฉียดฉิว!', 'ทันแบบหวุดหวิด 😅', 'เกือบไม่ทันแล้วนะ!'],
  poll: ['ขอบคุณที่โหวต!', 'เสียงของคุณถูกนับแล้ว', 'มาดูกันว่าคนอื่นเลือกอะไร'],
  any: ['มั่นใจแค่ไหนเนี่ย?', 'ขอให้ถูกนะ 🤞', 'ลุ้นๆๆ', 'ใจเย็นๆ รอเฉลยแป๊บ'],
};

/** said in turn after the first line, until the reveal (a poll has no right answer to see) */
const THEN = ['ดูเฉลยบนจอใหญ่ได้เลย', 'รอเพื่อนๆ ตอบให้ครบ', 'เฉลยใกล้มาแล้ว'];
const THEN_POLL = ['รอเพื่อนๆ โหวตให้ครบ', 'ผลโหวตจะขึ้นบนจอใหญ่'];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * `at`: when the answer was sent, on the server's clock; null when this phone did not see it go
 * (it reloaded after answering). Fast is the first fifth of the time (1–2.5 s), close the last
 * 15% (1.5–4 s), so a long question does not call an answer with half a minute left a close call.
 */
export function waitMood(q: Pick<QuestionPublic, 'type' | 'startsAt' | 'endsAt'>, at: number | null): WaitMood {
  if (q.type === 'poll') return 'poll';
  if (at === null) return 'any';
  const time = q.endsAt - q.startsAt;
  if (at - q.startsAt <= clamp(time * 0.2, 1000, 2500)) return 'fast';
  if (q.endsAt - at <= clamp(time * 0.15, 1500, 4000)) return 'close';
  return 'any';
}

/** a first line picked at random for the mood, then the ones said in turn */
export function waitingLines(mood: WaitMood, random: () => number = Math.random): string[] {
  const first = FIRST[mood];
  return [first[Math.floor(random() * first.length)]!, ...(mood === 'poll' ? THEN_POLL : THEN)];
}
