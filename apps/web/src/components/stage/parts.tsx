'use client';

import { motion } from 'motion/react';
import type { QuestionPublic } from '@icebreaker/shared';
import { TYPE_LABEL } from '@/lib/format';
import { untimed } from '../player/PlayerQuestion';
import { ANSWER_BG, AnswerShape } from '../shapes';

export function PromptBar({ q }: { q: QuestionPublic }) {
  const size = q.prompt.length <= 60 ? 'text-4xl lg:text-5xl' : q.prompt.length <= 120 ? 'text-3xl lg:text-4xl' : 'text-2xl lg:text-3xl';
  return (
    <motion.div
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="card mx-auto w-full max-w-6xl px-8 py-5 text-center"
    >
      <h2 className={`font-display leading-snug font-semibold ${size}`}>{q.prompt}</h2>
    </motion.div>
  );
}

export function QuestionMeta({ q }: { q: QuestionPublic }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-lg">
      <span className="rounded-full bg-white/15 px-4 py-1.5 font-semibold">{TYPE_LABEL[q.type]}</span>
      {q.multiplier > 1 && <span className="rounded-full bg-gold px-4 py-1.5 font-display font-extrabold text-ink">คะแนน ×{q.multiplier}</span>}
      {q.multiplier === 0 && <span className="rounded-full bg-white/15 px-4 py-1.5">ข้อนี้ไม่คิดคะแนน</span>}
      {untimed(q) && <span className="rounded-full bg-white/15 px-4 py-1.5">⏱️ ไม่นับความเร็ว</span>}
    </div>
  );
}

/**
 * The four answer tiles on the big screen. In `reveal` mode the right answers
 * glow and the rest fade back (a poll has no right answer, so nothing fades).
 */
export function AnswerGrid({ options, reveal = false, correct = [] }: { options: string[]; reveal?: boolean; correct?: number[] }) {
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-4">
      {options.map((text, i) => {
        const isCorrect = reveal && correct.includes(i);
        const faded = reveal && correct.length > 0 && !isCorrect;
        return (
          <motion.div
            key={i}
            initial={reveal ? { opacity: 1, y: 0, scale: 1 } : { y: 48, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: faded ? 0.35 : 1, scale: isCorrect ? 1.02 : 1 }}
            transition={{ delay: reveal ? 1 : 0.1 + i * 0.08, type: 'spring', stiffness: 380, damping: 26 }}
            className={`relative flex min-h-24 items-center gap-4 overflow-hidden rounded-2xl px-6 py-4 shadow-[inset_0_-6px_0_rgb(0_0_0/0.22)] ${ANSWER_BG[i]} ${isCorrect ? 'ring-4 ring-white' : ''}`}
          >
            <AnswerShape index={i} className="size-12 shrink-0 text-white drop-shadow" />
            <span className="flex-1 text-2xl leading-snug font-semibold lg:text-3xl">{text}</span>
            {isCorrect && (
              <>
                <motion.span
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 1.15, type: 'spring', stiffness: 400, damping: 14 }}
                  className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-3xl font-extrabold text-good"
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
  return <img src={url} alt="" className="max-h-[32vh] max-w-full rounded-2xl object-contain shadow-2xl" referrerPolicy="no-referrer" />;
}
