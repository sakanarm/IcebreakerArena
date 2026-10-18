'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { Award, LeaderRow, StageState } from '@icebreaker/shared';
import { shower } from '@/lib/confetti';
import { sfx } from '@/lib/sfx';
import { CountUp } from '../motion-bits';

const PLACES = [
  { place: 2, height: 'h-44 lg:h-52', medal: '🥈', color: 'from-slate-200 to-slate-400', revealAt: 2 },
  { place: 1, height: 'h-60 lg:h-72', medal: '🥇', color: 'from-amber-200 to-gold', revealAt: 3 },
  { place: 3, height: 'h-32 lg:h-40', medal: '🥉', color: 'from-orange-200 to-orange-400', revealAt: 1 },
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
    <div className="flex h-full flex-col items-center justify-end gap-6">
      <motion.h2
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="font-display text-5xl font-extrabold lg:text-6xl"
      >
        {step >= 3 ? 'สุดยอดผู้ชนะ!' : 'ประกาศผล…'}
      </motion.h2>
      <div className="flex w-full max-w-4xl items-end justify-center gap-4">
        {PLACES.map((p) => (
          <Pedestal key={p.place} {...p} row={state.podium[p.place - 1]} shown={step >= p.revealAt} />
        ))}
      </div>
      <AnimatePresence>
        {step >= 4 && state.awards.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap justify-center gap-4">
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
    <div className="flex w-1/3 max-w-72 flex-col items-center">
      {/* the winner also gets a crown, so their slot is taller or it would run into the title */}
      <div className={`flex ${place === 1 ? 'h-56' : 'h-44'} flex-col items-center justify-end pb-3`}>
        <AnimatePresence>
          {shown && row && (
            <motion.div
              initial={{ y: 60, scale: 0.3, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 15 }}
              className="flex flex-col items-center text-center"
            >
              {place === 1 && (
                <motion.span
                  className="text-5xl"
                  initial={{ y: -40, rotate: -30, opacity: 0 }}
                  animate={{ y: 0, rotate: 0, opacity: 1 }}
                  transition={{ delay: 0.35, type: 'spring', stiffness: 300, damping: 12 }}
                  aria-hidden
                >
                  👑
                </motion.span>
              )}
              <span className={`animate-bob inline-block ${place === 1 ? 'text-7xl' : 'text-6xl'}`} aria-hidden>
                {row.avatar}
              </span>
              <span className="mt-1 max-w-full truncate rounded-full bg-white px-4 py-1 text-xl font-semibold text-ink shadow-lg">
                {row.nickname}
              </span>
              <span className="mt-1 font-display text-2xl font-extrabold">
                <CountUp to={row.score} duration={1.4} /> <span className="text-base font-normal text-white/70">แต้ม</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ delay: 0.15 * (3 - place), type: 'spring', stiffness: 120, damping: 18 }}
        className={`w-full origin-bottom rounded-t-3xl bg-linear-to-b ${color} ${height} flex justify-center pt-4 shadow-[inset_0_-10px_0_rgb(0_0_0/0.15)]`}
      >
        <span className="font-display text-6xl font-extrabold text-ink/70">{shown && row ? medal : place}</span>
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
      className="glass flex items-center gap-4 px-5 py-3"
    >
      <span className="text-4xl" aria-hidden>
        {award.kind === 'fastest' ? '⚡' : '🔥'}
      </span>
      <div>
        <div className="text-sm font-semibold tracking-wide text-gold">{award.title}</div>
        <div className="text-xl font-semibold">
          {award.avatar} {award.nickname}
        </div>
        <div className="text-sm text-white/70">{award.value}</div>
      </div>
    </motion.div>
  );
}
