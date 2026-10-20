'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { LIMITS, sliderStart, type AnswerSent, type QuestionPublic } from '@icebreaker/shared';
import { useServerNow } from '@/lib/clock';
import { fmtValue, TYPE_LABEL } from '@/lib/format';
import { sfx, vibrate } from '@/lib/sfx';
import { TimerRing, WaitingDots } from '../motion-bits';
import { ANSWER_BG, ANSWER_NAMES, AnswerShape } from '../shapes';

const WAITING_LINES = ['ใจเย็นๆ รอเฉลยแป๊บ', 'มั่นใจแค่ไหนเนี่ย?', 'ตอบไวแบบนี้ มีลุ้น!', 'ดูเฉลยบนจอใหญ่ได้เลย', 'ลุ้นๆๆ'];

/** a right answer gets full points however late it comes, so the timer is only the deadline */
export const untimed = (q: QuestionPublic) => !q.timed && q.type !== 'poll' && q.multiplier > 0;

/** One question on the phone: read it, 3-2-1, answer, wait for the reveal. */
export function PlayerQuestion({
  q,
  myAnswer,
  late,
  onAnswer,
}: {
  q: QuestionPublic;
  myAnswer: AnswerSent | null;
  late: boolean;
  onAnswer: (sent: AnswerSent) => void;
}) {
  const now = useServerNow(true, 100);
  const view = myAnswer !== null ? 'sent' : now < q.startsAt ? 'lead' : now > q.endsAt ? 'timeup' : 'pad';

  return (
    <AnimatePresence mode="wait">
      {view === 'lead' && <LeadIn key="lead" q={q} now={now} />}
      {view === 'pad' && <Pad key={`pad-${q.id}`} q={q} onAnswer={onAnswer} />}
      {view === 'sent' && <Sent key="sent" q={q} sent={myAnswer!} late={late} />}
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
        {untimed(q) && <span className="rounded-full bg-white/15 px-3 py-1">⏱️ ไม่นับความเร็ว</span>}
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

function Pad({ q, onAnswer }: { q: QuestionPublic; onAnswer: (sent: AnswerSent) => void }) {
  const send = (sent: AnswerSent) => {
    vibrate(30);
    sfx.play('tap');
    onAnswer(sent);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97 }} className="flex flex-1 flex-col gap-3">
      <div className="flex items-center gap-3">
        <TimerRing startsAt={q.startsAt} endsAt={q.endsAt} size={56} />
        <div className="flex-1">
          <p className="line-clamp-3 font-semibold leading-snug">{q.prompt}</p>
          {untimed(q) && <span className="mt-1 inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-xs">⏱️ ไม่นับความเร็ว</span>}
        </div>
      </div>
      {q.type === 'puzzle' ? (
        <PuzzlePad q={q} onSend={(order) => send({ order })} />
      ) : q.type === 'type' ? (
        <TypePad onSend={(text) => send({ text })} />
      ) : q.type === 'slider' && q.slider ? (
        <SliderPad slider={q.slider} onSend={(value) => send({ value })} />
      ) : (
        <TilePad q={q} onPick={(choice) => send({ choice })} />
      )}
    </motion.div>
  );
}

function TilePad({ q, onPick }: { q: QuestionPublic; onPick: (choice: number) => void }) {
  const two = q.options.length === 2;
  return (
    <div className={`grid flex-1 gap-3 ${two ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {q.options.map((text, i) => (
        <motion.button
          key={i}
          type="button"
          onClick={() => onPick(i)}
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
  );
}

/** Tap the items in order: each one flies up into the next numbered slot; tap a placed one to take it back. */
function PuzzlePad({ q, onSend }: { q: QuestionPublic; onSend: (order: number[]) => void }) {
  const [order, setOrder] = useState<number[]>([]);
  const n = q.options.length;
  const left = q.options.map((_, i) => i).filter((i) => !order.includes(i));
  const place = (d: number) => {
    vibrate(15);
    setOrder((o) => (o.includes(d) || o.length >= n ? o : [...o, d]));
  };
  const unplace = (d: number) => setOrder((o) => o.filter((x) => x !== d));

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="text-center text-sm text-white/75">แตะเรียงจากอันดับแรกไปอันดับสุดท้าย (แตะอีกครั้งเพื่อเอาออก)</p>
      <ol className="flex flex-col gap-2">
        {Array.from({ length: n }, (_, pos) => {
          const d = order[pos];
          return (
            <li key={pos} className="flex min-h-15 items-center gap-2 rounded-2xl border-2 border-dashed border-white/25 p-1.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15 font-display font-bold">{pos + 1}</span>
              {d !== undefined && <PuzzleItem q={q} d={d} onTap={() => unplace(d)} placed />}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-1 flex-col justify-end gap-2">
        {left.map((d) => (
          <PuzzleItem key={d} q={q} d={d} onTap={() => place(d)} />
        ))}
        {order.length === n && (
          <motion.button
            type="button"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={() => onSend(order)}
            className="btn btn-gold min-h-16 text-xl"
          >
            ✅ ส่งลำดับนี้
          </motion.button>
        )}
      </div>
    </div>
  );
}

/** `placed`: in a numbered slot, where it fills the row; waiting below, every item keeps one size however many are left */
function PuzzleItem({ q, d, onTap, placed = false }: { q: QuestionPublic; d: number; onTap: () => void; placed?: boolean }) {
  return (
    <motion.button
      type="button"
      layoutId={`puzzle-${q.id}-${d}`}
      transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      onClick={onTap}
      whileTap={{ scale: 0.95 }}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left font-semibold shadow-[inset_0_-5px_0_rgb(0_0_0/0.25)] ${placed ? 'min-h-12 flex-1' : 'min-h-16 shrink-0'} ${ANSWER_BG[d]}`}
    >
      <AnswerShape index={d} className="size-6 shrink-0 text-white" />
      <span className="line-clamp-2 leading-snug">{q.options[d]}</span>
    </motion.button>
  );
}

