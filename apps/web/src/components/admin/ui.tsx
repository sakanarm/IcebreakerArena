'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Small parts the admin page's tabs share. Everything sits on the exam pages' dark cards (globals.css). */

/** An on/off switch with its label and a line of explanation. */
export function Switch({
  checked,
  onChange,
  title,
  text,
  disabled,
  testid,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  title: string;
  text?: ReactNode;
  disabled?: boolean;
  testid?: string;
}) {
  const id = useId();
  return (
    <div className={`flex items-start justify-between gap-4 py-3 ${disabled ? 'opacity-50' : ''}`}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block font-semibold">{title}</span>
        {text && <span className="mt-0.5 block text-sm leading-relaxed text-ex-soft">{text}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        data-testid={testid}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors ${
          checked ? 'border-ex-good/70 bg-ex-good/80' : 'border-ex-line-strong bg-night/70'
        }`}
      >
        <span className={`inline-block size-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        <span className="sr-only">{checked ? 'เปิด' : 'ปิด'}</span>
      </button>
    </div>
  );
}

/** A labelled input: the label above, an optional hint and error below. */
export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ex-muted">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1.5 text-sm text-ex-bad">{error}</p> : hint ? <p className="mt-1.5 text-sm leading-relaxed text-ex-soft">{hint}</p> : null}
    </div>
  );
}

export const inputClass = 'exam-field w-full px-3.5 py-2.5 text-base';

export type Tone = 'neutral' | 'good' | 'bad' | 'accent' | 'gold';

const TONES: Record<Tone, string> = {
  neutral: 'border-ex-line-strong bg-white/[0.04] text-ex-muted',
  good: 'border-ex-good/40 bg-ex-good/10 text-ex-good',
  bad: 'border-ex-bad/40 bg-ex-bad/10 text-ex-bad',
  accent: 'border-ex-accent/40 bg-ex-accent/10 text-ex-accent',
  gold: 'border-gold/40 bg-gold/10 text-gold',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${TONES[tone]}`}>{children}</span>;
}

/** A message under a form: what went wrong, or that it worked. */
export function Say({ tone, children }: { tone: 'good' | 'bad' | 'gold'; children: ReactNode }) {
  return (
    <p role={tone === 'bad' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${TONES[tone]}`}>
      {children}
    </p>
  );
}

/**
 * A dialog over the page: a sheet from the bottom on a phone, a centred panel on a wider screen.
 * Escape and the backdrop close it (unless `locked` while something is being saved); focus moves in.
 */
export function Sheet({ title, onClose, locked, children, testid }: { title: string; onClose: () => void; locked?: boolean; children: ReactNode; testid?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !lockedRef.current && close.current();
    document.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-[2px] sm:items-center sm:p-6" onPointerDown={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testid}
        className="exam-card flex max-h-[92dvh] w-full flex-col rounded-b-none outline-none sm:max-w-xl sm:rounded-b-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-ex-line px-5 py-4">
          <h2 id={titleId} className="min-w-0 truncate text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} disabled={locked} aria-label="ปิด" className="exam-btn exam-btn-quiet min-h-9 px-2.5">
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

/** A password made on the server, shown this once with a copy button. */
export function OneTimeSecret({ label, value, note }: { label: string; value: string; note: ReactNode }) {
  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    try {
      await navigator.clipboard.writeText(value);
      button.textContent = 'คัดลอกแล้ว';
    } catch {
      // select it so the admin can copy by hand
      const code = button.parentElement?.querySelector('code');
      if (code) window.getSelection()?.selectAllChildren(code);
    }
  };
  return (
    <div className="rounded-xl border border-gold/40 bg-gold/[0.07] p-4" data-testid="one-time-secret">
      <p className="text-sm font-semibold text-gold">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-lg bg-night/80 px-3 py-2 font-mono text-lg tracking-wider break-all text-ex-fg select-all" data-testid="secret-value">
          {value}
        </code>
        <button type="button" onClick={copy} className="exam-btn min-h-10 px-3 text-sm">
          คัดลอก
        </button>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ex-muted">{note}</p>
    </div>
  );
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('th', { numeric: 'auto' }) : null;

/** "3 ชั่วโมงที่แล้ว", or the date for anything older than a month */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const a = Math.abs(s);
  if (!rtf) return new Date(iso).toLocaleString('th-TH');
  if (a < 60) return 'เมื่อสักครู่';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 30 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const fullTime = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

export const num = (n: number) => n.toLocaleString('th-TH');
