'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { leadInMs, type QuestionPublic, type StageState } from '@icebreaker/shared';
import { useServerNow } from '@/lib/clock';
import { fmt } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { PopNumber, TimerRing } from '../motion-bits';
import { AnswerGrid, PromptBar, QuestionImage, QuestionMeta } from './parts';

export function StageQuestion({ state }: { state: StageState }) {
  const q = state.question!;
  const now = useServerNow(true, 100);
  const open = now >= q.startsAt;

  return (
    <div className="flex h-full flex-col">
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <Answering key="open" q={q} answered={state.answeredCount} players={state.playerCount} />
        ) : (
          <LeadIn key="lead" q={q} now={now} />
        )}
      </AnimatePresence>
    </div>
  );
}

/** The question alone on screen while everyone reads it, then 3-2-1. */
function LeadIn({ q, now }: { q: QuestionPublic; now: number }) {
  const total = leadInMs(q.prompt);
  const left = Math.max(0, q.startsAt - now);
  const secs = Math.ceil(left / 1000);
  const [startLeft] = useState(left);

  useEffect(() => {
    if (secs >= 1 && secs <= 3) sfx.play('count');
  }, [secs]);

  return (
    <motion.div exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.2 }} className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
      <QuestionMeta q={q} />
      <motion.h2
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 17 }}
        className="max-w-5xl font-display text-5xl leading-tight font-semibold drop-shadow-lg lg:text-6xl"
      >
        {q.prompt}
      </motion.h2>
      {q.imageUrl && <QuestionImage url={q.imageUrl} />}
      <div className="flex h-24 items-center gap-6">
        <div className="h-3 w-80 overflow-hidden rounded-full bg-white/15">
          <motion.div
            className="h-full origin-left rounded-full bg-gold"
            initial={{ scaleX: Math.min(1, startLeft / total) }}
            animate={{ scaleX: 0 }}
            transition={{ duration: startLeft / 1000, ease: 'linear' }}
          />
        </div>
        <AnimatePresence mode="popLayout">
          {secs >= 1 && secs <= 3 && (
            <motion.span
              key={secs}
              initial={{ scale: 2.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              className="grid size-20 place-items-center rounded-full bg-white font-display text-5xl font-extrabold text-ink"
            >
              {secs}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Answering({ q, answered, players }: { q: QuestionPublic; answered: number; players: number }) {
  useEffect(() => {
    sfx.play('go');
    sfx.music('question');
    return () => sfx.music(null);
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 flex-col gap-5">
      <PromptBar q={q} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-between gap-6">
        <TimerRing startsAt={q.startsAt} endsAt={q.endsAt} size={150} ticks />
        <div className="flex min-w-0 flex-1 justify-center">{q.imageUrl ? <QuestionImage url={q.imageUrl} /> : <QuestionMeta q={q} />}</div>
        <div className="glass flex min-w-36 flex-col items-center px-6 py-4 text-center">
          <PopNumber value={answered} className="font-display text-6xl font-extrabold" />
          <span className="text-lg text-white/75">ตอบแล้ว{players ? ` / ${fmt(players)}` : ''}</span>
        </div>
      </div>
      <AnswerGrid options={q.options} />
    </motion.div>
  );
}
