'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Award, LeaderRow, StageState } from '@icebreaker/shared';
import { shower } from '@/lib/confetti';
import { AWARDS_AT, CROWN_S, DRUMROLL_AT, FALL_S, MEDAL_S, PLACE_AT, RIDER_S, medalFall, type Place } from '@/lib/podium';
import { sfx } from '@/lib/sfx';
import { CountUp } from '../motion-bits';

const PLACES: { place: Place; height: string; medal: string; color: string }[] = [
  { place: 2, height: 'h-28 sm:h-44 lg:h-52 low:h-[15dvh] short:h-12', medal: '🥈', color: 'from-slate-200 to-slate-400' },
  { place: 1, height: 'h-36 sm:h-60 lg:h-72 low:h-[22dvh] short:h-16', medal: '🥇', color: 'from-amber-200 to-gold' },
  { place: 3, height: 'h-20 sm:h-32 lg:h-40 low:h-[10dvh] short:h-9', medal: '🥉', color: 'from-orange-200 to-orange-400' },
];

/** step 1: 3rd is on, 2: 2nd, 3: the winner, 4: the awards */
const STEP_OF: Record<Place, number> = { 3: 1, 2: 2, 1: 3 };

/**
 * 3rd, then 2nd, then a drum roll and the winner with confetti, then the awards. Each stand rises out of the
 * floor as its place is called and its player pops onto it, then a medal falls onto their name; two spotlights
 * follow each place, sweep the stage through the drum roll and lock onto the winner. Under reduced motion
 * nothing moves: each part fades in at its moment, and the lights come on for the winner only.
 */
