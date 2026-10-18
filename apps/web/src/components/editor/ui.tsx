'use client';

import { motion } from 'motion/react';
import { useId } from 'react';

/** A pill switch between a few choices: question type, points, round multiplier. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode; title?: string }[];
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`relative rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${on ? 'text-white' : 'text-slate-600 hover:text-ink'}`}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 rounded-xl bg-ink"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 p-3 text-left ring-1 ring-slate-200 transition-colors hover:bg-slate-100"
    >
      <span className={`relative flex h-7 w-12 shrink-0 rounded-full p-1 transition-colors ${on ? 'justify-end bg-good' : 'justify-start bg-slate-300'}`}>
        <motion.span layout transition={{ type: 'spring', stiffness: 600, damping: 34 }} className="size-5 rounded-full bg-white shadow" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-sm text-slate-500">{hint}</span>}
      </span>
    </button>
  );
}

/** "45/120" under a text box; turns red near the limit. */
export function Counter({ length, max }: { length: number; max: number }) {
  return (
    <span className={`text-xs tabular-nums ${length > max * 0.9 ? 'font-semibold text-bad' : 'text-slate-400'}`} aria-hidden>
      {length}/{max}
    </span>
  );
}

export function FieldLabel({ htmlFor, children, extra }: { htmlFor: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-end justify-between gap-2">
      <label htmlFor={htmlFor} className="font-display font-semibold">
        {children}
      </label>
      {extra}
    </div>
  );
}

/** Small square icon buttons for move / duplicate / delete. */
export function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`grid size-10 place-items-center rounded-xl bg-slate-100 text-lg transition hover:bg-slate-200 active:scale-90 disabled:opacity-35 disabled:hover:bg-slate-100 ${danger ? 'text-bad' : 'text-ink'}`}
    >
      {children}
    </button>
  );
}

/** What this spot still needs before the game can be played: a to-do list, not an alarm. */
export function Issues({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl bg-gold/20 px-4 py-3 text-sm text-amber-900">
      <p className="font-semibold">ยังขาดอีกนิด</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((m) => (
          <li key={m}>• {m}</li>
        ))}
      </ul>
    </motion.div>
  );
}
