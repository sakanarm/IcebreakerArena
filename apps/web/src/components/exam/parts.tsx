'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExamQuestion } from '@pika-arena/shared';
import { letter } from '@/lib/exam';
import { SiteNav } from '../SiteNav';

/** The bar over every exam page but the paper itself: the app's own menu, with ข้อสอบ as the place you are. */
export function ExamHeader() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-5">
      <SiteNav here="exam" />
    </div>
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
      className="mt-4 max-h-72 max-w-full rounded-xl border border-ex-line object-contain"
    />
  );
}

/** How an option looks: before the answer is shown it is only chosen or not; after, right and wrong are told apart in words as well as color. */
export type ChoiceLook = 'idle' | 'chosen' | 'right' | 'wrong' | 'rest';

const LOOK: Record<ChoiceLook, { box: string; badge: string }> = {
  idle: { box: 'border-ex-line-strong bg-ex-raised', badge: 'border-ex-line-strong bg-ex-card text-ex-muted' },
  chosen: { box: 'border-ex-accent bg-brand/20 ring-1 ring-ex-accent', badge: 'border-brand bg-brand text-white' },
  right: { box: 'border-ex-good/80 bg-ex-good/10 ring-1 ring-ex-good/80', badge: 'border-ex-good bg-ex-good text-night' },
  wrong: { box: 'border-ex-bad/80 bg-ex-bad/10 ring-1 ring-ex-bad/80', badge: 'border-ex-bad bg-ex-bad text-night' },
  rest: { box: 'border-ex-line bg-transparent text-ex-soft', badge: 'border-ex-line bg-transparent text-ex-soft' },
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
        {note && <span className={`mt-0.5 block text-sm font-semibold ${look === 'right' ? 'text-ex-good' : 'text-ex-bad'}`}>{note}</span>}
      </span>
    </>
  );
}

export const choiceBox = (look: ChoiceLook) => `flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${LOOK[look].box}`;

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
    <div className="mt-4 rounded-xl border border-ex-line border-l-4 border-l-ex-accent bg-ex-raised px-4 py-3">
      <p className="text-sm font-semibold text-ex-accent">คำอธิบาย</p>
      <p className="mt-1 leading-relaxed wrap-anywhere whitespace-pre-line text-ex-fg">{text.trim()}</p>
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
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="exam-confirm-title" className="exam-card w-full max-w-md p-6 shadow-2xl">
        <h2 id="exam-confirm-title" className="text-xl font-semibold">
          {title}
        </h2>
        <div className="mt-3 leading-relaxed text-ex-fg">{children}</div>
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
  const fill = tone === 'good' ? 'bg-ex-good' : tone === 'low' ? 'bg-gold' : 'bg-linear-to-r from-brand to-brand-2';
  return (
    <div className="h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
    </div>
  );
}