export function StagePodium({ state }: { state: StageState }) {
  const [step, setStep] = useState(0);
  const [drum, setDrum] = useState(false);
  const reduce = useReducedMotion() ?? false;
  // the timeline is set once, as the podium comes on; who is on it does not change by then
  const podium = useRef(state.podium);
  useEffect(() => {
    podium.current = state.podium;
  }, [state.podium]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    for (const place of [3, 2, 1] as const) {
      at(PLACE_AT[place], () => {
        setStep(STEP_OF[place]);
        sfx.play('rise');
        if (place === 1) {
          sfx.play('fanfare');
          shower(3500);
        }
      });
      at(PLACE_AT[place] + (MEDAL_S + FALL_S) * 1000, () => podium.current[place - 1] && sfx.play('clink'));
    }
    at(DRUMROLL_AT, () => {
      setDrum(true);
      sfx.play('drumroll');
    });
    at(AWARDS_AT, () => setStep(4));
    return () => timers.forEach(clearTimeout);
  }, []);

  const block = useRef<HTMLDivElement>(null);
  const slots = useRef<Partial<Record<Place, HTMLDivElement | null>>>({});
  const target: Place = step >= 3 ? 1 : step >= 2 ? 2 : 3;

  return (
    // a phone on its side has no height for the awards under the stands, so they come in beside them
    <div className="flex h-full flex-col items-center justify-end-safe gap-3 sm:gap-6 low:gap-4 short:flex-row short:items-end-safe short:justify-center short:gap-4">
      {/* moves up (or aside) smoothly when the awards come in, with the lights on it */}
      <motion.div
        ref={block}
        layout="position"
        className="relative flex w-full max-w-4xl flex-col items-center gap-3 sm:gap-6 low:max-w-3xl low:gap-3 short:max-w-md short:gap-2"
      >
        <Spotlights block={block} slots={slots} target={target} on={reduce ? step >= 3 : step >= 1} sweep={!reduce && drum && step < 3} />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h2
            key={step >= 3 ? 'won' : 'wait'}
            initial={step >= 3 ? { scale: 0.6, opacity: 0 } : { y: -30, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 16 }}
            className="relative font-display text-3xl font-extrabold sm:text-5xl lg:text-6xl low:text-4xl short:text-xl"
          >
            {step >= 3 ? 'สุดยอดผู้ชนะ!' : 'ประกาศผล…'}
          </motion.h2>
        </AnimatePresence>
        <div className="relative flex w-full flex-col items-center">
          <div className="flex w-full items-end justify-center gap-2 sm:gap-4">
            {PLACES.map((p) => (
              <Pedestal
                key={p.place}
                {...p}
                row={state.podium[p.place - 1]}
                risen={step >= STEP_OF[p.place]}
                reduce={reduce}
                slotRef={(el) => void (slots.current[p.place] = el)}
              />
            ))}
          </div>
          {/* the floor the stands come up through */}
          <div className="h-1.5 w-full rounded-full bg-white/30 shadow-[0_0_24px_rgb(255_255_255/0.35)] sm:h-2 short:h-1" />
        </div>
      </motion.div>
      <AnimatePresence>
        {step >= 4 && state.awards.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex max-w-full flex-wrap justify-center gap-2 sm:gap-4 short:shrink-0 short:flex-col short:flex-nowrap short:pb-1"
          >
            {state.awards.map((a, i) => (
              <AwardCard key={a.kind} award={a} delay={i * 0.25} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface Beam {
  /** where it hangs, along the top of the lights' box (px) */
  x: number;
  width: number;
  length: number;
  /** degrees to turn it to each place */
  aim: Record<Place, number>;
}

/**
 * Two beams from above the stage, one from either side, aimed at a place's player. They hang from the top
 * of a box over the podium that clips them, so what they sweep never makes the scene scroll.
 */
function Spotlights({
  block,
  slots,
  target,
  on,
  sweep,
}: {
  block: RefObject<HTMLDivElement | null>;
  slots: RefObject<Partial<Record<Place, HTMLDivElement | null>>>;
  target: Place;
  on: boolean;
  sweep: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [beams, setBeams] = useState<Beam[] | null>(null);

  // aimed by measure: the columns sit differently on a projector, a laptop and a phone on its side
  useLayoutEffect(() => {
    const el = box.current;
    const outer = block.current;
    if (!el || !outer) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return;
      const points = ([1, 2, 3] as const).map((p) => {
        const s = slots.current[p]?.getBoundingClientRect();
        // at the player's face and name, in the slot over the stand
        return s ? { p, x: s.left + s.width / 2 - b.left, y: s.top + s.height * 0.6 - b.top } : { p, x: b.width / 2, y: b.height * 0.7 };
      });
      const width = Math.min(260, Math.max(90, b.width * 0.2));
      setBeams(
        [0.14, 0.86].map((f) => {
          const x = b.width * f;
          const aim = {} as Record<Place, number>;
          let length = 0;
          for (const { p, x: px, y: py } of points) {
            aim[p] = (-Math.atan2(px - x, py) * 180) / Math.PI;
            length = Math.max(length, Math.hypot(px - x, py) * 1.25);
          }
          return { x, width, length, aim };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    return () => ro.disconnect();
  }, [block, slots]);

  return (
    <div ref={box} aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 bottom-0 overflow-clip">
      {beams?.map((b, i) => {
        const aims = Object.values(b.aim);
        const lo = Math.min(...aims) - 6;
        const hi = Math.max(...aims) + 6;
        return (
          <motion.div
            key={i}
            data-spot={i}
            data-aim={sweep ? 'sweep' : on ? target : 'off'}
            className="absolute top-0 bg-linear-to-b from-amber-50/55 via-amber-50/20 to-transparent [clip-path:polygon(46%_0,54%_0,100%_100%,0_100%)]"
            style={{ left: b.x - b.width / 2, width: b.width, height: b.length, originX: 0.5, originY: 0 }}
            initial={{ opacity: 0, rotate: b.aim[target] }}
            animate={
              sweep
                ? { opacity: 1, rotate: i ? [hi, lo] : [lo, hi], transition: { rotate: { duration: i ? 0.5 : 0.62, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' }, opacity: { duration: 0.2 } } }
                : { opacity: on ? 1 : 0, rotate: b.aim[target], transition: { rotate: { type: 'spring', stiffness: 120, damping: 14 }, opacity: { duration: 0.3 } } }
            }
          />
        );
      })}
    </div>
  );
}

function Pedestal({
  place,
  height,
  medal,
  color,
  row,
  risen,
  reduce,
  slotRef,
}: {
  place: Place;
  height: string;
  medal: string;
  color: string;
  row: LeaderRow | undefined;
  risen: boolean;
  reduce: boolean;
  slotRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="flex w-1/3 max-w-72 min-w-0 flex-col items-center">
      {/* the winner also gets a crown, so their slot is taller or it would run into the title */}
      {/* the slot and what is in it take the column's width, so a long name is cut short instead of spilling over */}
      <div
        ref={slotRef}
        className={`flex w-full ${place === 1 ? 'h-40 sm:h-56 low:h-44 short:h-32' : 'h-28 sm:h-44 low:h-36 short:h-24'} flex-col items-center justify-end pb-2 sm:pb-3 short:pb-1`}
      >
        <AnimatePresence>
          {risen && row && (
            <motion.div
              data-rider={place}
              initial={{ y: 60, scale: 0.3, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              transition={{ delay: RIDER_S, type: 'spring', stiffness: 260, damping: 15, opacity: { delay: RIDER_S, duration: 0.15 } }}
              className="relative flex w-full flex-col items-center text-center"
            >
              {place === 1 && !reduce && (
                // light turning slowly behind the winner
                <motion.span
                  data-rays
                  aria-hidden
                  className="absolute top-[45%] left-1/2 -z-10 size-60 -translate-x-1/2 -translate-y-1/2 sm:size-96 low:size-72 short:size-44"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: RIDER_S + 0.15, duration: 0.5 }}
                >
                  <span className="animate-rays block size-full rounded-full bg-[repeating-conic-gradient(rgb(255_214_90/0.35)_0_10deg,transparent_10deg_30deg)] [mask-image:radial-gradient(closest-side,black_25%,transparent)]" />
                </motion.span>
              )}
              {place === 1 && (
                <motion.span
                  className="text-3xl sm:text-5xl low:text-4xl short:text-2xl"
                  initial={{ y: -40, rotate: -30, opacity: 0 }}
                  animate={{ y: 0, rotate: 0, opacity: 1 }}
                  transition={{ delay: CROWN_S, type: 'spring', stiffness: 300, damping: 12, opacity: { delay: CROWN_S, duration: 0.12 } }}
                  aria-hidden
                >
                  👑
                </motion.span>
              )}
              <span className={`animate-bob inline-block ${place === 1 ? 'text-5xl sm:text-7xl low:text-5xl short:text-4xl' : 'text-4xl sm:text-6xl low:text-5xl short:text-4xl'}`} aria-hidden>
                {row.avatar}
              </span>
              {/* the medal lands on the left end of the name */}
              <span className="relative mt-1 flex max-w-full items-center">
                <span className="max-w-full truncate rounded-full bg-white py-0.5 pr-2 pl-7 text-sm font-semibold text-ink shadow-lg sm:py-1 sm:pr-4 sm:pl-11 sm:text-xl low:pl-10 low:text-lg short:pl-6 short:text-xs">
                  {row.nickname}
                </span>
                {!reduce && (
                  <motion.span
                    aria-hidden
                    className={`absolute top-1/2 -left-1.5 size-9 -translate-y-1/2 rounded-full border-4 sm:-left-2 sm:size-14 short:size-7 ${place === 1 ? 'border-gold' : 'border-white'}`}
                    initial={{ scale: 1, opacity: 0 }}
                    animate={{ scale: 2.4, opacity: [0, 0.9, 0] }}
                    transition={{ delay: MEDAL_S + FALL_S, duration: 0.6, ease: 'easeOut' }}
                  />
                )}
                <motion.span
                  data-medal={place}
                  className="absolute top-1/2 -left-1.5 -translate-y-1/2 text-3xl drop-shadow-lg sm:-left-2 sm:text-5xl low:text-4xl short:text-2xl"
                  {...medalFall(140, MEDAL_S)}
                  aria-label={`อันดับ ${place}`}
                >
                  {medal}
                </motion.span>
              </span>
              <span className="mt-1 font-display text-lg font-extrabold whitespace-nowrap sm:text-2xl low:text-xl short:mt-0.5 short:text-base">
                <CountUp to={row.score} duration={1.4} /> <span className="text-xs font-normal text-white/70 sm:text-base">แต้ม</span>
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {/* the floor cuts off what is below it; the headroom above lets the stand overshoot as it lands */}
      <div className="-mt-8 w-full overflow-clip pt-8">
        <motion.div
          data-stand={place}
          initial={reduce ? { opacity: 0 } : { y: '101%' }}
          animate={reduce ? { opacity: risen ? 1 : 0 } : { y: risen ? 0 : '101%' }}
          transition={{ type: 'spring', stiffness: 260, damping: 20, opacity: { duration: 0.25 } }}
          className={`w-full rounded-t-2xl bg-linear-to-b sm:rounded-t-3xl ${color} ${height} flex justify-center pt-2 shadow-[inset_0_-10px_0_rgb(0_0_0/0.15)] sm:pt-4 low:pt-2 short:pt-0.5`}
        >
          <span className="font-display text-4xl font-extrabold text-ink/70 sm:text-6xl low:text-5xl short:text-2xl">{place}</span>
        </motion.div>
      </div>
    </div>
  );
}

function AwardCard({ award, delay }: { award: Award; delay: number }) {
  return (
    <motion.div
      initial={{ y: 40, opacity: 0, rotate: -3 }}
      animate={{ y: 0, opacity: 1, rotate: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 18 }}
      className="glass flex max-w-full items-center gap-3 px-3 py-2 sm:gap-4 sm:px-5 sm:py-3 low:py-2 short:max-w-48 short:gap-2 short:py-1.5"
    >
      <span className="text-3xl sm:text-4xl short:text-2xl" aria-hidden>
        {award.kind === 'fastest' ? '⚡' : '🔥'}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold tracking-wide text-gold sm:text-sm">{award.title}</div>
        <div className="truncate text-base font-semibold sm:text-xl short:text-sm">
          {award.avatar} {award.nickname}
        </div>
        <div className="text-xs text-white/70 sm:text-sm">{award.value}</div>
      </div>
    </motion.div>
  );
}
