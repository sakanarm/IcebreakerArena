'use client';

import { motion } from 'motion/react';
import { useEffect } from 'react';
import type { RoundInfo } from '@icebreaker/shared';
import { sfx } from '@/lib/sfx';
import { ANSWER_BG, AnswerShape } from '../shapes';

/** must match the server's ROUND_INTRO_MS: the card moves on by itself */
const INTRO_S = 3.5;

export function StageRoundIntro({ round }: { round: RoundInfo }) {
  useEffect(() => {
    sfx.play('whoosh');
  }, []);

  const color = round.index % 4;

  return (
    <div className="relative isolate grid h-full place-items-center">
      {/* full-bleed: the color runs behind the header and the host dock, not just this padded scene */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {/* two-layer wipe across the screen */}
        <motion.div
          className="absolute inset-0 origin-left bg-white/90"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: [0, 1, 1] }}
          transition={{ duration: 0.5, times: [0, 0.6, 1], ease: [0.7, 0, 0.2, 1] }}
        />
        <motion.div
          className={`absolute inset-0 origin-left ${ANSWER_BG[color]}`}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 0.12, duration: 0.55, ease: [0.7, 0, 0.2, 1] }}
        />
        <motion.div
          className="absolute -right-24 -bottom-28 size-[36rem] text-white/15"
          initial={{ rotate: -40, scale: 0.6, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, duration: 1.2, ease: 'easeOut' }}
        >
          <AnswerShape index={color} className="h-full w-full" />
        </motion.div>
        <motion.div
          className="absolute -top-20 -left-16 size-80 text-black/10"
          initial={{ rotate: 30, opacity: 0 }}
          animate={{ rotate: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 1.2 }}
        >
          <AnswerShape index={(color + 2) % 4} className="h-full w-full" />
        </motion.div>
      </div>

      <div className="max-w-6xl px-6 text-center">
        <motion.p
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="inline-flex rounded-full bg-black/20 px-6 py-1.5 font-display text-2xl font-semibold text-white/90 lg:text-3xl"
        >
          ด่าน {round.index + 1} / {round.total}
        </motion.p>
        <motion.h1
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 240, damping: 16 }}
          className="mt-5 font-display text-7xl leading-tight font-extrabold text-balance drop-shadow-[0_6px_0_rgb(0_0_0/0.18)] lg:text-9xl lg:leading-tight"
        >
          {round.title}
        </motion.h1>
        {round.subtitle && (
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.75 }}
            className="mt-4 text-2xl text-white/90 lg:text-3xl"
          >
            {round.subtitle}
          </motion.p>
        )}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.95 }}
          className="mt-8 flex flex-wrap justify-center gap-3"
        >
          <span className="rounded-full bg-black/20 px-5 py-2 font-display text-xl font-semibold">{round.questionCount} ข้อ</span>
          {round.multiplier > 1 && (
            <motion.span
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.1, repeat: Infinity }}
              className="rounded-full bg-gold px-5 py-2 font-display text-xl font-extrabold text-ink shadow-lg"
            >
              คะแนน ×{round.multiplier}
            </motion.span>
          )}
          {!round.timed && (
            <span className="rounded-full bg-black/20 px-5 py-2 font-display text-xl font-semibold">⏱️ ไม่นับความเร็ว ขอแค่ตอบถูก</span>
          )}
        </motion.div>

        {/* counts down to the first question; sits in the content so the host dock can't cover it */}
        <div className="mx-auto mt-10 h-2.5 w-72 overflow-hidden rounded-full bg-black/20" aria-hidden>
          <motion.div
            className="h-full origin-left rounded-full bg-white/85"
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: INTRO_S, ease: 'linear' }}
          />
        </div>
      </div>
    </div>
  );
}
