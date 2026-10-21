'use client';

import { motion } from 'motion/react';
import type { QuestionPublic } from '@icebreaker/shared';
import { TYPE_LABEL } from '@/lib/format';
import { untimed } from '../player/PlayerQuestion';
import { ANSWER_BG, AnswerShape } from '../shapes';

export function PromptBar({ q }: { q: QuestionPublic }) {
  const size =
    q.prompt.length <= 60
      ? 'text-2xl sm:text-4xl lg:text-5xl low:text-4xl short:text-2xl'
      : q.prompt.length <= 120
        ? 'text-xl sm:text-3xl lg:text-4xl low:text-3xl short:text-xl'
        : 'text-lg sm:text-2xl lg:text-3xl low:text-2xl short:text-lg';
  return (
    <motion.div
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="card mx-auto w-full max-w-6xl px-4 py-3 text-center sm:px-8 sm:py-5 low:py-3 short:py-2"
    >
      <h2 className={`font-display leading-snug font-semibold ${size}`}>{q.prompt}</h2>
    </motion.div>
  );
}

export function QuestionMeta({ q }: { q: QuestionPublic }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm sm:text-lg short:text-base">
      <span className="rounded-full bg-white/15 px-3 py-1 font-semibold sm:px-4 sm:py-1.5">{TYPE_LABEL[q.type]}</span>
      {q.multiplier > 1 && <span className="rounded-full bg-gold px-3 py-1 font-display font-extrabold text-ink sm:px-4 sm:py-1.5">คะแนน ×{q.multiplier}</span>}
      {q.multiplier === 0 && <span className="rounded-full bg-white/15 px-3 py-1 sm:px-4 sm:py-1.5">ข้อนี้ไม่คิดคะแนน</span>}
      {untimed(q) && <span className="rounded-full bg-white/15 px-3 py-1 sm:px-4 sm:py-1.5">⏱️ ไม่นับความเร็ว</span>}
    </div>
  );
}

/**
 * The four answer tiles on the big screen. In `reveal` mode the right answers
 * glow and the rest fade back (a poll has no right answer, so nothing fades).
 */
export function AnswerGrid({ options, reveal = false, correct = [] }: { options: string[]; reveal?: boolean; correct?: number[] }) {
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
            initial={reveal ? { opacity: 1, y: 0, scale: 1 } : { y: 48, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: faded ? 0.35 : 1, scale: isCorrect ? 1.02 : 1 }}
            transition={{ delay: reveal ? 1 : 0.1 + i * 0.08, type: 'spring', stiffness: 380, damping: 26 }}
            className={`relative flex min-h-16 items-center gap-2 overflow-hidden rounded-2xl px-3 py-2 shadow-[inset_0_-6px_0_rgb(0_0_0/0.22)] sm:min-h-24 sm:gap-4 sm:px-6 sm:py-4 low:min-h-20 low:py-3 short:min-h-10 short:gap-2 short:px-3 short:py-1 ${ANSWER_BG[i]} ${isCorrect ? 'ring-4 ring-white' : ''}`}
          >
            <AnswerShape index={i} className="size-7 shrink-0 text-white drop-shadow sm:size-12 low:size-10 short:size-6" />
            <span className="min-w-0 flex-1 text-base leading-snug font-semibold break-words sm:text-2xl lg:text-3xl low:text-2xl short:text-base">{text}</span>
            {isCorrect && (
              <>
                <motion.span
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 1.15, type: 'spring', stiffness: 400, damping: 14 }}
                  className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-xl font-extrabold text-good sm:size-12 sm:text-3xl low:size-10 low:text-2xl short:size-7 short:text-lg"
                  aria-label="คำตอบที่ถูก"
                >
                  ✓
                </motion.span>
                <span className="shine animate-shine" />
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

export function QuestionImage({ url }: { url: string }) {
  // a plain <img>: authors link images from any https host, which next/image would need allow-listed one by one
  return <img src={url} alt="" className="max-h-[32vh] max-w-full rounded-2xl object-contain shadow-2xl max-sm:max-h-[20vh] low:max-h-[26vh] short:max-h-[22vh]" referrerPolicy="no-referrer" />;
}
