'use client';

import { useState } from 'react';
import { examSize, scoreExam, type ExamPaper } from '@pika-arena/shared';
import { MODE_LABEL, clock, doneCount, type Attempt, type ExamMode, type ExamSetup } from '@/lib/exam';
import { ExamHeader, topicName } from './parts';

const PACES: { value: number; label: string }[] = [
  { value: 0, label: 'ไม่จับเวลา' },
  { value: 30, label: 'ข้อละ 30 วินาที' },
  { value: 60, label: 'ข้อละ 1 นาที' },
  { value: 90, label: 'ข้อละ 1 นาทีครึ่ง' },
  { value: 120, label: 'ข้อละ 2 นาที' },
];

const MODES: { value: ExamMode; body: string }[] = [
  { value: 'practice', body: 'ตรวจคำตอบทีละข้อ เห็นเฉลยและคำอธิบายทันที เหมาะกับการทบทวน' },
  { value: 'mock', body: 'ทำให้ครบก่อนแล้วค่อยส่ง จับเวลาได้ เห็นคะแนนและเฉลยตอนจบ' },
];

/** Before a sitting: which topics, how many questions, and how to sit them. */
export function ExamStart({
  paper,
  attempt,
  now,
  onStart,
  onResume,
}: {
  paper: ExamPaper;
  /** the sitting already in this browser, in progress or finished */
  attempt: Attempt | null;
  /** when the page was opened, to say how much time a sitting in progress has left */
  now: number;
  onStart: (setup: ExamSetup) => void;
  onResume: () => void;
}) {
  const all = paper.topics.map((t) => t.id);
  const [picked, setPicked] = useState<string[]>(all);
  const [wanted, setWanted] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [mode, setMode] = useState<ExamMode>('practice');
  const [paceS, setPaceS] = useState(60);
  const [shuffle, setShuffle] = useState(true);

  const total = examSize(paper);
  const available = examSize(paper, picked);
  // the maker's own number for one sitting (a question bank's draw) until the person asks for another
  const count = Math.max(1, Math.min(wanted ?? paper.suggested ?? available, Math.max(available, 1)));
  const chips = [5, 10, 20, 30, 50, 100].filter((n) => n < available);
  const limitMs = mode === 'mock' && paceS > 0 ? count * paceS * 1000 : 0;

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : all.filter((x) => x === id || p.includes(x))));
  const setCount = (n: number) => {
    setDraft(null);
    setWanted(Math.max(1, Math.min(n, available)));
  };
  const typed = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    setDraft(digits);
    const n = Number.parseInt(digits, 10);
    if (n >= 1) setWanted(Math.min(n, available));
  };

  const inProgress = attempt && attempt.finishedAt === null ? attempt : null;
  const last = attempt && attempt.finishedAt !== null ? scoreExam(attempt.items, attempt.answers) : null;

  return (
    <div className="exam-page exam-themed">
      <ExamHeader />
      <main className="mx-auto max-w-3xl px-4 pt-8 pb-16">
        <p className="text-sm font-semibold tracking-wide text-ex-cue">ข้อสอบ</p>
        <h1 className="mt-1 font-display text-3xl leading-snug font-semibold sm:text-4xl text-balance wrap-anywhere">{paper.title || 'ข้อสอบไม่มีชื่อ'}</h1>
        {paper.description && <p className="mt-2 leading-relaxed wrap-anywhere text-ex-muted">{paper.description}</p>}
        <p className="mt-3 text-sm text-ex-soft">
          คลังคำถาม {total} ข้อ{paper.topics.length > 1 && ` · ${paper.topics.length} หัวข้อ`} · แบบเลือกตอบ
        </p>

        {inProgress && (
          <section className="exam-card mt-6 flex flex-col gap-3 border-ex-accent/50 bg-brand/15 p-5 sm:flex-row sm:items-center" aria-label="ข้อสอบที่ทำค้างไว้">
            <div className="flex-1">
              <p className="font-semibold">คุณทำค้างไว้ ({MODE_LABEL[inProgress.mode]})</p>
              <p className="mt-0.5 text-sm text-ex-muted">
                ทำแล้ว {doneCount(inProgress)} จาก {inProgress.items.length} ข้อ
                {inProgress.deadline !== null && ` · เวลายังเดินอยู่ เหลือ ${clock(inProgress.deadline - now)}`}
              </p>
            </div>
            <button type="button" onClick={onResume} className="exam-btn exam-btn-primary">
              ทำต่อ
            </button>
          </section>
        )}

        {last && attempt && (
          <section className="exam-card mt-6 flex flex-col gap-3 p-5 sm:flex-row sm:items-center" aria-label="ผลครั้งล่าสุด">
            <div className="flex-1">
              <p className="font-semibold">
                ผลครั้งล่าสุด: {last.correct} จาก {last.total} ข้อ ({last.percent}%)
              </p>
              <p className="mt-0.5 text-sm text-ex-muted">{MODE_LABEL[attempt.mode]} · เก็บไว้ในเบราว์เซอร์นี้เท่านั้น</p>
            </div>
            <button type="button" onClick={onResume} className="exam-btn">
              ดูผลและเฉลย
            </button>
          </section>
        )}

        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (available > 0) onStart({ topicIds: picked, count, mode, shuffle, paceS });
          }}
        >
          {paper.topics.length > 1 && (
            <fieldset className="exam-card p-5">
              <legend className="float-left w-full text-lg font-semibold">หัวข้อ</legend>
              <p className="clear-both pt-1 text-sm text-ex-soft">เลือกหัวข้อที่อยากทำ ระบบจะแบ่งจำนวนข้อให้ตามขนาดของแต่ละหัวข้อ</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {paper.topics.map((t, i) => (
                  <label
                    key={t.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${picked.includes(t.id) ? 'border-ex-accent bg-brand/15' : 'border-ex-line-strong bg-ex-raised hover:border-ex-accent/60'}`}
                  >
                    <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} className="mt-1 size-4 shrink-0 accent-brand" />
                    <span className="min-w-0 flex-1 wrap-anywhere">{topicName(t.title, i)}</span>
                    <span className="shrink-0 text-sm text-ex-soft">{t.questions.length} ข้อ</span>
                  </label>
                ))}
              </div>
              <div className="mt-3 flex gap-1">
                <button type="button" onClick={() => setPicked(all)} disabled={picked.length === all.length} className="exam-btn exam-btn-quiet min-h-9 px-2 text-sm">
                  เลือกทั้งหมด
                </button>
                <button type="button" onClick={() => setPicked([])} disabled={picked.length === 0} className="exam-btn exam-btn-quiet min-h-9 px-2 text-sm">
                  ไม่เลือกเลย
                </button>
              </div>
            </fieldset>
          )}

          <section className="exam-card p-5" aria-labelledby="exam-count-title">
            <h2 id="exam-count-title" className="text-lg font-semibold">
              จำนวนข้อ
            </h2>
            <p className="pt-1 text-sm text-ex-soft">
              {available === 0
                ? 'เลือกหัวข้ออย่างน้อยหนึ่งหัวข้อก่อน'
                : count < available
                  ? `สุ่ม ${count} ข้อ จากทั้งหมด ${available} ข้อ ทำใหม่แต่ละครั้งได้ชุดไม่ซ้ำเดิม`
                  : `ทำครบทั้ง ${available} ข้อ`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center">
                <button
                  type="button"
                  onClick={() => setCount(count - 1)}
                  disabled={available === 0 || count <= 1}
                  className="exam-btn size-11 rounded-r-none px-0 text-xl"
                  aria-label="ลดจำนวนข้อ"
                >
                  −
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="จำนวนข้อ"
                  value={draft ?? String(available === 0 ? 0 : count)}
                  disabled={available === 0}
                  onChange={(e) => typed(e.target.value)}
                  onBlur={() => setDraft(null)}
                  onFocus={(e) => e.target.select()}
                  className="h-11 w-16 border-y border-ex-line-strong bg-ex-input text-center text-lg font-semibold text-ex-fg outline-none focus:border-ex-accent focus:ring-1 focus:ring-ex-accent disabled:opacity-40"
                />
                <button
                  type="button"
                  onClick={() => setCount(count + 1)}
                  disabled={available === 0 || count >= available}
                  className="exam-btn size-11 rounded-l-none px-0 text-xl"
                  aria-label="เพิ่มจำนวนข้อ"
                >
                  ＋
                </button>
              </div>
              {chips.map((n) => (
                <button key={n} type="button" onClick={() => setCount(n)} aria-pressed={count === n} className={`exam-btn px-3 ${count === n ? 'border-ex-accent bg-brand/20 text-ex-fg' : ''}`}>
                  {n}
                </button>
              ))}
              {available > 0 && (
                <button
                  type="button"
                  onClick={() => setCount(available)}
                  aria-pressed={count === available}
                  className={`exam-btn px-3 ${count === available ? 'border-ex-accent bg-brand/20 text-ex-fg' : ''}`}
                >
                  ทั้งหมด ({available})
                </button>
              )}
            </div>
          </section>

          <fieldset className="exam-card p-5">
            <legend className="float-left w-full text-lg font-semibold">รูปแบบ</legend>
            <div className="clear-both grid gap-2 pt-3 sm:grid-cols-2">
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${mode === m.value ? 'border-ex-accent bg-brand/15 ring-1 ring-ex-accent' : 'border-ex-line-strong bg-ex-raised hover:border-ex-accent/60'}`}
                >
                  <input type="radio" name="exam-mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="mt-1 size-4 shrink-0 accent-brand" />
                  <span>
                    <span className="block font-semibold">{MODE_LABEL[m.value]}</span>
                    <span className="mt-0.5 block text-sm leading-relaxed text-ex-muted">{m.body}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-ex-line pt-4">
              {mode === 'mock' && (
                <label className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold">เวลา</span>
                  <select
                    value={paceS}
                    onChange={(e) => setPaceS(Number(e.target.value))}
                    className="exam-field h-11 px-3 text-base"
                  >
                    {PACES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {limitMs > 0 && <span className="text-sm text-ex-soft">รวม {clock(limitMs)} นาที หมดเวลาแล้วส่งให้เอง</span>}
                </label>
              )}
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} className="mt-1 size-4 shrink-0 accent-brand" />
                <span>
                  <span className="block font-semibold">สลับลำดับข้อ</span>
                  <span className="block text-sm text-ex-muted">ปิดไว้ ข้อจะเรียงตามหัวข้อและลำดับที่ผู้ออกข้อสอบเขียน</span>
                </span>
              </label>
            </div>
          </fieldset>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="submit" disabled={available === 0} className="exam-btn exam-btn-primary min-h-12 px-8 text-lg">
              เริ่มทำข้อสอบ
            </button>
            <p className="text-sm text-ex-soft">
              {inProgress ? 'เริ่มใหม่จะแทนที่ชุดที่ทำค้างไว้ · ' : ''}ไม่ต้องเข้าสู่ระบบ คำตอบและคะแนนอยู่ในเบราว์เซอร์นี้เท่านั้น
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
