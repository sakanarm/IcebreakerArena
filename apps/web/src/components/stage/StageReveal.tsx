'use client';

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { sliderBin, type QuestionPublic, type RevealInfo, type StageState } from '@icebreaker/shared';
import { fmt, fmtValue, percent, secondsLabel } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { ANSWER_BG, AnswerShape } from '../shapes';
import { AnswerGrid, PromptBar, VERDICT_S } from './parts';

export function StageReveal({ state }: { state: StageState }) {
  const q = state.question!;
  const r = state.reveal!;

  useEffect(() => {
    sfx.play('reveal');
  }, []);

  return (
    <div className="flex h-full flex-col gap-3 sm:gap-5 low:gap-3 short:gap-2">
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
  const graded = r.correct.length > 0;
  // a bell as the right answer gets its ✓ (a poll has none to ring for)
  useEffect(() => {
    if (!graded) return;
    const t = setTimeout(() => sfx.play('ding'), VERDICT_S * 1000);
    return () => clearTimeout(t);
  }, [graded]);
  return (
    <>
      {/* never lower than the stats card beside the bars, or the card would climb over the question */}
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-end justify-center gap-3 sm:gap-10">
        {/* bars are a share of whatever height the screen leaves, so a 1080p projector isn't half empty, with a
            least height of their own: what doesn't fit under them scrolls */}
        <div
          className="flex h-full max-h-[34rem] min-h-36 items-end gap-2 sm:gap-5 low:min-h-28 short:min-h-24"
          role="img"
          aria-label={`ผลการตอบ: ${r.counts.map((c, i) => `${q.options[i]} ${c} คน`).join(', ')}`}
        >
          {q.options.map((_, i) => {
            const correct = r.correct.includes(i);
            const faded = !poll && !correct;
            const pct = Math.max(3, ((r.counts[i] ?? 0) / max) * 100);
            return (
              <div key={i} className="flex h-full w-10 flex-col sm:w-24 lg:w-28 short:w-16">
                {/* the top margin leaves room for the count above the tallest bar */}
                <div className="relative mt-9 min-h-0 flex-1 sm:mt-14 short:mt-8">
                  <motion.div
                    className={`absolute inset-x-0 bottom-0 origin-bottom rounded-t-xl ${ANSWER_BG[i]}`}
                    style={{ height: `${pct}%` }}
                    initial={{ scaleY: 0 }}
                    // the wrong answers' bars get thinner as they fade, so the right one stands out against them
                    animate={{ scaleY: 1, scaleX: faded ? 0.8 : 1, opacity: faded ? 0.35 : 1 }}
                    transition={{
                      scaleY: { delay: 0.15 + i * 0.1, type: 'spring', stiffness: 150, damping: 19 },
                      scaleX: { delay: VERDICT_S, type: 'spring', stiffness: 260, damping: 24 },
                      opacity: { delay: VERDICT_S },
                    }}
                  />
                  <motion.span
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.55 + i * 0.1 }}
                    className="absolute inset-x-0 mb-1 text-center font-display text-2xl font-extrabold tabular-nums sm:mb-2 sm:text-4xl short:text-2xl"
                    style={{ bottom: `${pct}%` }}
                  >
                    {fmt(r.counts[i] ?? 0)}
                  </motion.span>
                </div>
                <div className={`flex w-full items-center justify-center gap-1 rounded-b-xl py-1.5 sm:gap-1.5 sm:py-2 ${ANSWER_BG[i]} ${faded ? 'opacity-60' : ''}`}>
                  <AnswerShape index={i} className="size-5 text-white sm:size-7" />
                  {correct && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: VERDICT_S + 0.05, type: 'spring', stiffness: 500, damping: 12 }}
                      className="text-base font-extrabold sm:text-2xl"
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
    // on a phone the items wait under the slots instead, where there is the width for their words
    <div className="mx-auto flex w-full max-w-6xl flex-1 items-center-safe gap-3 max-sm:flex-col max-sm:items-stretch max-sm:justify-center-safe sm:gap-8">
      <ol className="flex flex-col gap-2 sm:flex-1 sm:gap-3 low:gap-2 short:gap-1" aria-label={`ลำดับที่ถูก: ${order.join(', ')}`}>
        {order.map((text, pos) => (
          <li
            key={pos}
            className="flex min-h-14 items-center gap-2 rounded-2xl border-2 border-dashed border-white/25 p-1.5 sm:min-h-20 sm:gap-4 sm:p-2 low:min-h-16 low:p-1.5 short:min-h-10 short:gap-2 short:p-0.5"
          >
            <motion.span
              animate={pos < placed ? { scale: [1, 1.35, 1], backgroundColor: '#ffffff', color: '#16133f' } : {}}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-white/15 font-display text-xl font-extrabold sm:size-14 sm:text-3xl low:size-12 low:text-2xl short:size-8 short:text-lg"
            >
              {pos + 1}
            </motion.span>
            {pos < placed && <PuzzleTile q={q} text={text} index={shown(text)} placed />}
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:w-[32%] sm:gap-3 low:gap-2 short:gap-1">
        {/* on a phone two to a row, as they stood while everyone answered: then the items still waiting take about
            the height of the stats that come after them, and the slots above stay where they are */}
        {placed < order.length && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-col sm:gap-3 low:gap-2 short:gap-1">
            {q.options.map((text) => {
              const pos = order.indexOf(text);
              return pos >= placed ? <PuzzleTile key={text} q={q} text={text} index={shown(text)} /> : null;
            })}
          </div>
        )}
        {placed === order.length && <RevealStats q={q} r={r} delay={0.4} under />}
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
      className={`relative flex min-h-11 min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-xl px-3 py-1.5 shadow-[inset_0_-6px_0_rgb(0_0_0/0.22)] sm:min-h-16 sm:gap-4 sm:px-5 sm:py-3 low:min-h-14 low:py-2.5 short:min-h-8 short:gap-2 short:py-0.5 ${ANSWER_BG[index]} ${placed ? 'ring-4 ring-white' : ''}`}
    >
      {/* a tile grows on its way into a slot: its insides move with it rather than being stretched */}
      <motion.span layout className="flex shrink-0">
        <AnswerShape index={index} className="size-6 text-white drop-shadow sm:size-10 short:size-6" />
      </motion.span>
      <motion.span layout className="min-w-0 flex-1 text-base leading-snug font-semibold break-words sm:text-2xl lg:text-3xl low:text-2xl short:text-base">
        {text}
      </motion.span>
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
    <div className="mx-auto flex w-full max-w-6xl flex-1 items-center-safe gap-4 max-sm:flex-col max-sm:justify-center-safe sm:gap-10">
      <div className="flex w-full min-w-0 flex-1 flex-col items-center gap-3 max-sm:flex-none sm:gap-6 low:gap-4 short:gap-2">
        <div className="text-base text-white/70 sm:text-xl">{accepted.length > 1 ? 'คำตอบที่ยอมรับ' : 'คำตอบที่ถูก'}</div>
        {shownCount >= 1 && (
          <motion.div
            initial={{ scale: 0.2, rotate: -8, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 13 }}
            className="card relative flex max-w-full flex-wrap items-center justify-center gap-3 overflow-hidden px-5 py-3 sm:gap-5 sm:px-10 sm:py-6 low:py-4 short:py-3"
          >
            <span className="min-w-0 font-display text-3xl font-extrabold break-words sm:text-6xl lg:text-7xl low:text-5xl short:text-4xl">{main}</span>
            <TypedCount n={r.counts[0] ?? 0} />
            <span className="shine animate-shine" />
          </motion.div>
        )}
        <div className="flex max-w-full flex-wrap justify-center gap-2 sm:gap-3">
          {others.map(
            (text, j) =>
              shownCount >= j + 2 && (
                <motion.div
                  key={j}
                  initial={{ scale: 0, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                  className="flex max-w-full items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-ink sm:gap-3 sm:px-6 sm:py-3 low:py-2 short:py-1.5"
                >
                  <span className="min-w-0 font-display text-xl font-semibold break-words sm:text-3xl low:text-2xl short:text-xl">{text}</span>
                  <TypedCount n={r.counts[j + 1] ?? 0} small />
                </motion.div>
              ),
          )}
        </div>
      </div>
      {shownCount >= accepted.length && <RevealStats q={q} r={r} delay={0.3} under />}
    </div>
  );
}

function TypedCount({ n, small = false }: { n: number; small?: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full bg-good font-display font-bold whitespace-nowrap text-white tabular-nums ${small ? 'px-2.5 py-0.5 text-sm sm:px-3 sm:text-lg' : 'px-3 py-0.5 text-lg sm:px-4 sm:py-1 sm:text-2xl'}`}
    >
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
  // the bar the needle comes to rest in: its count goes on the needle like a bead, rather than under it
  const hit = bars.findIndex((b) => at(answer) >= b.left && at(answer) <= b.left + b.width);
  useEffect(() => {
    const t = setTimeout(() => {
      setLanded(true);
      sfx.play('correct');
    }, 2300);
    return () => clearTimeout(t);
  }, []);

  const average = r.average != null ? Math.round(r.average * 10) / 10 : null;

  // the needle and the answer's label ride on the one value, so the label is over the needle all the way across
  const reduce = useReducedMotion();
  const target = at(answer);
  const swing = useMotionValue(reduce ? target : 0);
  useEffect(() => {
    if (reduce) return;
    const run = animate(swing, target, NEEDLE);
    return () => run.stop();
  }, [reduce, swing, target]);
  const left = useTransform(swing, (p) => `${p}%`);
  // back by as much of its own width as it went along the line: it covers its point and never pokes out past
  // either end of the line, however long it is
  const back = useTransform(swing, (p) => `${-p}%`);

  return (
    // on a phone the scale takes the whole width, and the numbers come in under it
    <div className="mx-auto flex w-full max-w-6xl flex-1 gap-3 max-sm:flex-col sm:gap-8">
      <div className="flex min-w-0 flex-1 flex-col justify-end pb-2">
        {/* the answer rides over on the needle, above the chart, where no count can be under it */}
        <div className="relative z-10 mb-2 flex">
          <motion.div className="relative w-fit max-w-full" style={{ left, x: back }} {...APPEAR}>
            <motion.div
              className="rounded-2xl bg-gold px-3 py-1 text-center font-display text-2xl leading-tight font-extrabold text-ink shadow-2xl sm:px-5 sm:py-2 sm:text-4xl short:py-0.5 short:text-xl"
              animate={landed ? { scale: [1, 1.15, 1] } : {}}
              transition={{ duration: 0.45 }}
            >
              <Value n={answer} unit={unit} />
            </motion.div>
          </motion.div>
        </div>
        <div
          className="relative min-h-28 flex-1 short:min-h-12"
          role="img"
          aria-label={`เฉลย ${fmtValue(answer, unit)}${average != null ? ` ค่าเฉลี่ยที่ทาย ${fmtValue(average, unit)}` : ''}`}
        >
          {margin > 0 && (
            <motion.div
              className="absolute inset-y-0 rounded-xl bg-good/25 ring-2 ring-good/60"
              style={{ left: `${at(answer - margin)}%`, width: `${at(answer + margin) - at(answer - margin)}%` }}
              initial={{ opacity: 0 }}
              animate={{ opacity: landed ? 1 : 0 }}
            />
          )}
          {/* the bars stop short of the top by a line, for the tallest one's count */}
          <div className="absolute inset-x-0 top-7 bottom-0 sm:top-10">
            {bars.map((b, i) => {
              const pct = b.count ? Math.max(4, (b.count / top) * 100) : 0;
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
                      className="absolute inset-x-0 z-20 mb-1 flex justify-center font-display text-base font-bold tabular-nums [text-shadow:0_2px_6px_rgb(0_0_0/0.6)] sm:text-2xl short:text-base"
                      style={{ bottom: `${pct}%` }}
                    >
                      <span className={`rounded-full px-1.5 ring-2 transition duration-500 sm:px-2.5 ${landed && i === hit ? 'bg-ink ring-gold' : 'ring-transparent'}`}>
                        {fmt(b.count)}
                      </span>
                    </motion.span>
                  )}
                </div>
              );
            })}
          </div>
          {/* the needle: starts at the far left and swings over to the answer */}
          <motion.div className="absolute inset-y-0 z-10 w-0" style={{ left }} {...APPEAR}>
            <div className="absolute inset-y-0 -left-1 w-2 rounded-full bg-gold shadow-[0_0_24px_rgb(255_200_61/0.9)]" />
          </motion.div>
        </div>
        {/* the scale, with its two ends sharing the line under it however long their words are */}
        <div className="mt-1 h-3 rounded-full bg-white/25" />
        <div className="mt-2 flex items-start justify-between gap-4 text-sm leading-snug text-white/70 tabular-nums sm:text-xl short:text-base">
          <Value n={min} unit={unit} />
          <Value n={max} unit={unit} className="text-right" />
        </div>
        {/* a line of its own, there before the average fades in so nothing moves; on a phone on its side, where
            every line counts, the stats card says it instead */}
        {average != null && (
          <div className="mt-1 flex h-6 sm:h-9 short:hidden">
            <motion.span
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: landed ? 1 : 0, y: landed ? 0 : -8 }}
              className="relative h-fit w-fit max-w-full rounded-full bg-white/15 px-2 py-0.5 text-xs whitespace-nowrap text-white sm:px-3 sm:text-lg"
              // hung on its point the way the answer's label is
              style={{ left: `${at(average)}%`, translate: `${-at(average)}% 0` }}
            >
              ▲ เฉลี่ย {fmtValue(average)}
            </motion.span>
          </div>
        )}
      </div>
      {landed && <RevealStats q={q} r={r} delay={0.2} margin={margin} average={average} under />}
    </div>
  );
}

/** the needle's swing from the far left over to the answer */
const NEEDLE = { delay: 1, type: 'spring', stiffness: 45, damping: 9 } as const;
/** the needle and its label show up just before they set off */
const APPEAR = { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { delay: 0.9, duration: 0.2 } } as const;

/** a number in one piece, with its unit free to go onto the next line */
function Value({ n, unit, className = '' }: { n: number; unit?: string; className?: string }) {
  return (
    <span className={`break-words ${className}`}>
      <span className="whitespace-nowrap">{fmtValue(n)}</span>
      {unit && ` ${unit}`}
    </span>
  );
}

function RevealStats({
  q,
  r,
  delay = 0.8,
  margin = 0,
  average = null,
  under = false,
}: {
  q: QuestionPublic;
  r: RevealInfo;
  delay?: number;
  margin?: number;
  /** a slider's average guess, which a phone on its side shows here instead of on the scale */
  average?: number | null;
  /** on a phone it comes in under the scene, the width of it, instead of narrow beside it */
  under?: boolean;
}) {
  const silent = r.totalPlayers - r.answered;
  const label = q.type === 'slider' ? (margin > 0 ? `ได้คะแนน (ห่างไม่เกิน ±${fmtValue(margin)})` : 'ตอบตรงเป๊ะ') : q.type === 'puzzle' ? 'เรียงถูก' : 'ตอบถูก';
  // where it is wide but not tall (a phone on its side, or under the scene), the label and the count share a line
  const headline = `flex flex-col gap-1.5 sm:gap-3 short:flex-row short:items-baseline short:justify-between short:gap-3 ${under ? 'max-sm:flex-row max-sm:items-baseline max-sm:justify-between max-sm:gap-3' : ''}`;
  return (
    <motion.div
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 24 }}
      // narrow on a phone, beside the bars: its lines wrap instead
      className={`glass mb-2 flex shrink-0 flex-col gap-1.5 self-end px-3 py-3 text-sm sm:w-auto sm:min-w-64 sm:gap-3 sm:px-6 sm:py-5 sm:text-base low:gap-2 low:py-4 short:w-auto short:gap-1 short:py-1.5 short:mb-0 ${under ? 'max-sm:mb-0 max-sm:self-stretch' : 'w-32'}`}
    >
      {q.type === 'poll' ? (
        <div className={headline}>
          <div className="text-white/70">ผลโหวต</div>
          <div className="shrink-0 font-display text-3xl font-extrabold sm:text-5xl short:text-3xl">
            🗳️ {fmt(r.answered)} <span className="text-lg font-semibold text-white/80 sm:text-2xl short:text-lg">เสียง</span>
          </div>
        </div>
      ) : (
        <>
          <div className={headline}>
            <div className="text-white/70">{label}</div>
            <div className="shrink-0 font-display text-3xl font-extrabold sm:text-5xl short:text-3xl">
              {fmt(r.correctCount)}
              <span className="text-lg text-white/60 sm:text-2xl short:text-lg"> / {fmt(r.answered)}</span>
            </div>
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
          <div className="text-white/80 sm:text-lg">
            {percent(r.correctCount, r.answered)}% · <span className="whitespace-nowrap">เวลาเฉลี่ย</span> {secondsLabel(r.avgCorrectMs)}
          </div>
        </>
      )}
      {average != null && <div className="hidden text-white/80 short:block">▲ เฉลี่ยที่ทาย {fmtValue(average)}</div>}
      {silent > 0 && <div className="text-xs text-white/55 sm:text-sm">ไม่ได้ตอบ {fmt(silent)} คน</div>}
    </motion.div>
  );
}
