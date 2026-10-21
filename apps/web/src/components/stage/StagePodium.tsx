'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Award, LeaderRow, StageState } from '@icebreaker/shared';
import { shower } from '@/lib/confetti';
import { sfx } from '@/lib/sfx';
import { CountUp } from '../motion-bits';

const PLACES = [
  { place: 2, height: 'h-28 sm:h-44 lg:h-52 low:h-[15dvh] short:h-12', medal: '🥈', color: 'from-slate-200 to-slate-400', revealAt: 2 },
  { place: 1, height: 'h-36 sm:h-60 lg:h-72 low:h-[22dvh] short:h-16', medal: '🥇', color: 'from-amber-200 to-gold', revealAt: 3 },
  { place: 3, height: 'h-20 sm:h-32 lg:h-40 low:h-[10dvh] short:h-9', medal: '🥉', color: 'from-orange-200 to-orange-400', revealAt: 1 },
];

/** 3rd, then 2nd, then a drum roll and the winner with confetti, then the awards. */
export function StagePodium({ state }: { state: StageState }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => setTimeout(fn, ms);
    const timers = [
      at(600, () => setStep(1)),
      at(2000, () => setStep(2)),
      at(2600, () => sfx.play('drumroll')),
      at(4250, () => {
        setStep(3);
        sfx.play('fanfare');
        shower(3500);
      }),
      at(5600, () => setStep(4)),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    // a phone on its side has no height for the awards under the stands, so they come in beside them
    <div className="flex h-full flex-col items-center justify-end-safe gap-3 sm:gap-6 low:gap-4 short:flex-row short:items-end-safe short:justify-center short:gap-4">
      {/* moves up (or aside) smoothly when the awards come in */}
      <motion.div layout="position" className="flex w-full max-w-4xl flex-col items-center gap-3 sm:gap-6 low:max-w-3xl low:gap-3 short:max-w-md short:gap-2">
        <motion.h2
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="font-display text-3xl font-extrabold sm:text-5xl lg:text-6xl low:text-4xl short:text-xl"
        >
          {step >= 3 ? 'สุดยอดผู้ชนะ!' : 'ประกาศผล…'}
        </motion.h2>
        <div className="flex w-full items-end justify-center gap-2 sm:gap-4">
          {PLACES.map((p) => (
            <Pedestal key={p.place} {...p} row={state.podium[p.place - 1]} shown={step >= p.revealAt} />
          ))}
        </div>
      </motion.div>
      <AnimatePresence>
        {step >= 4 && state.awards.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex max-w-full flex-wrap justify-center gap-2 sm:gap-4 short:shrink-0 short:flex-col short:flex-nowrap short:pb-1"
          >
            {state.awards.map((a, i) => (
              <AwardCard key={a.kind} award={a} delay={i * 0.25} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Pedestal({
  place,
  height,
  medal,
  color,
  row,
  shown,
}: {
  place: number;
  height: string;
  medal: string;
  color: string;
  row: LeaderRow | undefined;
  shown: boolean;
}) {
  return (
    <div className="flex w-1/3 max-w-72 min-w-0 flex-col items-center">
      {/* the winner also gets a crown, so their slot is taller or it would run into the title */}
      {/* the slot and what is in it take the column's width, so a long name is cut short instead of spilling over */}
      <div
        className={`flex w-full ${place === 1 ? 'h-40 sm:h-56 low:h-44 short:h-32' : 'h-28 sm:h-44 low:h-36 short:h-24'} flex-col items-center justify-end pb-2 sm:pb-3 short:pb-1`}
      >
        <AnimatePresence>
          {shown && row && (
            <motion.div
              initial={{ y: 60, scale: 0.3, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 15 }}
              className="flex w-full flex-col items-center text-center"
            >
              {place === 1 && (
                <motion.span
                  className="text-3xl sm:text-5xl low:text-4xl short:text-2xl"
                  initial={{ y: -40, rotate: -30, opacity: 0 }}
                  animate={{ y: 0, rotate: 0, opacity: 1 }}
                  transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 12 }}
                  aria-hidden
                >
                  👑
                </motion.span>
              )}
              <span className={`animate-bob inline-block ${place === 1 ? 'text-5xl sm:text-7xl low:text-5xl short:text-4xl' : 'text-4xl sm:text-6xl low:text-5xl short:text-4xl'}`} aria-hidden>
                {row.avatar}
              </span>
              <span className="mt-1 max-w-full truncate rounded-full bg-white px-2 py-0.5 text-sm font-semibold text-ink shadow-lg sm:px-4 sm:py-1 sm:text-xl low:text-lg short:text-xs">
                {row.nickname}
              </span>
              <span className="mt-1 font-display text-lg font-extrabold whitespace-nowrap sm:text-2xl low:text-xl short:mt-0.5 short:text-base">
                <CountUp to={row.score} duration={1.4} /> <span className="text-xs font-normal text-white/70 sm:text-base">แต้ม</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.15 * (3 - place), type: 'spring', stiffness: 120, damping: 18 }}
        className={`w-full origin-bottom rounded-t-2xl bg-linear-to-b sm:rounded-t-3xl ${color} ${height} flex justify-center pt-2 shadow-[inset_0_-10px_0_rgb(0_0_0/0.15)] sm:pt-4 low:pt-2 short:pt-0.5`}
      >
        <span className="font-display text-4xl font-extrabold text-ink/70 sm:text-6xl low:text-5xl short:text-2xl">{shown && row ? medal : place}</span>
      </motion.div>
    </div>
  );
}

function AwardCard({ award, delay }: { award: Award; delay: number }) {
  return (
    <motion.div
      initial={{ y: 40, opacity: 0, rotate: -3 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 18 }}
      className="glass flex max-w-full items-center gap-3 px-3 py-2 sm:gap-4 sm:px-5 sm:py-3 low:py-2 short:max-w-48 short:gap-2 short:py-1.5"
    >
      <span className="text-3xl sm:text-4xl short:text-2xl" aria-hidden>
        {award.kind === 'fastest' ? '⚡' : '🔥'}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold tracking-wide text-gold sm:text-sm">{award.title}</div>
        <div className="truncate text-base font-semibold sm:text-xl short:text-sm">
          {award.avatar} {award.nickname}
        </div>
        <div className="text-xs text-white/70 sm:text-sm">{award.value}</div>
      </div>
    </motion.div>
  );
}
