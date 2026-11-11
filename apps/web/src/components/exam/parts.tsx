'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ExamQuestion } from '@pika-arena/shared';
import { letter } from '@/lib/exam';

/** The bar over every exam page but the paper itself: where this is, and the way back. */
export function ExamHeader() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4 text-sm">
        <Link href="/" className="rounded font-semibold text-ink hover:text-brand">
          MFEC Pika Arena
        </Link>
        <span className="text-slate-300" aria-hidden>
          /
        </span>
        <Link href="/exam" className="rounded font-semibold whitespace-nowrap text-slate-600 hover:text-brand">
          โหมดข้อสอบ
        </Link>
        <nav aria-label="ไปที่อื่น" className="ml-auto flex items-center gap-1">
          <Link href="/host" className="rounded-md px-2 py-1.5 font-semibold whitespace-nowrap text-slate-600 hover:bg-slate-100 hover:text-ink max-[359px]:hidden" data-testid="exam-nav-host">
            เกมของฉัน
          </Link>
          <Link href="/create" className="rounded-md px-2 py-1.5 font-semibold whitespace-nowrap text-brand hover:bg-brand/10" data-testid="exam-nav-create">
            ＋ สร้างข้อสอบ
          </Link>
        </nav>
      </div>
    </header>
  );
}

/** a round the maker left unnamed still needs a name on the paper */
export const topicName = (title: string, index: number) => title.trim() || `หัวข้อที่ ${index + 1}`;

/** A question's picture. Makers link pictures from any https host; one that fails to load just leaves no hole. */
export function QuestionImage({ url }: { url: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  if (broken === url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="ภาพประกอบคำถาม"
      referrerPolicy="no-referrer"
      onError={() => setBroken(url)}
      className="mt-4 max-h-72 max-w-full rounded-lg border border-slate-200 object-contain"
    />
  );
}

/** How an option looks: before the answer is shown it is only chosen or not; after, right and wrong are told apart in words as well as color. */
export type ChoiceLook = 'idle' | 'chosen' | 'right' | 'wrong' | 'rest';

const LOOK: Record<ChoiceLook, { box: string; badge: string }> = {
  idle: { box: 'border-slate-300 bg-white', badge: 'border-slate-300 bg-white text-slate-600' },
  chosen: { box: 'border-brand bg-brand/5 ring-1 ring-brand', badge: 'border-brand bg-brand text-white' },
  right: { box: 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600', badge: 'border-emerald-600 bg-emerald-600 text-white' },
  wrong: { box: 'border-rose-500 bg-rose-50 ring-1 ring-rose-500', badge: 'border-rose-600 bg-rose-600 text-white' },
  rest: { box: 'border-slate-200 bg-white text-slate-500', badge: 'border-slate-200 bg-white text-slate-400' },
};

/** which look option `i` takes once the answer is shown */
export function shownLook(q: ExamQuestion, i: number, answer: number | null): ChoiceLook {
  if (q.correct.includes(i)) return 'right';
  return answer === i ? 'wrong' : 'rest';
}

/** The inside of an option: its letter, its text, and after the answer is shown what it was. */
export function ChoiceBody({ index, text, look, mine }: { index: number; text: string; look: ChoiceLook; mine: boolean }) {
  const note = look === 'right' ? (mine ? 'คำตอบของคุณ ถูกต้อง' : 'คำตอบที่ถูก') : look === 'wrong' ? 'คำตอบของคุณ' : '';
  return (
    <>
      <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-sm font-semibold ${LOOK[look].badge}`} aria-hidden>
        {look === 'right' ? '✓' : look === 'wrong' ? '✕' : letter(index)}
      </span>
      <span className="min-w-0 flex-1 py-0.5 text-left leading-relaxed wrap-anywhere whitespace-pre-line">
        <span className="sr-only">{letter(index)}. </span>
        {(look === 'right' || look === 'wrong') && (
          <span className="mr-1 font-semibold" aria-hidden>
            {letter(index)}.
          </span>
        )}
        {text}
        {note && <span className={`mt-0.5 block text-sm font-semibold ${look === 'right' ? 'text-emerald-700' : 'text-rose-700'}`}>{note}</span>}
      </span>
    </>
  );
}

export const choiceBox = (look: ChoiceLook) => `flex w-full items-start gap-3 rounded-lg border px-3.5 py-3 ${LOOK[look].box}`;

/** A question's options with the answer shown: for the review after a sitting. */
export function ShownChoices({ question, answer }: { question: ExamQuestion; answer: number | null }) {
  return (
    <ul className="mt-4 grid gap-2">
      {question.options.map((text, i) => {
        const look = shownLook(question, i, answer);
        return (
          <li key={i} className={choiceBox(look)}>
            <ChoiceBody index={i} text={text} look={look} mine={answer === i} />
          </li>
        );
      })}
    </ul>
  );
}

/** The maker's explanation of the answer, when there is one. */
export function Explanation({ text }: { text?: string }) {
  if (!text?.trim()) return null;
  return (
    <div className="mt-4 rounded-lg border-l-4 border-brand bg-slate-50 px-4 py-3">
      <p className="text-sm font-semibold text-brand">คำอธิบาย</p>
      <p className="mt-1 leading-relaxed wrap-anywhere whitespace-pre-line text-slate-700">{text.trim()}</p>
    </div>
  );
}

/** "คำตอบที่ถูกคือ B" (or "B หรือ D" when the maker marked more than one) */
export const rightLetters = (q: ExamQuestion) => q.correct.map(letter).join(' หรือ ');

/** A question asked in the page itself, since a browser's own confirm box cannot say enough and looks like an error. */
export function ConfirmDialog({
  title,
  children,
  confirm,
  cancel,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: React.ReactNode;
  confirm: string;
  cancel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const first = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // the latest onCancel, so a new function from the page behind does not move the focus about
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    first.current?.focus();
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return cancelRef.current();
      if (e.key !== 'Tab') return;
      // the page behind is not to be reached while the question is open
      const stops = [...(box.current?.querySelectorAll<HTMLElement>('button, a[href]') ?? [])];
      if (stops.length === 0) return;
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
      e.preventDefault();
      stops[next]!.focus();
    };
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('keydown', keys);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/50 p-4" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="exam-confirm-title" className="exam-card w-full max-w-md p-6 shadow-xl">
        <h2 id="exam-confirm-title" className="text-xl font-semibold">
          {title}
        </h2>
        <div className="mt-3 leading-relaxed text-slate-700">{children}</div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={first} type="button" onClick={onCancel} className="exam-btn">
            {cancel}
          </button>
          <button type="button" onClick={onConfirm} className="exam-btn exam-btn-primary">
            {confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A thin bar filled to `percent`. */
export function Bar({ percent, tone = 'brand' }: { percent: number; tone?: 'brand' | 'good' | 'low' }) {
  const fill = tone === 'good' ? 'bg-emerald-600' : tone === 'low' ? 'bg-amber-500' : 'bg-brand';
  return (
    <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}
