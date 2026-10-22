'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { LIMITS, sliderStart, type AnswerSent, type QuestionPublic } from '@icebreaker/shared';
import { serverNow, useServerNow } from '@/lib/clock';
import { fmtValue, TYPE_LABEL } from '@/lib/format';
import { sfx, vibrate } from '@/lib/sfx';
import { waitingLines, waitMood } from '@/lib/waiting-lines';
import { TimerRing, WaitingDots } from '../motion-bits';
import { ANSWER_BG, ANSWER_NAMES, AnswerShape } from '../shapes';

/** a right answer gets full points however late it comes, so the timer is only the deadline */
export const untimed = (q: QuestionPublic) => !q.timed && q.type !== 'poll' && q.multiplier > 0;

/** the middle of what was tapped, and half its size, on the screen */
type Origin = { x: number; y: number; r: number };
const originOf = (el: Element | null | undefined): Origin | null => {
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, r: Math.max(b.width, b.height) / 2 };
};

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
  /** false when the answer was dropped: this phone already sent one */
  onAnswer: (sent: AnswerSent) => boolean;
}) {
  const now = useServerNow(true, 100);
  const view = myAnswer !== null ? 'sent' : now < q.startsAt ? 'lead' : now > q.endsAt ? 'timeup' : 'pad';
  // when and where this phone sent its answer: the color pours out from there, and the wait says how it went
  const [mine, setMine] = useState<{ at: number; from: Origin | null } | null>(null);
  const answer = (sent: AnswerSent, from: Origin | null) => {
    const at = serverNow();
    if (!onAnswer(sent)) return false;
    setMine({ at, from });
    return true;
  };

  // the last five seconds: the music hurries along, as on the big screen
  const hurry = q.endsAt - now <= 5000;
  useEffect(() => {
    if (!hurry) return;
    sfx.hurry(true);
    return () => sfx.hurry(false);
  }, [hurry]);

  return (
    <div className="relative isolate flex flex-1 flex-col">
      <AnimatePresence mode="wait">
        {view === 'lead' && <LeadIn key="lead" q={q} now={now} />}
        {view === 'pad' && <Pad key={`pad-${q.id}`} q={q} onAnswer={answer} />}
        {view === 'sent' && <Sent key="sent" q={q} sent={myAnswer!} late={late} at={mine?.at ?? null} />}
        {view === 'timeup' && <TimeUp key="timeup" />}
      </AnimatePresence>
      {/* after the pad in the page, so it covers the pad as it goes; the "sent" screen sits above it */}
      {view === 'sent' && <Flood from={mine?.from ?? null} bg={late ? 'bg-slate-500' : sentLook(q, myAnswer!).bg} />}
    </div>
  );
}

/** The color of what was sent pours out over the screen from where it was tapped (the middle after a reload). */
function Flood({ from, bg }: { from: Origin | null; bg: string }) {
  // a circle 3 screens across covers the screen from any point on it; it starts the size of what was tapped
  const [start] = useState(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const at = from ?? { x: w / 2, y: h / 2, r: 0 };
    return { x: at.x, y: at.y, scale: Math.min(1, (2 * at.r) / (3 * Math.max(w, h))) };
  });
  return (
    <motion.div
      aria-hidden
      data-flood
      className={`pointer-events-none fixed size-[300vmax] -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-300 ${bg}`}
      style={{ left: start.x, top: start.y }}
      initial={{ scale: start.scale }}
      animate={{ scale: 1 }}
      transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
    />
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

function Pad({ q, onAnswer }: { q: QuestionPublic; onAnswer: (sent: AnswerSent, from: Origin | null) => boolean }) {
  const send = (sent: AnswerSent, from: Origin | null) => {
    if (!onAnswer(sent, from)) return false;
    vibrate(30);
    sfx.play('tap');
    return true;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.2 } }}
      className="flex flex-1 flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <TimerRing startsAt={q.startsAt} endsAt={q.endsAt} size={56} />
        <div className="flex-1">
          <p className="line-clamp-3 font-semibold leading-snug">{q.prompt}</p>
          {untimed(q) && <span className="mt-1 inline-block rounded-full bg-white/15 px-2.5 py-0.5 text-xs">⏱️ ไม่นับความเร็ว</span>}
        </div>
      </div>
      {q.type === 'puzzle' ? (
        <PuzzlePad q={q} onSend={(order, from) => send({ order }, from)} />
      ) : q.type === 'type' ? (
        <TypePad onSend={(text, from) => send({ text }, from)} />
      ) : q.type === 'slider' && q.slider ? (
        <SliderPad slider={q.slider} onSend={(value, from) => send({ value }, from)} />
      ) : (
        <TilePad q={q} onPick={(choice, from) => send({ choice }, from)} />
      )}
    </motion.div>
  );
}

