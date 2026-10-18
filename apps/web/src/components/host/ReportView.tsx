'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { GameReport, ReportPlayer, ReportQuestion } from '@icebreaker/shared';
import { downloadText, toCsv } from '@/lib/csv';
import { fmt, percent, secondsLabel, TYPE_LABEL } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { ANSWER_BG, AnswerShape } from '../shapes';

type Tab = 'players' | 'questions';

const seconds = (ms: number | null) => (ms === null ? null : Number((ms / 1000).toFixed(1)));

/** End-of-game report for the Host: who scored what, and which questions were hard. */
export function ReportView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [report, setReport] = useState<GameReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('players');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    getSocket()
      .timeout(8000)
      .emitWithAck('host:report')
      .then((res) => {
        if (!alive) return;
        if (res.ok) setReport(res.report);
        else setError('โหลดรายงานไม่ได้: ดูได้เฉพาะผู้สร้างห้อง');
      })
      .catch(() => alive && setError('เชื่อมต่อเกมเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง'));
    panel.current?.focus();
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const exportCsv = () => {
    if (!report) return;
    const name = `icebreaker-${report.pin}-${tab === 'players' ? 'players' : 'questions'}.csv`;
    downloadText(name, toCsv(tab === 'players' ? playerRows(report.players) : questionRows(report.questions)));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="รายงานผลเกม"
            initial={{ y: 40, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 30, scale: 0.97, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="card flex h-[88dvh] w-full max-w-5xl flex-col overflow-hidden outline-none"
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-extrabold">📊 รายงานผลเกม</h2>
                {report && <Summary report={report} />}
              </div>
              <button type="button" onClick={onClose} className="btn bg-slate-100 px-4 text-ink" aria-label="ปิดรายงาน">
                ✕
              </button>
            </header>

            <div className="flex items-center justify-between gap-3 px-6 pt-4">
              <div role="tablist" className="flex gap-2 rounded-2xl bg-slate-100 p-1">
                {(['players', 'questions'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className="relative rounded-xl px-5 py-2 font-display font-semibold"
                  >
                    {tab === t && <motion.span layoutId="report-tab" className="absolute inset-0 rounded-xl bg-white shadow" />}
                    <span className="relative">{t === 'players' ? '👥 ผู้เล่น' : '❓ รายข้อ'}</span>
                  </button>
                ))}
              </div>
              <button type="button" onClick={exportCsv} disabled={!report} className="btn btn-primary text-base">
                ⬇️ ดาวน์โหลด CSV
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {error ? (
                <p className="mt-10 text-center text-lg text-bad">{error}</p>
              ) : !report ? (
                <p className="mt-10 text-center text-lg text-slate-500">กำลังโหลดรายงาน…</p>
              ) : tab === 'players' ? (
                <PlayersTable players={report.players} />
              ) : (
                <QuestionsList questions={report.questions} />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Summary({ report }: { report: GameReport }) {
  const graded = report.questions.filter((q) => q.type !== 'poll' && q.answered > 0);
  const accuracy = graded.length
    ? Math.round(graded.reduce((sum, q) => sum + percent(q.correctCount, q.answered), 0) / graded.length)
    : null;
  const hardest = [...graded].sort((a, b) => a.correctCount / a.answered - b.correctCount / b.answered)[0];
  const when = report.startedAt
    ? new Date(report.startedAt).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
    : null;

  return (
    <div className="mt-1 text-slate-600">
      <p className="truncate font-semibold text-ink">{report.gameTitle}</p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {when && <span>🗓️ {when}</span>}
        <span>👥 {fmt(report.playerCount)} คน</span>
        <span>❓ {fmt(report.questions.length)} ข้อ</span>
        {accuracy !== null && <span>✅ ตอบถูกเฉลี่ย {accuracy}%</span>}
        {hardest && (
          <span>
            🧠 ข้อที่ยากที่สุด: ข้อ {hardest.number} (ถูก {percent(hardest.correctCount, hardest.answered)}%)
          </span>
        )}
      </p>
    </div>
  );
}

const MEDAL = ['bg-gold', 'bg-slate-300', 'bg-orange-300'];

function PlayersTable({ players }: { players: ReportPlayer[] }) {
  if (players.length === 0) return <p className="mt-10 text-center text-slate-500">ยังไม่มีผู้เล่น</p>;
  return (
    <table className="w-full text-left">
      <thead className="sticky top-0 bg-white text-sm text-slate-500">
        <tr>
          <th className="py-2 pr-2">อันดับ</th>
          <th className="py-2">ผู้เล่น</th>
          <th className="py-2 text-right">คะแนน</th>
          <th className="py-2 pl-6">ตอบถูก</th>
          <th className="py-2 text-right">เวลาเฉลี่ย</th>
          <th className="py-2 text-right">ติดกันสูงสุด</th>
        </tr>
      </thead>
      <tbody>
        {players.map((p) => (
          <tr key={`${p.rank}-${p.nickname}`} className="border-t border-slate-100">
            <td className="py-2 pr-2">
              <span className={`grid size-9 place-items-center rounded-full font-display font-extrabold ${MEDAL[p.rank - 1] ?? 'bg-slate-100'}`}>
                {p.rank}
              </span>
            </td>
            <td className="max-w-64 truncate py-2 font-semibold">
              <span className="mr-2 text-xl" aria-hidden>
                {p.avatar}
              </span>
              {p.nickname}
            </td>
            <td className="py-2 text-right font-display text-lg font-extrabold tabular-nums">{fmt(p.score)}</td>
            <td className="py-2 pl-6">
              <div className="flex items-center gap-2">
                <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-good" style={{ width: `${percent(p.correctCount, p.answeredCount)}%` }} />
                </div>
                <span className="text-sm tabular-nums text-slate-600">
                  {p.correctCount}/{p.answeredCount}
                </span>
              </div>
            </td>
            <td className="py-2 text-right tabular-nums text-slate-600">{secondsLabel(p.avgMs)}</td>
            <td className="py-2 text-right tabular-nums">{p.bestStreak >= 2 ? `🔥 ${p.bestStreak}` : p.bestStreak}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuestionsList({ questions }: { questions: ReportQuestion[] }) {
  if (questions.length === 0) return <p className="mt-10 text-center text-slate-500">ยังไม่ได้เล่นข้อไหนเลย</p>;
  return (
    <ol className="flex flex-col gap-4">
      {questions.map((q) => {
        const poll = q.type === 'poll';
        const rate = percent(q.correctCount, q.answered);
        const tone = rate >= 70 ? 'bg-good' : rate >= 40 ? 'bg-gold' : 'bg-bad';
        return (
          <li key={q.number} className="rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <span className="rounded-full bg-ink px-3 py-0.5 font-semibold text-white">ข้อ {q.number}</span>
              <span>{q.roundTitle}</span>
              <span>· {TYPE_LABEL[q.type]}</span>
              <span>· ตอบ {fmt(q.answered)} คน</span>
              {!poll && <span>· เวลาเฉลี่ย {secondsLabel(q.avgMs)}</span>}
              {!poll && q.answered > 0 && (
                <span className={`ml-auto rounded-full px-3 py-0.5 font-semibold text-white ${tone}`}>ถูก {rate}%</span>
              )}
            </div>
            <p className="mt-2 text-lg font-semibold">{q.prompt}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {q.options.map((o, i) => {
                const right = q.correct.includes(i);
                const share = percent(q.counts[i] ?? 0, q.answered);
                return (
                  <div key={i} className="relative overflow-hidden rounded-xl bg-slate-100">
                    <div className={`absolute inset-y-0 left-0 opacity-25 ${ANSWER_BG[i]}`} style={{ width: `${share}%` }} />
                    <div className="relative flex items-center gap-2 px-3 py-2">
                      <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${ANSWER_BG[i]}`}>
                        <AnswerShape index={i} className="size-4 text-white" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o}</span>
                      {right && <span className="font-extrabold text-good">✓</span>}
                      <span className="tabular-nums text-sm text-slate-600">
                        {fmt(q.counts[i] ?? 0)} ({share}%)
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function playerRows(players: ReportPlayer[]) {
  return [
    ['อันดับ', 'ชื่อเล่น', 'คะแนน', 'ตอบถูก', 'ตอบทั้งหมด', 'เวลาเฉลี่ย (วินาที)', 'ตอบถูกติดกันสูงสุด'],
    ...players.map((p) => [p.rank, p.nickname, p.score, p.correctCount, p.answeredCount, seconds(p.avgMs), p.bestStreak]),
  ];
}

function questionRows(questions: ReportQuestion[]) {
  return [
    ['ข้อ', 'ด่าน', 'ประเภท', 'คำถาม', 'ตัวเลือก 1', 'ตัวเลือก 2', 'ตัวเลือก 3', 'ตัวเลือก 4', 'คำตอบที่ถูก', 'จำนวนคนตอบ', 'ตอบถูก', '% ถูก', 'เวลาเฉลี่ย (วินาที)'],
    ...questions.map((q) => {
      const poll = q.type === 'poll';
      const options = [0, 1, 2, 3].map((i) => (q.options[i] === undefined ? null : `${q.options[i]} (${q.counts[i] ?? 0} คน)`));
      return [
        q.number,
        q.roundTitle,
        TYPE_LABEL[q.type],
        q.prompt,
        ...options,
        poll ? null : q.correct.map((i) => q.options[i]).join(' / '),
        q.answered,
        poll ? null : q.correctCount,
        poll ? null : percent(q.correctCount, q.answered),
        poll ? null : seconds(q.avgMs),
      ];
    }),
  ];
}
