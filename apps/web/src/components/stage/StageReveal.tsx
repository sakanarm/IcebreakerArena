'use client';

import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { sliderBin, type QuestionPublic, type RevealInfo, type StageState } from '@icebreaker/shared';
import { fmt, fmtValue, percent, secondsLabel } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { ANSWER_BG, AnswerShape } from '../shapes';
import { AnswerGrid, PromptBar } from './parts';

export function StageReveal({ state }: { state: StageState }) {
  const q = state.question!;
  const r = state.reveal!;

  useEffect(() => {
    sfx.play('reveal');
  }, []);

  return (
    <div className="flex h-full flex-col gap-5">
      <PromptBar q={q} />
      {q.type === 'puzzle' && r.key?.texts ? (
        <PuzzleReveal q={q} r={r} order={r.key.texts} />
      ) : q.type === 'type' && r.key?.texts ? (
        <TypedReveal q={q} r={r} accepted={r.key.texts} />
      ) : q.type === 'slider' && q.slider && r.key?.answer !== undefined ? (
        <SliderReveal q={q} r={r} slider={q.slider} answer={r.key.answer} margin={r.key.margin ?? 0} />
      ) : (
        <TileReveal q={q} r={r} />
      )}
    </div>
  );
}

/** Quiz, true/false and poll: a bar per tile rising together, then the right tiles light up. */
function TileReveal({ q, r }: { q: QuestionPublic; r: RevealInfo }) {
  const poll = q.type === 'poll';
  const max = Math.max(1, ...r.counts);
  return (
    <>
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
    </>
  );
}

/** Counts up to `n`, one every `ms` after a first wait: the beat the items of a reveal arrive on. */
function useBeat(n: number, ms: number, wait: number) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (n <= 0) return;
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      i++;
      setCount(i);
      if (i < n) timer = setTimeout(next, ms);
    };
    timer = setTimeout(next, wait);
    return () => clearTimeout(timer);
  }, [n, ms, wait]);
  return count;
}

/**
 * The items wait on the right in the order players saw them, then fly one by one into their
 * numbered slot on the left. Each keeps the color and shape it had on the phones.
 */
function PuzzleReveal({ q, r, order }: { q: QuestionPublic; r: RevealInfo; order: string[] }) {
  const placed = useBeat(order.length, 550, 700);
  useEffect(() => {
    if (placed > 0) sfx.play(placed === order.length ? 'correct' : 'pop');
  }, [placed, order.length]);
  // the phone's color for each item: its position in the shuffled list players saw
  const shown = (text: string) => Math.max(0, q.options.indexOf(text));

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center gap-8">
      <ol className="flex flex-1 flex-col gap-3" aria-label={`ลำดับที่ถูก: ${order.join(', ')}`}>
        {order.map((text, pos) => (
          <li key={pos} className="flex min-h-20 items-center gap-4 rounded-2xl border-2 border-dashed border-white/25 p-2">
            <motion.span
              animate={pos < placed ? { scale: [1, 1.35, 1], backgroundColor: '#ffffff', color: '#16133f' } : {}}
              className="grid size-14 shrink-0 place-items-center rounded-full bg-white/15 font-display text-3xl font-extrabold"
            >
              {pos + 1}
            </motion.span>
            {pos < placed && <PuzzleTile q={q} text={text} index={shown(text)} placed />}
          </li>
        ))}
      </ol>
      <div className="flex w-[32%] flex-col gap-3">
        {q.options.map((text) => {
          const pos = order.indexOf(text);
          return pos >= placed ? <PuzzleTile key={text} q={q} text={text} index={shown(text)} /> : null;
        })}
        {placed === order.length && <RevealStats q={q} r={r} delay={0.4} />}
      </div>
    </div>
  );
}

function PuzzleTile({ q, text, index, placed = false }: { q: QuestionPublic; text: string; index: number; placed?: boolean }) {
  return (
    <motion.div
      layout
      layoutId={`reveal-${q.id}-${index}`}
      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className={`relative flex min-h-16 flex-1 items-center gap-4 overflow-hidden rounded-xl px-5 py-3 shadow-[inset_0_-6px_0_rgb(0_0_0/0.22)] ${ANSWER_BG[index]} ${placed ? 'ring-4 ring-white' : ''}`}
    >
      <AnswerShape index={index} className="size-10 shrink-0 text-white drop-shadow" />
      <span className="flex-1 text-2xl leading-snug font-semibold lg:text-3xl">{text}</span>
      {placed && <span className="shine animate-shine" />}
    </motion.div>
  );
}