function TilePad({ q, onPick }: { q: QuestionPublic; onPick: (choice: number, from: Origin | null) => boolean }) {
  const two = q.options.length === 2;
  // the tapped tile swells while the others drop away under its color; one tap only, even while they go
  const [picked, setPicked] = useState<number | null>(null);
  return (
    <div className={`grid flex-1 gap-3 ${two ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {q.options.map((text, i) => (
        <motion.button
          key={i}
          type="button"
          onClick={(e) => {
            if (picked === null && onPick(i, originOf(e.currentTarget))) setPicked(i);
          }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={picked === null ? { scale: 1, opacity: 1 } : picked === i ? { scale: 1.06, opacity: 1 } : { scale: 0.7, opacity: 0 }}
          transition={picked === null ? { delay: i * 0.05, type: 'spring', stiffness: 500, damping: 25 } : { type: 'spring', stiffness: 520, damping: 30 }}
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
function PuzzlePad({ q, onSend }: { q: QuestionPublic; onSend: (order: number[], from: Origin | null) => void }) {
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
            onClick={(e) => onSend(order, originOf(e.currentTarget))}
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

function TypePad({ onSend }: { onSend: (text: string, from: Origin | null) => void }) {
  const [text, setText] = useState('');
  const ready = text.trim().length > 0;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // sent with Enter on the keyboard, the color still pours from the send button
    if (ready) onSend(text.trim(), originOf(e.currentTarget.querySelector('button[type=submit]')));
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

function SliderPad({ slider, onSend }: { slider: NonNullable<QuestionPublic['slider']>; onSend: (value: number, from: Origin | null) => void }) {
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
      <button type="button" onClick={(e) => onSend(value, originOf(e.currentTarget))} disabled={!moved} className="btn btn-gold min-h-16 text-xl">
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

/** `at`: when it was sent, on the server's clock; null when this phone did not see it go (it reloaded after answering) */
function Sent({ q, sent, late, at }: { q: QuestionPublic; sent: AnswerSent; late: boolean; at: number | null }) {
  const reduce = useReducedMotion();
  const [lines] = useState(() => waitingLines(waitMood(q, at)));
  // the line changes every few seconds until the reveal
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (late) return;
    const id = setInterval(() => setTurn((n) => n + 1), 3200);
    return () => clearInterval(id);
  }, [late]);
  const look = sentLook(q, sent);
  // how long it took, where the speed counts for points (the server's own count can differ by the trip there)
  const took = at !== null && q.timed && q.multiplier > 0 && q.type !== 'poll' ? Math.max(0, at - q.startsAt) / 1000 : null;
  const waiting = !late && !reduce;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative z-10 flex flex-1 flex-col items-center justify-center gap-5 text-center"
    >
      <motion.div
        initial={{ scale: 0.3, rotate: -90 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="relative grid size-36 place-items-center"
      >
        {/* rings go out from it while it waits, like a call going out */}
        {waiting &&
          [0, 1].map((i) => (
            <motion.span
              key={i}
              aria-hidden
              data-ring
              className="absolute inset-0 rounded-full border-4 border-white/70"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: [0.9, 1.9], opacity: [0.7, 0] }}
              transition={{ duration: 2.2, delay: 0.5 + i * 1.1, repeat: Infinity, ease: 'easeOut' }}
            />
          ))}
        <motion.div
          animate={waiting ? { y: [0, -8, 0] } : { y: 0 }}
          transition={waiting ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
          className="grid size-36 place-items-center rounded-full bg-black/15"
        >
          {look.icon}
        </motion.div>
      </motion.div>
      {late ? (
        <>
          <h2 className="text-3xl font-extrabold drop-shadow">ส่งไม่ทันเวลา 😅</h2>
          <p className="text-white/80">ข้อหน้ากดให้ไวขึ้นอีกนิดนะ</p>
        </>
      ) : (
        <>
          <h2 className="text-3xl font-extrabold drop-shadow">ส่งคำตอบแล้ว!</h2>
          {look.text !== null && <p className="max-w-xs truncate rounded-full bg-black/20 px-4 py-1.5 font-semibold">“{look.text}”</p>}
          {sent.order && (
            <ol className="flex max-w-xs flex-col gap-1 rounded-2xl bg-black/20 px-4 py-2 text-left text-sm">
              {sent.order.map((d, pos) => (
                <li key={d} className="truncate">
                  {pos + 1}. {q.options[d]}
                </li>
              ))}
            </ol>
          )}
          {took !== null && (
            <motion.span
              data-took
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.35, type: 'spring', stiffness: 420, damping: 18 }}
              className="rounded-full bg-white px-3 py-1 text-sm font-bold text-ink tabular-nums"
            >
              ⚡ ตอบใน {took.toFixed(1)} วินาที
            </motion.span>
          )}
          <div className="grid h-7 place-items-center overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={turn}
                data-line
                initial={{ y: 14, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -14, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-2 whitespace-nowrap text-white/90"
              >
                {lines[turn % lines.length]} <WaitingDots />
              </motion.p>
            </AnimatePresence>
          </div>
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
