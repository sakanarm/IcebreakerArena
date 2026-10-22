'use client';

import { AnimatePresence, motion, type Transition, type Variants } from 'motion/react';
import { useEffect, useState } from 'react';
import { leadInMs, type QuestionPublic, type StageState } from '@icebreaker/shared';
import { useServerNow } from '@/lib/clock';
import { fmt, fmtValue } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { PopNumber, TimerRing } from '../motion-bits';
import { ANSWER_BG } from '../shapes';
import { AnswerGrid, PromptBar, QuestionImage, QuestionMeta } from './parts';
import { useBlindsShut } from './SceneWipe';

export function StageQuestion({ state }: { state: StageState }) {
  const q = state.question!;
  const now = useServerNow(true, 100);
  const open = now >= q.startsAt;

  return (
    // the lead-in hands over to answering in place: it leaves upward while answering comes in, so the question
    // never leaves the screen (popLayout takes the leaving one out of the flow, over the one coming in)
    <div className="relative flex h-full flex-col">
      {/* a screen opened mid-question (a reload) shows answering as it is, without its entrance */}
      <AnimatePresence mode="popLayout" initial={!open}>
        {open ? (
          <motion.div key="open" className="flex flex-1 flex-col">
            <Answering q={q} now={now} answered={state.answeredCount} players={state.playerCount} />
          </motion.div>
        ) : (
          <motion.div
            key="lead"
            className="flex flex-1 flex-col"
            exit={{ y: -40, scale: 0.92, opacity: 0, transition: { duration: 0.3, ease: 'easeIn' } }}
          >
            <LeadIn q={q} now={now} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** a spring for where things go, and a quick fade for whether they show, so the fade never bounces */
const springIn = (delay: number, stiffness: number, damping: number): Transition => ({
  delay,
  type: 'spring',
  stiffness,
  damping,
  opacity: { delay, duration: 0.15 },
});

// the lead-in's parts, in the order they come in once the blinds have opened over them
const BADGE: Variants = {
  hidden: { y: -60, scale: 0.7, opacity: 0 },
  shown: { y: 0, scale: 1, opacity: 1, transition: springIn(0.08, 420, 18) },
};
const PROMPT: Variants = {
  hidden: { scale: 0.6, opacity: 0 },
  shown: { scale: 1, opacity: 1, transition: springIn(0.2, 180, 17) },
};
const IMAGE: Variants = {
  hidden: { y: 30, scale: 0.9, opacity: 0 },
  shown: { y: 0, scale: 1, opacity: 1, transition: springIn(0.3, 260, 22) },
};
const BAR: Variants = {
  hidden: { y: 16, opacity: 0 },
  shown: { y: 0, opacity: 1, transition: springIn(0.36, 320, 24) },
};

/** The question alone on screen while everyone reads it, then 3-2-1. */
function LeadIn({ q, now }: { q: QuestionPublic; now: number }) {
  // its parts wait under the shut blinds and come in as they open, so what the room sees first is their entrance
  const shut = useBlindsShut();
  const total = leadInMs(q.prompt);
  const left = Math.max(0, q.startsAt - now);
  const secs = Math.ceil(left / 1000);
  const [startLeft] = useState(left);
  const last = q.total > 1 && q.number === q.total;

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
      initial="hidden"
      animate={shut ? 'hidden' : 'shown'}
      className="flex flex-1 flex-col items-center justify-center-safe gap-5 text-center sm:gap-8 low:gap-4 short:gap-2"
    >
      <QuestionMeta q={q} pop>
        <motion.span
          variants={BADGE}
          className={`rounded-full px-4 py-1 font-display font-extrabold text-ink shadow-lg sm:px-5 sm:py-1.5 ${last ? 'bg-gold' : 'bg-white'}`}
        >
          {last ? 'ข้อสุดท้าย!' : `ข้อ ${q.number} จาก ${q.total}`}
        </motion.span>
      </QuestionMeta>
      <motion.h2 variants={PROMPT} className={`max-w-5xl font-display leading-tight font-semibold break-words drop-shadow-lg ${size}`}>
        {q.prompt}
      </motion.h2>
      {q.imageUrl && <QuestionImage url={q.imageUrl} variants={IMAGE} />}
      <motion.div variants={BAR} className="flex h-16 shrink-0 items-center gap-4 sm:h-24 sm:gap-6 low:h-20 short:h-12">
        <ReadBar total={total} startLeft={startLeft} />
        {/* each number lands from above onto its seat: grown from the middle it would reach past the bottom of a short
            screen while it lands, and the page would scroll for a moment */}
        <AnimatePresence mode="popLayout">
          {secs >= 1 && secs <= 3 && (
            <motion.span
              key={secs}
              initial={{ scale: 2.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              className="grid size-14 origin-bottom place-items-center rounded-full bg-white font-display text-3xl font-extrabold text-ink sm:size-20 sm:text-5xl low:size-16 low:text-4xl short:size-11 short:text-2xl"
            >
              {secs}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

/**
 * Time to read, as four segments in the answer colors filling one after another: the answers open as the last one
 * fills. Runs on the clock from when it mounted, so one opened partway through starts partway along.
 */
function ReadBar({ total, startLeft }: { total: number; startLeft: number }) {
  const gone = Math.min(1, Math.max(0, 1 - startLeft / total));
  return (
    <div className="flex h-3 w-44 gap-1 sm:h-4 sm:w-80 sm:gap-1.5" aria-hidden>
      {[0, 1, 2, 3].map((k) => {
        const from = Math.min(1, Math.max(0, gone * 4 - k));
        return (
          <div key={k} className="h-full flex-1 overflow-hidden rounded-full bg-white/15">
            <motion.div
              className={`h-full origin-left rounded-full ${ANSWER_BG[k]}`}
              initial={{ scaleX: from }}
              animate={{ scaleX: 1 }}
              transition={{ delay: Math.max(0, k / 4 - gone) * (total / 1000), duration: ((1 - from) * total) / 4000, ease: 'linear' }}
            />
          </div>
        );
      })}
    </div>
  );
}

const STAMP = {
  all: { text: 'ตอบครบแล้ว!', tone: 'bg-good' },
  time: { text: 'หมดเวลา!', tone: 'bg-bad' },
} as const;

function Answering({ q, now, answered, players }: { q: QuestionPublic; now: number; answered: number; players: number }) {
  useEffect(() => {
    sfx.play('go');
    sfx.music('question');
    return () => sfx.music(null);
  }, []);

  // the last five seconds: the music hurries along with the ring
  const hurry = q.endsAt - now <= 5000;
  useEffect(() => {
    if (!hurry) return;
    sfx.hurry(true);
    return () => sfx.hurry(false);
  }, [hurry]);

  // what closed answering, stamped over the middle until the reveal; the first one stays (an answer let in just
  // after time ran out may complete the count)
  const ended = players > 0 && answered >= players ? 'all' : now >= q.endsAt ? 'time' : null;
  const [stamp, setStamp] = useState<typeof ended>(null);
  if (ended && !stamp) setStamp(ended);

  return (
    <div className="flex flex-1 flex-col gap-3 sm:gap-5 low:gap-3 short:gap-2">
      <PromptBar q={q} from="lead-in" />
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-between gap-3 sm:gap-6">
        <motion.div
          className="shrink-0"
          initial={{ rotate: -160, scale: 0.2, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={springIn(0.05, 260, 18)}
        >
          <TimerRing startsAt={q.startsAt} endsAt={q.endsAt} className="size-[4.5rem] sm:size-[150px] low:size-28 short:size-[4.5rem]" ticks />
        </motion.div>
        <div className="relative flex min-w-0 flex-1 flex-col self-stretch">
          <motion.div
            className="flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-2 sm:gap-3"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={stamp ? { scale: 0.92, opacity: 0.15 } : { scale: 1, opacity: 1 }}
            transition={stamp ? { duration: 0.15 } : springIn(0.12, 300, 24)}
          >
            {q.imageUrl ? <QuestionImage url={q.imageUrl} /> : <QuestionMeta q={q} />}
            {/* beside the timer, where there is height to spare, rather than a row of its own */}
            {q.type === 'puzzle' && <p className="text-center text-lg text-white/80 sm:text-2xl low:text-xl short:text-base">🧩 เรียงลำดับให้ถูกในมือถือ</p>}
          </motion.div>
          {stamp && <Stamp {...STAMP[stamp]} />}
        </div>
        <motion.div
          className="glass relative flex shrink-0 flex-col items-center px-3 py-2 text-center sm:min-w-36 sm:px-6 sm:py-4 low:py-3 short:py-1.5"
          initial={{ x: 60, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={springIn(0.15, 380, 26)}
        >
          <PopNumber value={answered} className="font-display text-3xl font-extrabold sm:text-6xl low:text-5xl short:text-3xl" />
          <span className="text-sm whitespace-nowrap text-white/75 sm:text-lg">ตอบแล้ว{players ? ` / ${fmt(players)}` : ''}</span>
          {/* how many are in so far, along the card's foot: no height of its own */}
          {players > 0 && (
            <span className="absolute inset-x-3 bottom-1.5 h-1 overflow-hidden rounded-full bg-white/20 sm:inset-x-5 sm:bottom-2 sm:h-1.5 short:bottom-1" aria-hidden>
              <motion.span
                className="block h-full origin-left rounded-full bg-good"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: Math.min(1, answered / players) }}
                transition={{ type: 'spring', stiffness: 220, damping: 26 }}
              />
            </span>
          )}
        </motion.div>
      </div>
      {q.type === 'type' ? (
        <PhoneHint emoji="⌨️" text="พิมพ์คำตอบในมือถือ" />
      ) : q.type === 'slider' && q.slider ? (
        <ScaleHint slider={q.slider} />
      ) : (
        <AnswerGrid options={q.options} />
      )}
    </div>
  );
}

/** "หมดเวลา!" or "ตอบครบแล้ว!" slammed down over the middle, with a ring going out from where it lands */
function Stamp({ text, tone }: { text: string; tone: string }) {
  return (
    // sized to the middle it lands in, so on a narrow screen it stays clear of the timer and the counter
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center [container-type:inline-size]" role="status">
      <motion.span
        initial={{ scale: 2.4, rotate: -14, opacity: 0 }}
        animate={{ scale: 1, rotate: -6, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 520, damping: 22, opacity: { duration: 0.1 } }}
        className={`relative rounded-2xl border-4 border-white px-[0.5em] py-[0.15em] font-display text-[clamp(1rem,11cqw,3.75rem)] font-extrabold whitespace-nowrap text-white shadow-2xl low:text-[clamp(1rem,11cqw,3rem)] short:text-[clamp(1rem,11cqw,1.5rem)] ${tone}`}
      >
        {text}
        <motion.span
          className="absolute -inset-1 rounded-2xl border-4 border-white"
          initial={{ scale: 1, opacity: 0.8 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ delay: 0.12, duration: 0.5, ease: 'easeOut' }}
          aria-hidden
        />
      </motion.span>
    </div>
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
