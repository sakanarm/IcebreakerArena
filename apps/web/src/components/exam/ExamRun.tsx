'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isRightChoice } from '@pika-arena/shared';
import { MODE_LABEL, answeredCount, clock, doneCount, letter, type Attempt } from '@/lib/exam';
import type { AiPaper } from '@/lib/exam-ai';
import { AskAi } from './AskAi';
import { ChoiceBody, ConfirmDialog, Explanation, QuestionImage, choiceBox, rightLetters, shownLook, topicName, type ChoiceLook } from './parts';

/** a pause longer than this is not time spent on the paper (the lid was shut, the tab was left) */
const IDLE_MS = 5000;

/**
 * The paper itself: one question at a time, a grid of all of them to move about, and for a mock
 * exam the clock. Every change goes back up through `onChange`, which also keeps it in the browser,
 * so a refresh or a closed tab lands on the same question with the same answers.
 */
export function ExamRun({
  attempt,
  onChange,
  onFinish,
  onLeave,
  ai,
}: {
  attempt: Attempt;
  /** where the server finds this paper for "ถาม AI"; null when it can't */
  ai: AiPaper | null;
  onChange: (change: (a: Attempt) => Attempt) => void;
  /** hand the paper in; `spentMs` is the time spent on it so far */
  onFinish: (spentMs: number) => void;
  /** back to the start page; the sitting stays as it is */
  onLeave: (spentMs: number) => void;
}) {
  const { items, answers, checked, flags, at, mode } = attempt;
  const item = items[at]!;
  const q = item.question;
  const answer = answers[at] ?? null;
  const shown = mode === 'practice' && checked[at]!;
  const done = doneCount(attempt);
  const left = items.length - done;
  const [asking, setAsking] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  // time with the paper open and in front of the person
  const spent = useRef(attempt.spentMs);
  const last = useRef(0);
  /** counts the time since the last count, up to this very moment, and gives the total */
  const tally = useCallback(() => {
    const now = Date.now();
    if (last.current > 0 && document.visibilityState === 'visible' && now - last.current < IDLE_MS) spent.current += now - last.current;
    last.current = now;
    return spent.current;
  }, []);
  useEffect(() => {
    last.current = Date.now();
    const timer = setInterval(tally, 1000);
    // a tab that is put away or closed keeps what it counted
    const keep = () => {
      if (document.visibilityState === 'hidden') {
        // the moment it was put away still counts: the page was visible until now
        const now = Date.now();
        if (now - last.current < IDLE_MS) spent.current += now - last.current;
        last.current = now;
        const spentMs = spent.current;
        onChange((a) => ({ ...a, spentMs }));
      } else last.current = Date.now();
    };
    document.addEventListener('visibilitychange', keep);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', keep);
    };
  }, [onChange, tally]);

  const change = (fn: (a: Attempt) => Attempt) => {
    const spentMs = tally();
    onChange((a) => ({ ...fn(a), spentMs }));
  };
  const put = <K extends 'answers' | 'checked' | 'flags'>(field: K, value: Attempt[K][number]) =>
    change((a) => ({ ...a, [field]: a[field].map((v, i) => (i === a.at ? value : v)) }));

  const go = (to: number) => {
    if (to >= 0 && to < items.length && to !== at) change((a) => ({ ...a, at: to }));
  };
  const choose = (i: number) => {
    if (!shown && i < q.options.length) put('answers', i);
  };
  const check = () => {
    if (mode === 'practice' && !shown) put('checked', true);
  };
  /** practice: the next question not yet checked, going round; -1 when every one is */
  const nextOpen = (() => {
    for (let k = 1; k <= items.length; k++) {
      const i = (at + k) % items.length;
      if (!checked[i]) return i;
    }
    return -1;
  })();
  const finish = useCallback(() => onFinish(tally()), [onFinish, tally]);
  /** hand in at once when nothing is left to do, otherwise ask first */
  const handIn = () => (mode === 'practice' && left === 0 ? finish() : setAsking(true));
  /** the main button's job, and Enter's */
  const onward = () => {
    if (mode === 'practice') {
      if (!shown) return answer !== null ? check() : undefined;
      return nextOpen >= 0 ? go(nextOpen) : finish();
    }
    return at < items.length - 1 ? go(at + 1) : setAsking(true);
  };

  // a new question starts at its top, and a screen reader starts reading it
  useEffect(() => {
    window.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [at]);

  // keys: 1–4 or A–D choose, Enter goes on, the arrows move, F flags. By the key's place on the
  // keyboard (e.code), so they work the same with a Thai layout switched on.
  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (asking || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select')) return;
      const pick = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
      const byLetter = /^Key([A-H])$/.exec(e.code)?.[1];
      const index = pick ? Number(pick) - 1 : byLetter ? byLetter.charCodeAt(0) - 65 : -1;
      if (index >= 0 && index < q.options.length) {
        e.preventDefault();
        return choose(index);
      }
      if (e.code === 'KeyF') return put('flags', !flags[at]);
      if (e.code === 'ArrowRight') return go(at + 1);
      if (e.code === 'ArrowLeft') return go(at - 1);
      if (e.key === 'Enter') {
        // Enter on a button or a link presses it, except on an option, where it goes on like anywhere else
        if (target?.closest('button, a') && !target.closest('[data-choice]')) return;
        e.preventDefault();
        onward();
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });

  const unanswered = items.map((_, i) => i).filter((i) => (mode === 'practice' ? !checked[i] : answers[i] == null));
  const flagged = flags.filter(Boolean).length;
  const right = shown && isRightChoice(q, answer);

  return (
    <div className="exam-page">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <button type="button" onClick={() => onLeave(tally())} className="exam-btn exam-btn-quiet -ml-2 min-h-10 shrink-0 px-2 text-sm" aria-label="ออกจากข้อสอบ กลับมาทำต่อได้">
            ← ออก
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            {attempt.title || 'ข้อสอบ'} <span className="font-normal text-slate-500">· {MODE_LABEL[mode]}</span>
          </p>
          {attempt.deadline !== null && <Countdown deadline={attempt.deadline} onTimeUp={finish} />}
          <button type="button" onClick={handIn} className="exam-btn exam-btn-primary min-h-10 shrink-0 px-3 text-sm">
            {mode === 'mock' ? 'ส่งข้อสอบ' : 'สรุปผล'}
          </button>
        </div>
        <div
          className="h-1 bg-slate-100"
          role="progressbar"
          aria-label={mode === 'mock' ? 'ข้อที่ตอบแล้ว' : 'ข้อที่ทำแล้ว'}
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={done}
        >
          <div className="h-full bg-brand transition-[width] duration-200" style={{ width: `${(done * 100) / items.length}%` }} />
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-5 px-4 pt-5 pb-16 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
        <section aria-label={`ข้อ ${at + 1} จาก ${items.length}`}>
          <article className="exam-card p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-sm text-slate-500">
                <span className="font-semibold text-ink">
                  ข้อ {at + 1} / {items.length}
                </span>
                {item.topicTitle.trim() && <span className="wrap-anywhere"> · {item.topicTitle.trim()}</span>}
              </p>
              <button
                type="button"
                onClick={() => put('flags', !flags[at])}
                aria-pressed={flags[at]}
                className={`exam-btn min-h-9 px-2.5 text-sm ${flags[at] ? 'border-amber-500 bg-amber-50 text-amber-800 hover:not-disabled:border-amber-500 hover:not-disabled:bg-amber-100' : 'text-slate-600'}`}
              >
                <span aria-hidden>{flags[at] ? '⚑' : '⚐'}</span> {flags[at] ? 'ติดธงไว้' : 'ติดธงกลับมาดู'}
              </button>
            </div>

            <h1 ref={heading} tabIndex={-1} id="exam-prompt" className="mt-3 text-lg leading-relaxed font-semibold wrap-anywhere whitespace-pre-line outline-none sm:text-xl">
              {q.prompt}
            </h1>
            {q.imageUrl && <QuestionImage key={q.imageUrl} url={q.imageUrl} />}

            <div role="radiogroup" aria-labelledby="exam-prompt" className="mt-5 grid gap-2.5">
              {q.options.map((text, i) => {
                const look: ChoiceLook = shown ? shownLook(q, i, answer) : answer === i ? 'chosen' : 'idle';
                return (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    data-choice
                    aria-checked={answer === i}
                    aria-disabled={shown}
                    onClick={() => choose(i)}
                    className={`${choiceBox(look)} ${shown ? 'cursor-default' : 'hover:border-brand'}`}
                  >
                    <ChoiceBody index={i} text={text} look={look} mine={answer === i} />
                  </button>
                );
              })}
            </div>

            {shown && (
              <div className="mt-5" role="status">
                <p className={`font-semibold ${right ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {right ? '✓ ถูกต้อง' : answer === null ? `ข้อนี้ไม่ได้ตอบ คำตอบที่ถูกคือ ${rightLetters(q)}` : `✕ ยังไม่ถูก คำตอบที่ถูกคือ ${rightLetters(q)}`}
                </p>
                <Explanation text={q.explanation} />
                <AskAi paper={ai} question={q} chosen={answer} />
              </div>
            )}
          </article>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => go(at - 1)} disabled={at === 0} className="exam-btn">
              ← ก่อนหน้า
            </button>
            {mode === 'practice' ? (
              shown ? (
                <button type="button" onClick={onward} className="exam-btn exam-btn-primary">
                  {nextOpen >= 0 ? 'ข้อต่อไป →' : 'ดูสรุปผล'}
                </button>
              ) : (
                <>
                  <button type="button" onClick={check} disabled={answer === null} className="exam-btn exam-btn-primary">
                    ตรวจคำตอบ
                  </button>
                  <button type="button" onClick={() => go(at + 1)} disabled={at === items.length - 1} className="exam-btn">
                    ข้าม →
                  </button>
                  <button type="button" onClick={check} className="exam-btn exam-btn-quiet">
                    ดูเฉลย
                  </button>
                </>
              )
            ) : (
              <>
                {at < items.length - 1 ? (
                  <button type="button" onClick={() => go(at + 1)} className="exam-btn exam-btn-primary">
                    ถัดไป →
                  </button>
                ) : (
                  <button type="button" onClick={() => setAsking(true)} className="exam-btn exam-btn-primary">
                    ส่งข้อสอบ
                  </button>
                )}
                {answer !== null && (
                  <button type="button" onClick={() => put('answers', null)} className="exam-btn exam-btn-quiet">
                    ล้างคำตอบ
                  </button>
                )}
              </>
            )}
          </div>
          <p className="mt-3 hidden text-sm text-slate-500 lg:block">
            แป้นลัด: 1–{Math.min(q.options.length, 9)} หรือ A–{letter(q.options.length - 1)} เลือกคำตอบ · Enter {mode === 'practice' ? 'ตรวจ / ข้อต่อไป' : 'ข้อถัดไป'} · ← → เปลี่ยนข้อ · F ติดธง
          </p>
        </section>

        <nav aria-label="ทุกข้อ" className="exam-card p-4 lg:sticky lg:top-20">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold">ทุกข้อ</h2>
            <p className="text-sm text-slate-500">
              {mode === 'mock' ? `ตอบแล้ว ${answeredCount(attempt)}` : `ทำแล้ว ${done}`} / {items.length}
            </p>
          </div>
          <ol className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5">
            {items.map((it, i) => {
              const state = cellState(attempt, i);
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === at ? 'step' : undefined}
                    aria-label={`ข้อ ${i + 1}: ${CELL[state].label}${flags[i] ? ' ติดธงไว้' : ''}`}
                    className={`relative grid h-11 w-full place-items-center rounded-md border text-sm font-semibold ${CELL[state].box} ${i === at ? 'ring-2 ring-brand ring-offset-2' : ''}`}
                  >
                    {i + 1}
                    {flags[i] && <span className="absolute -top-1 -right-1 size-3 rounded-full border-2 border-white bg-amber-500" aria-hidden />}
                  </button>
                </li>
              );
            })}
          </ol>
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600" aria-hidden>
            {(mode === 'mock' ? (['answered', 'open'] as const) : (['right', 'wrong', 'open'] as const)).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className={`size-3 rounded-sm border ${CELL[s].box}`} /> {CELL[s].legend}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="size-3 rounded-full bg-amber-500" /> ติดธง
            </li>
          </ul>
        </nav>
      </main>

      {asking && (
        <ConfirmDialog
          title={mode === 'mock' ? 'ส่งข้อสอบเลยไหม?' : 'จบการฝึกตอนนี้ไหม?'}
          confirm={mode === 'mock' ? 'ส่งข้อสอบ' : 'ดูสรุปผล'}
          cancel="กลับไปทำต่อ"
          onCancel={() => setAsking(false)}
          onConfirm={finish}
        >
          {unanswered.length === 0 ? (
            <p>ตอบครบทั้ง {items.length} ข้อแล้ว ส่งแล้วจะแก้คำตอบไม่ได้</p>
          ) : (
            <p>
              ยังเหลือ <strong className="font-semibold text-rose-700">{unanswered.length} ข้อ</strong> ที่ยังไม่ได้{mode === 'mock' ? 'ตอบ' : 'ทำ'} (ข้อ{' '}
              {unanswered
                .slice(0, 12)
                .map((i) => i + 1)
                .join(', ')}
              {unanswered.length > 12 ? ' …' : ''}) จะนับเป็นไม่ได้ตอบ
            </p>
          )}
          {flagged > 0 && <p className="mt-2">ติดธงไว้ {flagged} ข้อ ที่ตั้งใจจะกลับมาดู</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}

type CellState = 'open' | 'picked' | 'answered' | 'right' | 'wrong' | 'skipped';

const CELL: Record<CellState, { box: string; label: string; legend: string }> = {
  open: { box: 'border-slate-300 bg-white text-slate-700 hover:border-brand', label: 'ยังไม่ได้ทำ', legend: 'ยังไม่ได้ทำ' },
  picked: { box: 'border-brand bg-white text-brand', label: 'เลือกไว้ ยังไม่ได้ตรวจ', legend: 'เลือกไว้' },
  answered: { box: 'border-brand bg-brand text-white', label: 'ตอบแล้ว', legend: 'ตอบแล้ว' },
  right: { box: 'border-emerald-600 bg-emerald-600 text-white', label: 'ตอบถูก', legend: 'ถูก' },
  wrong: { box: 'border-rose-600 bg-rose-600 text-white', label: 'ตอบผิด', legend: 'ผิด' },
  skipped: { box: 'border-slate-400 bg-slate-400 text-white', label: 'ดูเฉลยโดยไม่ได้ตอบ', legend: 'ไม่ได้ตอบ' },
};

function cellState(a: Attempt, i: number): CellState {
  const answer = a.answers[i] ?? null;
  if (a.mode === 'mock') return answer === null ? 'open' : 'answered';
  if (!a.checked[i]) return answer === null ? 'open' : 'picked';
  return answer === null ? 'skipped' : isRightChoice(a.items[i]!.question, answer) ? 'right' : 'wrong';
}

/** The time left. It goes by the clock on the wall, so a refresh or a nap of the tab does not stop it. */
function Countdown({ deadline, onTimeUp }: { deadline: number; onTimeUp: () => void }) {
  const [left, setLeft] = useState(() => deadline - Date.now());
  useEffect(() => {
    const tick = () => {
      const ms = deadline - Date.now();
      setLeft(ms);
      if (ms <= 0) onTimeUp();
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadline, onTimeUp]);

  const low = left <= 60_000;
  return (
    <p
      role="timer"
      aria-label={`เหลือเวลา ${clock(left)}`}
      className={`shrink-0 rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${low ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}
    >
      <span aria-hidden>⏱ </span>
      {clock(left)}
    </p>
  );
}
