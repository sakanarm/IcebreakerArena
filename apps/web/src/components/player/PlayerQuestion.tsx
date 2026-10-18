'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { QuestionPublic } from '@icebreaker/shared';
import { useServerNow } from '@/lib/clock';
import { TYPE_LABEL } from '@/lib/format';
import { sfx, vibrate } from '@/lib/sfx';
import { TimerRing, WaitingDots } from '../motion-bits';
import { ANSWER_BG, ANSWER_NAMES, AnswerShape } from '../shapes';

const WAITING_LINES = ['ใจเย็นๆ รอเฉลยแป๊บ', 'มั่นใจแค่ไหนเนี่ย?', 'ตอบไวแบบนี้ มีลุ้น!', 'ดูเฉลยบนจอใหญ่ได้เลย', 'ลุ้นๆๆ'];

/** One question on the phone: read it, 3-2-1, tap an answer, wait for the reveal. */
export function PlayerQuestion({
  q,
  myAnswer,
  late,
  onAnswer,
}: {
  q: QuestionPublic;
  myAnswer: number | null;
  late: boolean;
  onAnswer: (choice: number) => void;
}) {
  const now = useServerNow(true, 100);
  const view = myAnswer !== null ? 'sent' : now < q.startsAt ? 'lead' : now > q.endsAt ? 'timeup' : 'pad';

  return (
    <AnimatePresence mode="wait">
      {view === 'lead' && <LeadIn key="lead" q={q} now={now} />}
      {view === 'pad' && <AnswerPad key="pad" q={q} onAnswer={onAnswer} />}
      {view === 'sent' && <Sent key="sent" q={q} choice={myAnswer!} late={late} />}
      {view === 'timeup' && <TimeUp key="timeup" />}
    </AnimatePresence>
  );
}

function LeadIn({ q, now }: { q: QuestionPublic; now: number }) {
  const secs = Math.ceil(Math.max(0, q.startsAt - now) / 1000);
  return (
    <motion.div exit={{ opacity: 0, scale: 0.96 }} className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
      <div className="flex flex-wrap justify-center gap-2 text-sm">
        <span className="rounded-full bg-white/15 px-3 py-1">{TYPE_LABEL[q.type]}</span>
        {q.multiplier > 1 && <span className="rounded-full bg-gold px-3 py-1 font-semibold text-ink">คะแนน ×{q.multiplier}</span>}
        {q.multiplier === 0 && <span className="rounded-full bg-white/15 px-3 py-1">ไม่คิดคะแนน</span>}
      </div>
      <motion.h2
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        className="font-display text-2xl leading-snug font-semibold"
      >
        {q.prompt}
      </motion.h2>
      <div className="grid h-24 place-items-center">
        <AnimatePresence mode="popLayout">
          {secs >= 1 && secs <= 3 ? (
            <motion.span
              key={secs}
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.3, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              className="grid size-20 place-items-center rounded-full bg-white font-display text-5xl font-extrabold text-ink"
            >
              {secs}
            </motion.span>
          ) : (
            <motion.span key="ready" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-lg text-white/70">
              เตรียมตัว…
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function AnswerPad({ q, onAnswer }: { q: QuestionPublic; onAnswer: (choice: number) => void }) {
  const pick = (i: number) => {
    vibrate(30);
    sfx.play('tap');
    onAnswer(i);
  };
  const two = q.options.length === 2;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="flex flex-1 flex-col gap-3">
      <div className="flex items-center gap-3">
        <TimerRing startsAt={q.startsAt} endsAt={q.endsAt} size={56} />
        <p className="line-clamp-3 flex-1 font-semibold leading-snug">{q.prompt}</p>
      </div>
      <div className={`grid flex-1 gap-3 ${two ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {q.options.map((text, i) => (
          <motion.button
            key={i}
            type="button"
            onClick={() => pick(i)}
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: i * 0.05, type: 'spring', stiffness: 500, damping: 25 }}
            whileTap={{ scale: 0.92 }}
            aria-label={`${ANSWER_NAMES[i]}: ${text}`}
            className={`flex min-h-28 flex-col items-center justify-center gap-2 rounded-3xl p-3 shadow-[inset_0_-8px_0_rgb(0_0_0/0.25)] ${ANSWER_BG[i]} ${q.options.length === 3 && i === 2 ? 'col-span-2' : ''}`}
          >
            <AnswerShape index={i} className="size-14 text-white drop-shadow" />
            <span className="line-clamp-3 text-center text-lg leading-snug font-semibold">{text}</span>
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}

function Sent({ q, choice, late }: { q: QuestionPublic; choice: number; late: boolean }) {
  const [line] = useState(() => WAITING_LINES[Math.floor(Math.random() * WAITING_LINES.length)]);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 flex-col items-center justify-center gap-5 text-center"
    >
      <motion.div
        initial={{ scale: 0.3, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className={`grid size-36 place-items-center rounded-[2rem] shadow-[inset_0_-8px_0_rgb(0_0_0/0.25)] ${late ? 'bg-slate-500' : ANSWER_BG[choice]}`}
      >
        <AnswerShape index={choice} className="size-20 text-white" />
      </motion.div>
      {late ? (
        <>
          <h2 className="text-3xl font-extrabold">ส่งไม่ทันเวลา 😅</h2>
          <p className="text-white/75">ข้อหน้ากดให้ไวขึ้นอีกนิดนะ</p>
        </>
      ) : (
        <>
          <h2 className="text-3xl font-extrabold">ส่งคำตอบแล้ว!</h2>
          <p className="max-w-xs truncate text-white/80">“{q.options[choice]}”</p>
          <p className="flex items-center gap-2 text-white/70">
            {line} <WaitingDots />
          </p>
        </>
      )}
    </motion.div>
  );
}

function TimeUp() {
  useEffect(() => vibrate(120), []);
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex flex-1 flex-col items-center justify-center gap-4 text-center"
    >
      <motion.span className="text-7xl" animate={{ rotate: [0, -12, 12, -6, 0] }} transition={{ duration: 0.8 }} aria-hidden>
        ⏰
      </motion.span>
      <h2 className="text-3xl font-extrabold">หมดเวลา!</h2>
      <p className="text-white/75">รอดูเฉลยบนจอใหญ่</p>
    </motion.div>
  );
}
