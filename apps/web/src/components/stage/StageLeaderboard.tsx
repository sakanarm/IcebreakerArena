'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { LeaderRow, StageState } from '@icebreaker/shared';
import { fmt, roundLabel } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { CountUp } from '../motion-bits';

/** how long the old order stays up before the rows swap places */
const SWAP_AFTER_MS = 1200;

export function StageLeaderboard({ state }: { state: StageState }) {
  const rows = state.leaderboard;
  const [swapped, setSwapped] = useState(false);

  useEffect(() => {
    sfx.play('drumroll');
    const t = setTimeout(() => setSwapped(true), SWAP_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  // first the previous order with the previous scores, then everyone slides to their new place
  const ordered = swapped ? rows : [...rows].sort((a, b) => (a.prevRank ?? Infinity) - (b.prevRank ?? Infinity));

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl flex-col justify-center">
      <motion.h2
        initial={{ y: -30, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="text-center font-display text-6xl font-extrabold"
      >
        🏆 อันดับคะแนน
      </motion.h2>
      {state.round && (
        <p className="mt-2 text-center text-xl text-white/70">{roundLabel(state.round.index, state.round.title)}</p>
      )}
      {rows.length === 0 ? (
        <p className="mt-10 text-center text-2xl text-white/70">ยังไม่มีคะแนน</p>
      ) : (
        <ol className="mt-8 flex flex-col gap-3">
          {ordered.map((r, i) => (
            <Row key={r.id} row={r} index={i} swapped={swapped} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Row({ row, index, swapped }: { row: LeaderRow; index: number; swapped: boolean }) {
  const climbed = row.prevRank !== null ? row.prevRank - row.rank : 0;
  const gained = row.score - row.prevScore;
  const leader = swapped && row.rank === 1;

  return (
    <motion.li
      layout
      initial={{ x: -80, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{
        delay: swapped ? 0 : index * 0.07,
        type: 'spring',
        stiffness: 320,
        damping: 26,
        layout: { type: 'spring', stiffness: 260, damping: 28 },
      }}
      className={`flex items-center gap-4 rounded-2xl px-6 py-4 shadow-xl transition-colors duration-500 ${leader ? 'bg-gold text-ink' : 'bg-white text-ink'}`}
    >
      <span className="w-12 font-display text-3xl font-extrabold tabular-nums">{swapped ? row.rank : (row.prevRank ?? '–')}</span>
      <span className="text-4xl" aria-hidden>
        {row.avatar}
      </span>
      <span className="min-w-0 flex-1 truncate text-2xl font-semibold">{row.nickname}</span>
      {row.streak >= 2 && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="rounded-full bg-ink/10 px-3 py-1 font-display text-lg font-semibold"
          title={`ตอบถูกติดกัน ${row.streak} ข้อ`}
        >
          🔥 {row.streak}
        </motion.span>
      )}
      {swapped && climbed > 0 && (
        <motion.span
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="font-display text-xl font-extrabold text-good"
        >
          ▲{climbed}
        </motion.span>
      )}
      {swapped && gained > 0 && (
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.15, type: 'spring', stiffness: 500, damping: 18 }}
          className="rounded-full bg-good px-3 py-1 font-display text-lg font-semibold text-white"
        >
          +{fmt(gained)}
        </motion.span>
      )}
      <span className="w-36 text-right font-display text-3xl font-extrabold">
        {swapped ? <CountUp from={row.prevScore} to={row.score} duration={1.1} /> : fmt(row.prevScore)}
      </span>
    </motion.li>
  );
}