function TypePad({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const ready = text.trim().length > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (ready) onSend(text.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-1 flex-col justify-center gap-4">
      <label htmlFor="typed" className="text-center text-white/80">
        ⌨️ พิมพ์คำตอบของคุณ
      </label>
      <input
        id="typed"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={LIMITS.typedMax}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="send"
        placeholder="คำตอบ…"
        className="field text-center font-display text-2xl font-semibold"
      />
      <p className="text-center text-xs text-white/60">ตัวพิมพ์เล็ก/ใหญ่ เว้นวรรค และเครื่องหมายไม่มีผล</p>
      <button type="submit" disabled={!ready} className="btn btn-gold min-h-16 text-xl">
        ✅ ส่งคำตอบ
      </button>
    </form>
  );
}

function SliderPad({ slider, onSend }: { slider: NonNullable<QuestionPublic['slider']>; onSend: (value: number) => void }) {
  const { min, max, step, unit } = slider;
  const steps = Math.round((max - min) / step);
  const [value, setValue] = useState(() => sliderStart(slider));
  // the knob starts in the middle: sending it untouched would be a free guess there
  const [moved, setMoved] = useState(false);
  const nudge = (by: number) => {
    vibrate(10);
    setMoved(true);
    setValue((v) => Math.min(max, Math.max(min, v + by * step)));
  };
  const fill = `${((value - min) / (max - min)) * 100}%`;
  const long = steps >= 50; // a long scale also gets ±10 steps

  return (
    <div className="flex flex-1 flex-col justify-center gap-5">
      <motion.div
        key={value}
        initial={{ scale: 1.12 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 600, damping: 20 }}
        className="text-center font-display text-6xl font-extrabold tabular-nums"
      >
        {fmtValue(value)}
        {unit && <span className="ml-2 text-2xl font-semibold text-white/75">{unit}</span>}
      </motion.div>
      <input
        type="range"
        aria-label="เลือกตัวเลข"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          setMoved(true);
          setValue(Number(e.target.value));
        }}
        className="range-big"
        style={{ '--fill': fill } as CSSProperties}
      />
      <div className="flex justify-between text-sm text-white/65 tabular-nums">
        <span>{fmtValue(min, unit)}</span>
        <span>{fmtValue(max, unit)}</span>
      </div>
      <div className="flex justify-center gap-2">
        {long && <Nudge label={`−${fmtValue(10 * step)}`} onTap={() => nudge(-10)} />}
        <Nudge label={`−${fmtValue(step)}`} onTap={() => nudge(-1)} />
        <Nudge label={`+${fmtValue(step)}`} onTap={() => nudge(1)} />
        {long && <Nudge label={`+${fmtValue(10 * step)}`} onTap={() => nudge(10)} />}
      </div>
      <button type="button" onClick={() => onSend(value)} disabled={!moved} className="btn btn-gold min-h-16 text-xl">
        {moved ? `✅ ส่ง ${fmtValue(value, unit)}` : '👆 เลื่อนเลือกก่อนส่ง'}
      </button>
    </div>
  );
}

function Nudge({ label, onTap }: { label: string; onTap: () => void }) {
  return (
    <button type="button" onClick={onTap} className="btn btn-ghost min-w-16 px-3 py-2 text-base tabular-nums">
      {label}
    </button>
  );
}

/** the big icon and the words of what was sent, whatever the question type */
function sentLook(q: QuestionPublic, sent: AnswerSent): { bg: string; icon: ReactNode; text: string | null } {
  const emoji = (e: string) => <span className="text-7xl">{e}</span>;
  if (sent.order) return { bg: 'bg-brand', icon: emoji('🧩'), text: null };
  if (sent.text !== undefined) return { bg: 'bg-brand', icon: emoji('⌨️'), text: sent.text };
  if (sent.value !== undefined) return { bg: 'bg-brand', icon: emoji('🎚️'), text: fmtValue(sent.value, q.slider?.unit) };
  const choice = sent.choice ?? 0;
  return { bg: ANSWER_BG[choice] ?? 'bg-brand', icon: <AnswerShape index={choice} className="size-20 text-white" />, text: q.options[choice] ?? null };
}

function Sent({ q, sent, late }: { q: QuestionPublic; sent: AnswerSent; late: boolean }) {
  const [line] = useState(() => WAITING_LINES[Math.floor(Math.random() * WAITING_LINES.length)]);
  const look = sentLook(q, sent);
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
        className={`grid size-36 place-items-center rounded-[2rem] shadow-[inset_0_-8px_0_rgb(0_0_0/0.25)] ${late ? 'bg-slate-500' : look.bg}`}
      >
        {look.icon}
      </motion.div>
      {late ? (
        <>
          <h2 className="text-3xl font-extrabold">ส่งไม่ทันเวลา 😅</h2>
          <p className="text-white/75">ข้อหน้ากดให้ไวขึ้นอีกนิดนะ</p>
        </>
      ) : (
        <>
          <h2 className="text-3xl font-extrabold">ส่งคำตอบแล้ว!</h2>
          {look.text !== null && <p className="max-w-xs truncate text-white/80">“{look.text}”</p>}
          {sent.order && (
            <ol className="flex max-w-xs flex-col gap-1 text-left text-sm text-white/80">
              {sent.order.map((d, pos) => (
                <li key={d} className="truncate">
                  {pos + 1}. {q.options[d]}
                </li>
              ))}
            </ol>
          )}
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
