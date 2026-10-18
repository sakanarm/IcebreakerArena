'use client';

import { animate, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useServerNow } from '@/lib/clock';
import { fmt } from '@/lib/format';
import { sfx } from '@/lib/sfx';

/** Counts a number up without re-rendering React on every frame. */
export function CountUp({
  from = 0,
  to,
  duration = 1.2,
  delay = 0,
  className,
}: {
  from?: number;
  to: number;
  duration?: number;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || from === to) {
      el.textContent = fmt(to);
      return;
    }
    const controls = animate(from, to, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => (el.textContent = fmt(v)),
    });
    return () => controls.stop();
  }, [from, to, duration, delay, reduce]);
  return (
    <span ref={ref} className={`tabular-nums ${className ?? ''}`}>
      {fmt(from)}
    </span>
  );
}

/**
 * Countdown ring for an open question. Mount it when answering opens: the
 * ring animates once, linearly, to zero; the number ticks from server time.
 */
export function TimerRing({
  startsAt,
  endsAt,
  size = 128,
  ticks = false,
}: {
  startsAt: number;
  endsAt: number;
  size?: number;
  ticks?: boolean;
}) {
  const now = useServerNow(true, 200);
  const total = Math.max(1, endsAt - startsAt);
  const left = Math.max(0, endsAt - now);
  const secs = Math.ceil(left / 1000);
  const danger = left <= 5000;
  // where the ring starts: full when mounted as answering opens, less after a reload mid-question
  const [initialLeft] = useState(left);

  useEffect(() => {
    if (ticks && secs > 0 && secs <= 5) sfx.play('tick');
  }, [secs, ticks]);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`เหลือ ${secs} วินาที`}>
      <motion.div
        className="absolute inset-0 rounded-full bg-bad/30"
        animate={danger && secs > 0 ? { scale: [1, 1.18, 1], opacity: [0.7, 0, 0.7] } : { scale: 1, opacity: 0 }}
        transition={danger ? { duration: 1, repeat: Infinity } : { duration: 0.2 }}
      />
      <svg viewBox="0 0 100 100" className="relative h-full w-full -rotate-90">
        <circle cx="50" cy="50" r="44" fill="rgb(0 0 0 / 0.35)" stroke="rgb(255 255 255 / 0.15)" strokeWidth="8" />
        <motion.circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className={danger ? 'stroke-bad' : 'stroke-gold'}
          initial={{ pathLength: Math.min(1, initialLeft / total) }}
          animate={{ pathLength: 0 }}
          transition={{ duration: initialLeft / 1000, ease: 'linear' }}
        />
      </svg>
      <motion.span
        key={secs}
        initial={{ scale: 1.4, opacity: 0.5 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
        className={`absolute inset-0 grid place-items-center font-display font-extrabold tabular-nums ${danger ? 'text-bad' : ''}`}
        style={{ fontSize: size * 0.36 }}
      >
        {secs}
      </motion.span>
    </div>
  );
}

/** "Waiting…" dots */
export function WaitingDots() {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-2 rounded-full bg-current"
          animate={{ opacity: [0.25, 1, 0.25], y: [0, -4, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
        />
      ))}
    </span>
  );
}

/** A number that pops whenever it changes (answer counter, player counter). */
export function PopNumber({ value, className }: { value: number; className?: string }) {
  return (
    <motion.span
      key={value}
      initial={{ scale: 1.35 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 600, damping: 18 }}
      className={`inline-block tabular-nums ${className ?? ''}`}
    >
      {fmt(value)}
    </motion.span>
  );
}
