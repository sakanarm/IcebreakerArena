'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';
import type { QuestionPublic } from '@icebreaker/shared';
import { TYPE_LABEL } from '@/lib/format';
import { untimed } from '../player/PlayerQuestion';
import { ANSWER_BG, AnswerShape } from '../shapes';

/** `from="lead-in"`: answering has just opened, and the question rises into its bar as the lead-in leaves upward */
export function PromptBar({ q, from = 'above' }: { q: QuestionPublic; from?: 'above' | 'lead-in' }) {
  const size =
    q.prompt.length <= 60
      ? 'text-2xl sm:text-4xl lg:text-5xl low:text-4xl short:text-2xl'
      : q.prompt.length <= 120
        ? 'text-xl sm:text-3xl lg:text-4xl low:text-3xl short:text-xl'
        : 'text-lg sm:text-2xl lg:text-3xl low:text-2xl short:text-lg';
  return (
    <motion.div
      initial={from === 'above' ? { y: -24, opacity: 0 } : { y: 30, scale: 1.04, opacity: 0 }}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={from === 'above' ? undefined : { type: 'spring', stiffness: 320, damping: 28, opacity: { duration: 0.18 } }}
      className="card mx-auto w-full max-w-6xl px-4 py-3 text-center sm:px-8 sm:py-5 low:py-3 short:py-2"
    >
      <h2 className={`font-display leading-snug font-semibold ${size}`}>{q.prompt}</h2>
    </motion.div>
  );
}

interface Pill {
  key: string;
  className: string;
  text: string;
}

/** a pill of the lead-in spins in after the one before it (the lead-in holds them `hidden` under the blinds) */
const PILL: Variants = {
  hidden: { rotate: -16, scale: 0.4, opacity: 0 },
  shown: (i: number) => {
    const delay = 0.16 + i * 0.06;
    return { rotate: 0, scale: 1, opacity: 1, transition: { delay, type: 'spring', stiffness: 380, damping: 14, opacity: { delay, duration: 0.12 } } };
  },
};

/** What kind of question it is and how it scores. `pop`: the lead-in's, each spinning in; `children` go first. */
export function QuestionMeta({ q, pop = false, children }: { q: QuestionPublic; pop?: boolean; children?: ReactNode }) {
  const pills = [
    { key: 'type', className: 'bg-white/15 font-semibold', text: TYPE_LABEL[q.type] },
    q.multiplier > 1 && { key: 'times', className: 'bg-gold font-display font-extrabold text-ink', text: `คะแนน ×${q.multiplier}` },
    q.multiplier === 0 && { key: 'none', className: 'bg-white/15', text: 'ข้อนี้ไม่คิดคะแนน' },
    untimed(q) && { key: 'untimed', className: 'bg-white/15', text: '⏱️ ไม่นับความเร็ว' },
  ].filter((p): p is Pill => p !== false);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm sm:text-lg short:text-base">
      {children}
      {pills.map((p, i) => {
        const className = `rounded-full px-3 py-1 sm:px-4 sm:py-1.5 ${p.className}`;
        return pop ? (
          <motion.span key={p.key} variants={PILL} custom={i} className={className}>
            {p.text}
          </motion.span>
        ) : (
          <span key={p.key} className={className}>
            {p.text}
          </span>
        );
      })}
    </div>
  );
}

/** seconds into a reveal when the counts are up and the verdict lands: the wrong answers shrink back, the right get their ✓ */
export const VERDICT_S = 1;

/**
 * The four answer tiles on the big screen. In `reveal` mode the right answers swell and get a ✓ that
 * pops with a ring going out from it, and the rest shrink and fade back (a poll has no right answer, so
 * nothing moves).
 */
export function AnswerGrid({ options, reveal = false, correct = [] }: { options: string[]; reveal?: boolean; correct?: number[] }) {
  const reduce = useReducedMotion();
  return (
    // two by two everywhere: on a phone on its side four in a row would leave a word or two a line, so there the
    // tiles get slim instead
    <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-2 sm:gap-4 short:gap-1.5">
      {options.map((text, i) => {
        const isCorrect = reveal && correct.includes(i);
        const faded = reveal && correct.length > 0 && !isCorrect;
        return (
          <motion.div
            key={i}
            data-verdict={!reveal || !correct.length ? undefined : isCorrect ? 'right' : 'wrong'}
            initial={reveal ? { opacity: 1, y: 0, scale: 1 } : { y: 48, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: faded ? 0.35 : 1, scale: isCorrect ? 1.04 : faded ? 0.92 : 1 }}
            transition={
              reveal
                ? // the right one swells with a bounce, the wrong ones settle back without one
                  { delay: VERDICT_S, type: 'spring', stiffness: isCorrect ? 420 : 260, damping: isCorrect ? 13 : 24 }
                : { delay: 0.1 + i * 0.08, type: 'spring', stiffness: 380, damping: 26 }
            }
            className={`relative flex min-h-16 items-center gap-2 rounded-2xl px-3 py-2 shadow-[inset_0_-6px_0_rgb(0_0_0/0.22)] sm:min-h-24 sm:gap-4 sm:px-6 sm:py-4 low:min-h-20 low:py-3 short:min-h-10 short:gap-2 short:px-3 short:py-1 ${ANSWER_BG[i]} ${isCorrect ? 'ring-4 ring-white' : ''}`}
          >
            {/* each shape spins into its tile as the tile slides in */}
            <motion.span
              className="grid shrink-0"
              initial={reveal ? false : { rotate: -180, scale: 0 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ delay: 0.18 + i * 0.08, type: 'spring', stiffness: 260, damping: 14 }}
            >
              <AnswerShape index={i} className="size-7 text-white drop-shadow sm:size-12 low:size-10 short:size-6" />
            </motion.span>
            <span className="min-w-0 flex-1 text-base leading-snug font-semibold break-words sm:text-2xl lg:text-3xl low:text-2xl short:text-base">{text}</span>
            {isCorrect && (
              <>
                <span className="relative grid shrink-0">
                  {!reduce && (
                    <motion.span
                      data-ring
                      aria-hidden
                      className="absolute inset-0 rounded-full border-4 border-white"
                      initial={{ scale: 1, opacity: 0 }}
                      animate={{ scale: 2.6, opacity: [0, 0.9, 0] }}
                      transition={{ delay: VERDICT_S + 0.12, duration: 0.7, ease: 'easeOut' }}
                    />
                  )}
                  <motion.span
                    data-tick
                    initial={{ scale: 0, rotate: -60 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ delay: VERDICT_S + 0.05, type: 'spring', stiffness: 520, damping: 12 }}
                    className="grid size-8 place-items-center rounded-full bg-white text-xl font-extrabold text-good shadow-lg sm:size-12 sm:text-3xl low:size-10 low:text-2xl short:size-7 short:text-lg"
                    aria-label="คำตอบที่ถูก"
                  >
                    ✓
                  </motion.span>
                </span>
                {/* its own clip, so the swelling tile and the ring going out are not cut at its edge */}
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
                  <span className="shine animate-shine" />
                </span>
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

/** `variants`: the lead-in's entrance, under its `hidden` and `shown` */
export function QuestionImage({ url, variants }: { url: string; variants?: Variants }) {
  // a plain <img>: authors link images from any https host, which next/image would need allow-listed one by one
  return (
    <motion.img
      src={url}
      alt=""
      variants={variants}
      className="max-h-[32vh] max-w-full rounded-2xl object-contain shadow-2xl max-sm:max-h-[20vh] low:max-h-[26vh] short:max-h-[22vh]"
      referrerPolicy="no-referrer"
    />
  );
}
