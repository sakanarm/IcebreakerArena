'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { leadInMs, type QuestionPublic, type StageState } from '@icebreaker/shared';
import { useServerNow } from '@/lib/clock';
import { fmt, fmtValue } from '@/lib/format';
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
      {q.type === 'type' ? (
        <PhoneHint emoji="⌨️" text="พิมพ์คำตอบในมือถือ" />
      ) : q.type === 'slider' && q.slider ? (
        <ScaleHint slider={q.slider} />
      ) : (
        <>
          {q.type === 'puzzle' && <p className="text-center text-2xl text-white/80">🧩 เรียงลำดับให้ถูกในมือถือ</p>}
          <AnswerGrid options={q.options} />
        </>
      )}
    </motion.div>
  );
}

/** in place of the answer tiles when the answer isn't one of them */
function PhoneHint({ emoji, text }: { emoji: string; text: string }) {
  return (
    <motion.div
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.1, type: 'spring', stiffness: 380, damping: 26 }}
      className="glass mx-auto flex min-h-40 w-full max-w-6xl items-center justify-center gap-5 px-8 py-6"
    >
      <motion.span className="text-7xl" animate={{ y: [0, -10, 0] }} transition={{ duration: 1.4, repeat: Infinity }} aria-hidden>
        {emoji}
      </motion.span>
      <span className="font-display text-4xl font-semibold">{text}</span>
      <motion.span
        className="h-12 w-1.5 rounded-full bg-white"
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        aria-hidden
      />
    </motion.div>
  );
}

/** the slider's scale with a knob drifting back and forth: "pick a number between these" */
function ScaleHint({ slider }: { slider: NonNullable<QuestionPublic['slider']> }) {
  return (
    <motion.div
      initial={{ y: 48, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay: 0.1, type: 'spring', stiffness: 380, damping: 26 }}
      className="glass mx-auto flex w-full max-w-6xl flex-col gap-5 px-10 py-6"
    >
      <div className="text-center font-display text-3xl font-semibold">🎚️ เลื่อนเลือกตัวเลขในมือถือ</div>
      <div className="relative h-4 rounded-full bg-white/25">
        <motion.span
          className="absolute top-1/2 size-10 -translate-1/2 rounded-full border-[6px] border-gold bg-white shadow-xl"
          animate={{ left: ['15%', '85%', '15%'] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden
        />
      </div>
      <div className="flex justify-between font-display text-3xl font-semibold tabular-nums">
        <span>{fmtValue(slider.min, slider.unit)}</span>
        <span>{fmtValue(slider.max, slider.unit)}</span>
      </div>
    </motion.div>
  );
}
