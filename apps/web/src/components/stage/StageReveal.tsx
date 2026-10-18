'use client';

import { motion } from 'motion/react';
import { useEffect } from 'react';
import type { QuestionPublic, RevealInfo, StageState } from '@icebreaker/shared';
import { fmt, percent, secondsLabel } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { ANSWER_BG, AnswerShape } from '../shapes';
import { AnswerGrid, PromptBar } from './parts';

export function StageReveal({ state }: { state: StageState }) {
  const q = state.question!;
  const r = state.reveal!;
  const poll = q.type === 'poll';
  const max = Math.max(1, ...r.counts);

  useEffect(() => {
    sfx.play('reveal');
  }, []);

  return (
    <div className="flex h-full flex-col gap-5">
      <PromptBar q={q} />
      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-end justify-center gap-10">
        {/* bars are a share of whatever height the screen leaves, so a 1080p projector isn't half empty */}
        <div
          className="flex h-full max-h-[34rem] items-end gap-5"
          role="img"
          aria-label={`ผลการตอบ: ${r.counts.map((c, i) => `${q.options[i]} ${c} คน`).join(', ')}`}
        >
          {q.options.map((_, i) => {
            const correct = r.correct.includes(i);
            const faded = !poll && !correct;
            const pct = Math.max(3, ((r.counts[i] ?? 0) / max) * 100);
            return (
              <div key={i} className="flex h-full w-24 flex-col lg:w-28">
                {/* the top margin leaves room for the count above the tallest bar */}
                <div className="relative mt-14 min-h-0 flex-1">
                  <motion.div
                    className={`absolute inset-x-0 bottom-0 origin-bottom rounded-t-xl ${ANSWER_BG[i]}`}
                    style={{ height: `${pct}%` }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1, opacity: faded ? 0.35 : 1 }}
                    transition={{
                      scaleY: { delay: 0.15 + i * 0.1, type: 'spring', stiffness: 150, damping: 19 },
                      opacity: { delay: 1 },
                    }}
                  />
                  <motion.span
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.55 + i * 0.1 }}
                    className="absolute inset-x-0 mb-2 text-center font-display text-4xl font-extrabold tabular-nums"
                    style={{ bottom: `${pct}%` }}
                  >
                    {fmt(r.counts[i] ?? 0)}
                  </motion.span>
                </div>
                <div className={`flex w-full items-center justify-center gap-1.5 rounded-b-xl py-2 ${ANSWER_BG[i]} ${faded ? 'opacity-60' : ''}`}>
                  <AnswerShape index={i} className="size-7 text-white" />
                  {correct && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 1.05, type: 'spring', stiffness: 500, damping: 14 }}
                      className="text-2xl font-extrabold"
                    >
                      ✓
                    </motion.span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <RevealStats q={q} r={r} />
      </div>
      <AnswerGrid options={q.options} reveal correct={r.correct} />
    </div>
  );
}

function RevealStats({ q, r }: { q: QuestionPublic; r: RevealInfo }) {
  const silent = r.totalPlayers - r.answered;
  return (
    <motion.div
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay: 0.8, type: 'spring', stiffness: 260, damping: 24 }}
      className="glass mb-2 flex min-w-64 flex-col gap-3 px-6 py-5"
    >
      {q.type === 'poll' ? (
        <>
          <div className="text-white/70">ผลโหวต</div>
          <div className="font-display text-5xl font-extrabold">🗳️ {fmt(r.answered)}</div>
          <div className="text-lg text-white/80">เสียง</div>
        </>
      ) : (
        <>
          <div className="text-white/70">ตอบถูก</div>
          <div className="font-display text-5xl font-extrabold">
            {fmt(r.correctCount)}
            <span className="text-2xl text-white/60"> / {fmt(r.answered)}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
            <motion.div
              className="h-full origin-left rounded-full bg-good"
              style={{ width: `${percent(r.correctCount, r.answered)}%` }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 1.1, duration: 0.8, ease: 'easeOut' }}
            />
          </div>
          <div className="text-lg text-white/80">
            {percent(r.correctCount, r.answered)}% · เวลาเฉลี่ย {secondsLabel(r.avgCorrectMs)}
          </div>
        </>
      )}
      {silent > 0 && <div className="text-sm text-white/55">ไม่ได้ตอบ {fmt(silent)} คน</div>}
    </motion.div>
  );
}
