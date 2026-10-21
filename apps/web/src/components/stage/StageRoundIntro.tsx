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
  // a round's name runs up to 120 letters: the long ones get smaller type, on a projector as on a phone
  const size =
    round.title.length <= 24
      ? 'text-5xl sm:text-7xl lg:text-9xl short:text-5xl'
      : round.title.length <= 60
        ? 'text-4xl sm:text-6xl lg:text-7xl short:text-3xl'
        : 'text-3xl sm:text-5xl lg:text-6xl short:text-2xl';

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

      <div className="w-full max-w-6xl min-w-0 px-1 text-center sm:px-6">
        <motion.p
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="inline-flex rounded-full bg-black/20 px-4 py-1 font-display text-lg font-semibold text-white/90 sm:px-6 sm:py-1.5 sm:text-2xl lg:text-3xl short:text-base"
        >
          ด่าน {round.index + 1} / {round.total}
        </motion.p>
        <motion.h1
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 240, damping: 16 }}
          className={`mt-3 font-display leading-tight font-extrabold text-balance break-words drop-shadow-[0_6px_0_rgb(0_0_0/0.18)] sm:mt-5 lg:leading-tight short:mt-1 ${size}`}
        >
          {round.title}
        </motion.h1>
        {round.subtitle && (
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.75 }}
            className="mt-2 text-lg break-words text-white/90 sm:mt-4 sm:text-2xl lg:text-3xl short:mt-1 short:text-lg"
          >
            {round.subtitle}
          </motion.p>
        )}
        <motion.div
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.95 }}
          className="mt-5 flex flex-wrap justify-center gap-2 sm:mt-8 sm:gap-3 short:mt-3"
        >
          <span className="rounded-full bg-black/20 px-4 py-1.5 font-display text-base font-semibold sm:px-5 sm:py-2 sm:text-xl short:py-1">{round.questionCount} ข้อ</span>
          {round.multiplier > 1 && (
            <motion.span
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 1.1, repeat: Infinity }}
              className="rounded-full bg-gold px-4 py-1.5 font-display text-base font-extrabold text-ink shadow-lg sm:px-5 sm:py-2 sm:text-xl short:py-1"
            >
              คะแนน ×{round.multiplier}
            </motion.span>
          )}
          {!round.timed && (
            <span className="rounded-full bg-black/20 px-4 py-1.5 font-display text-base font-semibold sm:px-5 sm:py-2 sm:text-xl short:py-1">
              ⏱️ ไม่นับความเร็ว ขอแค่ตอบถูก
            </span>
          )}
        </motion.div>

        {/* counts down to the first question; sits in the content so the host dock can't cover it */}
        <div className="mx-auto mt-6 h-2.5 w-56 overflow-hidden rounded-full bg-black/20 sm:mt-10 sm:w-72 short:mt-4" aria-hidden>
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