/** The accepted answers pop in one by one, each with how many typed it. Wrong guesses never reach the big screen. */
function TypedReveal({ q, r, accepted }: { q: QuestionPublic; r: RevealInfo; accepted: string[] }) {
  const shownCount = useBeat(accepted.length, 380, 450);
  useEffect(() => {
    if (shownCount > 0) sfx.play('pop');
  }, [shownCount]);
  const [main, ...others] = accepted;

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-center gap-10">
      <div className="flex flex-1 flex-col items-center gap-6">
        <div className="text-xl text-white/70">{accepted.length > 1 ? 'คำตอบที่ยอมรับ' : 'คำตอบที่ถูก'}</div>
        {shownCount >= 1 && (
          <motion.div
            initial={{ scale: 0.2, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 13 }}
            className="card relative flex items-center gap-5 overflow-hidden px-10 py-6"
          >
            <span className="font-display text-6xl font-extrabold lg:text-7xl">{main}</span>
            <TypedCount n={r.counts[0] ?? 0} />
            <span className="shine animate-shine" />
          </motion.div>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          {others.map(
            (text, j) =>
              shownCount >= j + 2 && (
                <motion.div
                  key={j}
                  initial={{ scale: 0, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                  className="flex items-center gap-3 rounded-full bg-white/90 px-6 py-3 text-ink"
                >
                  <span className="font-display text-3xl font-semibold">{text}</span>
                  <TypedCount n={r.counts[j + 1] ?? 0} small />
                </motion.div>
              ),
          )}
        </div>
      </div>
      {shownCount >= accepted.length && <RevealStats q={q} r={r} delay={0.3} />}
    </div>
  );
}

function TypedCount({ n, small = false }: { n: number; small?: boolean }) {
  return (
    <span className={`rounded-full bg-good font-display font-bold text-white tabular-nums ${small ? 'px-3 py-0.5 text-lg' : 'px-4 py-1 text-2xl'}`}>
      {fmt(n)} คน
    </span>
  );
}

/**
 * The guesses as a histogram over the scale, then a needle sweeps in from the left and lands on
 * the answer; the stretch that still scores lights up green around it.
 */
function SliderReveal({
  q,
  r,
  slider,
  answer,
  margin,
}: {
  q: QuestionPublic;
  r: RevealInfo;
  slider: NonNullable<QuestionPublic['slider']>;
  answer: number;
  margin: number;
}) {
  const { min, max, step, unit } = slider;
  const steps = Math.round((max - min) / step);
  const cells = steps + 1;
  // every value on the scale has a cell of its own, so a short scale (1-5) puts each value under its own bar
  const at = (v: number) => Math.min(1, Math.max(0, ((v - min) / step + 0.5) / cells)) * 100;
  const bars = useMemo(() => {
    const lo: number[] = [];
    const hi: number[] = [];
    for (let k = 0; k <= steps; k++) {
      const b = sliderBin(slider, min + k * step);
      lo[b] ??= k;
      hi[b] = k;
    }
    return r.counts.map((count, b) => ({
      count,
      left: ((lo[b] ?? 0) / cells) * 100,
      width: (((hi[b] ?? 0) - (lo[b] ?? 0) + 1) / cells) * 100,
      // a bar scores when any value in it is within the margin
      scores: (lo[b] ?? 0) * step + min <= answer + margin && (hi[b] ?? 0) * step + min >= answer - margin,
    }));
  }, [r.counts, slider, min, step, steps, cells, answer, margin]);
  const top = Math.max(1, ...r.counts);
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      setLanded(true);
      sfx.play('correct');
    }, 2300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 items-stretch gap-8">
      <div className="flex min-w-0 flex-1 flex-col justify-end pb-2">
        <div
          className="relative mt-24 min-h-0 flex-1"
          role="img"
          aria-label={`เฉลย ${fmtValue(answer, unit)}${r.average != null ? ` ค่าเฉลี่ยที่ทาย ${fmtValue(r.average, unit)}` : ''}`}
        >
          {margin > 0 && (
            <motion.div
              className="absolute inset-y-0 rounded-xl bg-good/25 ring-2 ring-good/60"
              style={{ left: `${at(answer - margin)}%`, width: `${at(answer + margin) - at(answer - margin)}%` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: landed ? 1 : 0 }}
            />
          )}
          {bars.map((b, i) => {
            // the tallest bar stops short of the top, so its count stays clear of the answer's label above
            const pct = b.count ? Math.max(4, (b.count / top) * 82) : 0;
            return (
              <div key={i} className="absolute inset-y-0 px-1" style={{ left: `${b.left}%`, width: `${b.width}%` }}>
                <motion.div
                  className={`absolute inset-x-1 bottom-0 origin-bottom rounded-t-lg transition-colors duration-500 ${landed && b.scores ? 'bg-good' : 'bg-white/45'}`}
                  style={{ height: `${pct}%` }}
                  initial={{ scaleY: 0 }}
                  animate={{ scaleY: 1 }}
                  transition={{ delay: 0.15 + i * 0.06, type: 'spring', stiffness: 150, damping: 19 }}
                />
                {b.count > 0 && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 + i * 0.06 }}
                    className="absolute inset-x-0 z-20 mb-1 text-center font-display text-2xl font-bold tabular-nums [text-shadow:0_2px_6px_rgb(0_0_0/0.6)]"
                    style={{ bottom: `${pct}%` }}
                  >
                    {fmt(b.count)}
                  </motion.span>
                )}
              </div>
            );
          })}
          {/* the needle: starts at the far left and swings over to the answer */}
          <motion.div
            className="absolute inset-y-0 z-10 w-0"
            initial={{ left: '0%', opacity: 0 }}
            animate={{ left: `${at(answer)}%`, opacity: 1 }}
            transition={{ left: { delay: 1, type: 'spring', stiffness: 45, damping: 9 }, opacity: { delay: 0.9, duration: 0.2 } }}
          >
            <div className="absolute inset-y-0 -left-1 w-2 rounded-full bg-gold shadow-[0_0_24px_rgb(255_200_61/0.9)]" />
            <motion.div
              className="absolute bottom-full left-0 mb-2 rounded-2xl bg-gold px-5 py-2 font-display text-4xl font-extrabold whitespace-nowrap text-ink shadow-2xl"
              style={{ translate: edgeSafe(at(answer)) }}
              animate={landed ? { scale: [1, 1.25, 1] } : {}}
              transition={{ duration: 0.45 }}
            >
              {fmtValue(answer, unit)}
            </motion.div>
          </motion.div>
        </div>
        {/* the scale */}
        <div className="relative mt-1 h-3 rounded-full bg-white/25" />
        <div className="relative mt-2 h-14 text-xl text-white/70 tabular-nums">
          <span className="absolute left-0">{fmtValue(min, unit)}</span>
          <span className="absolute right-0">{fmtValue(max, unit)}</span>
          {r.average != null && (
            <motion.span
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: landed ? 1 : 0, y: landed ? 0 : -8 }}
              className="absolute top-6 rounded-full bg-white/15 px-3 py-0.5 text-lg whitespace-nowrap text-white"
              style={{ left: `${at(r.average)}%`, translate: edgeSafe(at(r.average)) }}
            >
              ▲ เฉลี่ย {fmtValue(Math.round(r.average * 10) / 10)}
            </motion.span>
          )}
        </div>
      </div>
      {landed && <RevealStats q={q} r={r} delay={0.2} margin={margin} />}
    </div>
  );
}

