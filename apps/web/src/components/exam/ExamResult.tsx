'use client';

import { useState } from 'react';
import { isRightChoice, scoreExam, type ExamItem } from '@pika-arena/shared';
import { MODE_LABEL, duration, ranOut, usedMs, type Attempt } from '@/lib/exam';
import type { AiPaper } from '@/lib/exam-ai';
import { AskAi } from './AskAi';
import { Bar, ExamHeader, Explanation, QuestionImage, ShownChoices, rightLetters, topicName } from './parts';

/** under this share of right answers a topic is worth going over again */
const REVISE_BELOW = 60;

type Filter = 'all' | 'wrong' | 'skipped' | 'flagged';
type Outcome = 'right' | 'wrong' | 'skipped';

const OUTCOME: Record<Outcome, { label: string; tag: string }> = {
  right: { label: 'ตอบถูก', tag: 'bg-ex-good/15 text-ex-good' },
  wrong: { label: 'ตอบผิด', tag: 'bg-ex-bad/15 text-ex-bad' },
  skipped: { label: 'ไม่ได้ตอบ', tag: 'bg-ex-wash/10 text-ex-muted' },
};

/**
 * After a sitting: the score, how each topic went, and every question with its answer and the
 * maker's explanation. The questions missed can be sat again on their own.
 */
