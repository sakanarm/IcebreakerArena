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

  // a long question gets smaller letters, or on a phone it would run off the screen
  const size =
    q.prompt.length <= 60
      ? 'text-3xl sm:text-5xl lg:text-6xl low:text-5xl short:text-3xl'
      : q.prompt.length <= 120
        ? 'text-2xl sm:text-4xl lg:text-5xl low:text-4xl short:text-2xl'
        : 'text-xl sm:text-3xl lg:text-4xl low:text-3xl short:text-xl';

  return (
    <motion.div
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="flex flex-1 flex-col items-center justify-center-safe gap-5 text-center sm:gap-8 low:gap-4 short:gap-2"
    >
      <QuestionMeta q={q} />
      <motion.h2
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 180, damping: 17 }}
        className={`max-w-5xl font-display leading-tight font-semibold break-words drop-shadow-lg ${size}`}
      >
        {q.prompt}
      </motion.h2>
      {q.imageUrl && <QuestionImage url={q.imageUrl} />}
      <div className="flex h-16 shrink-0 items-center gap-4 sm:h-24 sm:gap-6 low:h-20 short:h-12">
        <div className="h-3 w-44 overflow-hidden rounded-full bg-white/15 sm:w-80">
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
              className="grid size-14 place-items-center rounded-full bg-white font-display text-3xl font-extrabold text-ink sm:size-20 sm:text-5xl low:size-16 low:text-4xl short:size-11 short:text-2xl"
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
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 flex-col gap-3 sm:gap-5 low:gap-3 short:gap-2">
      <PromptBar q={q} />
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-between gap-3 sm:gap-6">
        <TimerRing startsAt={q.startsAt} endsAt={q.endsAt} className="size-[4.5rem] sm:size-[150px] low:size-28 short:size-[4.5rem]" ticks />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 sm:gap-3">
          {q.imageUrl ? <QuestionImage url={q.imageUrl} /> : <QuestionMeta q={q} />}
          {/* beside the timer, where there is height to spare, rather than a row of its own */}
          {q.type === 'puzzle' && <p className="text-center text-lg text-white/80 sm:text-2xl low:text-xl short:text-base">🧩 เรียงลำดับให้ถูกในมือถือ</p>}
        </div>
        <div className="glass flex shrink-0 flex-col items-center px-3 py-2 text-center sm:min-w-36 sm:px-6 sm:py-4 low:py-3 short:py-1.5">
          <PopNumber value={answered} className="font-display text-3xl font-extrabold sm:text-6xl low:text-5xl short:text-3xl" />
          <span className="text-sm whitespace-nowrap text-white/75 sm:text-lg">ตอบแล้ว{players ? ` / ${fmt(players)}` : ''}</span>
        </div>
      </div>
      {q.type === 'type' ? (
        <PhoneHint emoji="⌨️" text="พิมพ์คำตอบในมือถือ" />
      ) : q.type === 'slider' && q.slider ? (
        <ScaleHint slider={q.slider} />
      ) : (
        <AnswerGrid options={q.options} />
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
      className="glass mx-auto flex min-h-24 w-full max-w-6xl items-center justify-center gap-3 px-4 py-4 sm:min-h-40 sm:gap-5 sm:px-8 sm:py-6 low:min-h-32 low:py-4 short:min-h-20 short:py-3"
    >
      <motion.span className="text-4xl sm:text-7xl short:text-5xl" animate={{ y: [0, -10, 0] }} transition={{ duration: 1.4, repeat: Infinity }} aria-hidden>
        {emoji}
      </motion.span>
      <span className="font-display text-xl font-semibold sm:text-4xl short:text-3xl">{text}</span>
      <motion.span
        className="h-8 w-1 rounded-full bg-white sm:h-12 sm:w-1.5"
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
      className="glass mx-auto flex w-full max-w-6xl flex-col gap-3 px-5 py-4 sm:gap-5 sm:px-10 sm:py-6 low:gap-4 low:py-4 short:gap-2 short:py-2.5"
    >
      <div className="text-center font-display text-lg font-semibold sm:text-3xl short:text-xl">🎚️ เลื่อนเลือกตัวเลขในมือถือ</div>
      {/* on a phone on its side the ends stand either side of the track, a row's height saved */}
      <div className="flex flex-col gap-3 sm:gap-5 low:gap-4 short:flex-row short:items-center short:gap-4">
        <div className="relative h-3 rounded-full bg-white/25 sm:h-4 short:order-2 short:min-w-24 short:flex-1">
          <motion.span
            className="absolute top-1/2 size-8 -translate-1/2 rounded-full border-[5px] border-gold bg-white shadow-xl sm:size-10 sm:border-[6px] short:size-8 short:border-[5px]"
            animate={{ left: ['15%', '85%', '15%'] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            aria-hidden
          />
        </div>
        {/* a long unit goes onto a second line under its number, never into the other end's */}
        <div className="flex items-start justify-between gap-4 font-display text-xl leading-snug font-semibold tabular-nums sm:text-3xl short:contents short:text-xl">
          <span className="short:order-1 short:max-w-[35%] short:break-words">{fmtValue(slider.min, slider.unit)}</span>
          <span className="text-right short:order-3 short:max-w-[35%] short:break-words">{fmtValue(slider.max, slider.unit)}</span>
        </div>
      </div>
    </motion.div>
  );
}