/** a label hung on a point of the scale: centered on it, but pulled inward near the ends so it stays on screen */
const edgeSafe = (pct: number) => `-${Math.min(90, Math.max(10, pct))}% 0`;

function RevealStats({ q, r, delay = 0.8, margin = 0 }: { q: QuestionPublic; r: RevealInfo; delay?: number; margin?: number }) {
  const silent = r.totalPlayers - r.answered;
  const label = q.type === 'slider' ? (margin > 0 ? `ได้คะแนน (ห่างไม่เกิน ±${fmtValue(margin)})` : 'ตอบตรงเป๊ะ') : q.type === 'puzzle' ? 'เรียงถูก' : 'ตอบถูก';
  return (
    <motion.div
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 24 }}
      className="glass mb-2 flex min-w-64 flex-col gap-3 self-end px-6 py-5"
    >
      {q.type === 'poll' ? (
        <>
          <div className="text-white/70">ผลโหวต</div>
          <div className="font-display text-5xl font-extrabold">🗳️ {fmt(r.answered)}</div>
          <div className="text-lg text-white/80">เสียง</div>
        </>
      ) : (
        <>
          <div className="text-white/70">{label}</div>
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
              transition={{ delay: delay + 0.3, duration: 0.8, ease: 'easeOut' }}
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