export function ExamResult({
  attempt,
  onRetry,
  onNew,
  ai,
}: {
  attempt: Attempt;
  /** where the server finds this paper for "ถาม AI"; null when it can't */
  ai: AiPaper | null;
  /** sit these questions again, as practice */
  onRetry: (items: ExamItem[]) => void;
  /** back to the start page for another draw */
  onNew: () => void;
}) {
  const { items, answers, flags } = attempt;
  const score = scoreExam(items, answers);
  const outcomes: Outcome[] = items.map((it, i) => (answers[i] == null ? 'skipped' : isRightChoice(it.question, answers[i]) ? 'right' : 'wrong'));
  const missed = items.filter((_, i) => outcomes[i] !== 'right');
  const flagged = flags.filter(Boolean).length;
  const [filter, setFilter] = useState<Filter>('all');

  const filters: { value: Filter; label: string; count: number }[] = [
    { value: 'all', label: 'ทั้งหมด', count: score.total },
    { value: 'wrong', label: 'ตอบผิด', count: score.wrong },
    { value: 'skipped', label: 'ไม่ได้ตอบ', count: score.skipped },
    { value: 'flagged', label: 'ติดธง', count: flagged },
  ];
  const listed = items
    .map((_, i) => i)
    .filter((i) => (filter === 'all' ? true : filter === 'flagged' ? flags[i] : outcomes[i] === filter));
  const tone = score.percent >= 80 ? 'good' : score.percent < REVISE_BELOW ? 'low' : 'brand';

  return (
    <div className="exam-page exam-themed">
      <ExamHeader />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <p className="text-sm font-semibold tracking-wide text-ex-cue">ผลการทำข้อสอบ · {MODE_LABEL[attempt.mode]}</p>
        <h1 className="mt-1 font-display text-2xl leading-snug font-semibold text-balance wrap-anywhere sm:text-3xl">{attempt.title || 'ข้อสอบ'}</h1>

        <section className="exam-card mt-6 p-5 sm:p-7" aria-label="คะแนน">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <p>
              <span className="font-display text-5xl font-semibold tabular-nums" data-exam-score>
                {score.correct}
              </span>
              <span className="text-2xl font-semibold text-ex-soft tabular-nums"> / {score.total} ข้อ</span>
            </p>
            <p className={`font-display text-3xl font-semibold tabular-nums ${tone === 'good' ? 'text-ex-good' : tone === 'low' ? 'text-ex-warn' : 'text-ex-accent'}`} data-exam-percent>
              {score.percent}%
            </p>
          </div>
          <div className="mt-4">
            <Bar percent={score.percent} tone={tone} />
          </div>
          <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['ถูก', score.correct, 'text-ex-good'],
                ['ผิด', score.wrong, 'text-ex-bad'],
                ['ไม่ได้ตอบ', score.skipped, 'text-ex-muted'],
              ] as const
            ).map(([label, n, color]) => (
              <div key={label} className="rounded-xl border border-ex-line bg-ex-raised px-2 py-3">
                <dd className={`text-2xl font-semibold tabular-nums ${color}`}>{n}</dd>
                <dt className="text-sm text-ex-muted">{label}</dt>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-ex-muted">
            ใช้เวลา {duration(usedMs(attempt))}
            {ranOut(attempt) && <span className="font-semibold text-ex-bad"> · หมดเวลา ระบบส่งข้อสอบให้อัตโนมัติ</span>}
          </p>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-ex-line pt-5">
            {missed.length > 0 && (
              <button type="button" onClick={() => onRetry(missed)} className="exam-btn exam-btn-primary">
                ทำข้อที่พลาดอีกครั้ง ({missed.length} ข้อ)
              </button>
            )}
            <button type="button" onClick={onNew} className={`exam-btn ${missed.length === 0 ? 'exam-btn-primary' : ''}`}>
              สุ่มชุดใหม่
            </button>
          </div>
        </section>

        {score.topics.length > 1 && (
          <section className="exam-card mt-4 p-5 sm:p-7" aria-labelledby="exam-topics-title">
            <h2 id="exam-topics-title" className="text-lg font-semibold">
              คะแนนรายหัวข้อ
            </h2>
            <ul className="mt-3 grid gap-4">
              {score.topics.map((t, i) => (
                <li key={t.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="min-w-0 wrap-anywhere">
                      {topicName(t.title, i)}
                      {t.percent < REVISE_BELOW && <span className="ml-2 rounded-md bg-ex-warn/15 px-1.5 py-0.5 text-xs font-semibold text-ex-warn">ควรทวน</span>}
                    </p>
                    <p className="text-sm text-ex-muted tabular-nums">
                      {t.correct} / {t.total} ข้อ ({t.percent}%)
                    </p>
                  </div>
                  <div className="mt-1.5">
                    <Bar percent={t.percent} tone={t.percent >= 80 ? 'good' : t.percent < REVISE_BELOW ? 'low' : 'brand'} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-8" aria-labelledby="exam-review-title">
          <h2 id="exam-review-title" className="text-xl font-semibold">
            เฉลยทุกข้อ
          </h2>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="กรองข้อที่แสดง">
            {filters
              .filter((f) => f.value === 'all' || f.count > 0)
              .map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  aria-pressed={filter === f.value}
                  className={`exam-btn min-h-9 px-3 text-sm ${filter === f.value ? 'border-ex-accent bg-brand/20 text-ex-fg' : ''}`}
                >
                  {f.label} ({f.count})
                </button>
              ))}
          </div>

          <ol className="mt-4 grid gap-4">
            {listed.map((i) => {
              const it = items[i]!;
              const outcome = outcomes[i]!;
              return (
                <li key={i} className="exam-card p-5 sm:p-6" data-exam-review={outcome}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="font-semibold">ข้อ {i + 1}</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-xs font-semibold ${OUTCOME[outcome].tag}`}>{OUTCOME[outcome].label}</span>
                    {flags[i] && <span className="rounded-md bg-ex-warn/15 px-1.5 py-0.5 text-xs font-semibold text-ex-warn">⚑ ติดธง</span>}
                    {it.topicTitle.trim() && <span className="min-w-0 wrap-anywhere text-ex-soft">{it.topicTitle.trim()}</span>}
                  </div>
                  <h3 className="mt-2 text-lg leading-relaxed font-semibold wrap-anywhere whitespace-pre-line">{it.question.prompt}</h3>
                  {it.question.imageUrl && <QuestionImage url={it.question.imageUrl} />}
                  <ShownChoices question={it.question} answer={answers[i] ?? null} />
                  {outcome === 'skipped' && <p className="mt-3 text-sm font-semibold text-ex-muted">ไม่ได้ตอบข้อนี้ · คำตอบที่ถูกคือ {rightLetters(it.question)}</p>}
                  <Explanation text={it.question.explanation} />
                  <AskAi paper={ai} question={it.question} chosen={answers[i] ?? null} />
                </li>
              );
            })}
          </ol>
          {listed.length === 0 && <p className="exam-card mt-4 p-5 text-ex-muted">ไม่มีข้อในกลุ่มนี้</p>}
        </section>
      </main>
    </div>
  );
}
