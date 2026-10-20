'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { sliderBinRanges, type GameReport, type QuestionType, type ReportPlayer, type ReportQuestion, type SliderSpec } from '@icebreaker/shared';
import { downloadText, toCsv } from '@/lib/csv';
import { fmt, fmtValue, percent, secondsLabel, TYPE_ICON, TYPE_LABEL } from '@/lib/format';
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
                  <div className="h-full rounded-full bg-good" style={{ width: `${percent(p.correctCount, p.gradedCount)}%` }} />
                </div>
                <span className="text-sm tabular-nums text-slate-600">
                  {p.gradedCount ? `${p.correctCount}/${p.gradedCount}` : '–'}
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
              <span>
                · <span aria-hidden>{TYPE_ICON[q.type]}</span> {TYPE_LABEL[q.type]}
              </span>
              <span>· ตอบ {fmt(q.answered)} คน</span>
              {!poll && <span>· เวลาเฉลี่ย {secondsLabel(q.avgMs)}</span>}
              {!poll && q.answered > 0 && (
                <span className={`ml-auto rounded-full px-3 py-0.5 font-semibold text-white ${tone}`}>
                  {RATE_LABEL[q.type]} {rate}%
                </span>
              )}
            </div>
            <p className="mt-2 text-lg font-semibold">{q.prompt}</p>
            <QuestionResult q={q} />
          </li>
        );
      })}
    </ol>
  );
}

/** what counts as right on each type's badge: a slider guess scores when it is close enough */
const RATE_LABEL: Record<QuestionType, string> = {
  quiz: 'ถูก',
  truefalse: 'ถูก',
  poll: 'ถูก',
  puzzle: 'เรียงถูก',
  type: 'พิมพ์ถูก',
  slider: 'ได้คะแนน',
};

function QuestionResult({ q }: { q: ReportQuestion }) {
  if (q.type === 'puzzle') return <PuzzleOrder items={q.options} />;
  if (q.type === 'slider') return q.slider ? <SliderChart q={q} spec={q.slider} /> : null;
  if (q.type === 'type') {
    const matched = q.counts.reduce((sum, n) => sum + n, 0);
    return (
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {q.options.map((o, i) => (
          <CountBar key={i} label={o} count={q.counts[i] ?? 0} total={q.answered} fill="bg-good" badge={i === 0 ? '⌨️' : '＝'} badgeBg="bg-good" right />
        ))}
        <CountBar label="พิมพ์คำอื่น" count={Math.max(0, q.answered - matched)} total={q.answered} fill="bg-bad" badge="✗" badgeBg="bg-slate-400" />
      </div>
    );
  }
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {q.options.map((o, i) => (
        <CountBar
          key={i}
          label={o}
          count={q.counts[i] ?? 0}
          total={q.answered}
          fill={ANSWER_BG[i] ?? 'bg-slate-400'}
          badge={<AnswerShape index={i} className="size-4 text-white" />}
          badgeBg={ANSWER_BG[i] ?? 'bg-slate-400'}
          right={q.correct.includes(i)}
        />
      ))}
    </div>
  );
}

function CountBar({
  label,
  count,
  total,
  fill,
  badge,
  badgeBg,
  right,
}: {
  label: string;
  count: number;
  total: number;
  fill: string;
  badge: React.ReactNode;
  badgeBg: string;
  right?: boolean;
}) {
  const share = percent(count, total);
  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-100">
      <div className={`absolute inset-y-0 left-0 opacity-25 ${fill}`} style={{ width: `${share}%` }} />
      <div className="relative flex items-center gap-2 px-3 py-2">
        <span aria-hidden className={`grid size-7 shrink-0 place-items-center rounded-lg text-sm text-white ${badgeBg}`}>
          {badge}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {right && <span className="font-extrabold text-good">✓</span>}
        <span className="tabular-nums text-sm text-slate-600">
          {fmt(count)} ({share}%)
        </span>
      </div>
    </div>
  );
}

/** A puzzle's answer: its items in the right order. Players order them all and pick none, so there is nothing to count. */
function PuzzleOrder({ items }: { items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-slate-500">ลำดับที่ถูก</p>
      <ol className="mt-1.5 flex flex-wrap items-center gap-2">
        {items.map((o, i) => (
          <li key={i} className="flex min-w-0 items-center gap-2">
            {i > 0 && (
              <span aria-hidden className="text-slate-400">
                →
              </span>
            )}
            <span className={`flex min-w-0 items-center gap-2 rounded-xl py-1.5 pr-3 pl-1.5 font-semibold text-white ${ANSWER_BG[i] ?? 'bg-slate-500'}`}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-sm font-extrabold text-ink">{i + 1}</span>
              <span className="min-w-0 break-words">{o}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const rangeLabel = ({ lo, hi }: { lo: number; hi: number }) => (lo === hi ? fmtValue(lo) : `${fmtValue(lo)}–${fmtValue(hi)}`);

/** Where the guesses landed on the scale: green stretches still scored, the gold ring holds the answer. */
function SliderChart({ q, spec }: { q: ReportQuestion; spec: SliderSpec }) {
  const ranges = sliderBinRanges(spec);
  const top = Math.max(1, ...q.counts);
  const { answer, margin, unit } = spec;
  const columns = { gridTemplateColumns: `repeat(${ranges.length}, minmax(0, 1fr))` };
  return (
    <div className="mt-3">
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold text-good">🎯 คำตอบ {fmtValue(answer, unit)}</span>
        <span className="text-slate-500">{margin > 0 ? `ห่างไม่เกิน ±${fmtValue(margin)} ยังได้คะแนน` : 'ต้องตรงเป๊ะถึงได้คะแนน'}</span>
        {q.average != null && <span className="text-slate-600">📊 ค่าเฉลี่ยที่ทาย {fmtValue(q.average, unit)}</span>}
      </p>
      <div className="mt-2 grid h-32 gap-1 pt-6" style={columns} role="img" aria-label={`จำนวนคนที่ทายแต่ละช่วง คำตอบ ${fmtValue(answer, unit)}`}>
        {ranges.map((r, b) => {
          const count = q.counts[b] ?? 0;
          const pct = count ? Math.max(6, (count / top) * 100) : 0;
          const scores = r.lo <= answer + margin && r.hi >= answer - margin;
          const holds = r.lo <= answer && answer <= r.hi;
          return (
            <div key={b} className="relative h-full" title={`${rangeLabel(r)}${unit ? ` ${unit}` : ''}: ${fmt(count)} คน`}>
              <div className={`absolute inset-x-0 bottom-0 h-1 rounded-full ${scores ? 'bg-good/40' : 'bg-slate-200'}`} />
              <div
                className={`absolute inset-x-0 bottom-0 rounded-t-lg ${scores ? 'bg-good' : 'bg-slate-300'} ${holds && count > 0 ? 'ring-3 ring-gold' : ''}`}
                style={{ height: `${pct}%` }}
              />
              {holds && (
                <span aria-hidden className="absolute -bottom-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-gold ring-2 ring-white" />
              )}
              {count > 0 && (
                <span className="absolute inset-x-0 mb-0.5 text-center text-xs font-bold tabular-nums text-slate-700" style={{ bottom: `${pct}%` }}>
                  {fmt(count)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 grid gap-1 text-center text-[11px] leading-tight text-slate-500 tabular-nums" style={columns}>
        {ranges.map((r, b) => (
          <span key={b} className="break-words">
            {rangeLabel(r)}
          </span>
        ))}
      </div>
    </div>
  );
}

function playerRows(players: ReportPlayer[]) {
  return [
    ['อันดับ', 'ชื่อเล่น', 'คะแนน', 'ตอบถูก', 'ข้อที่มีคำตอบถูก', 'ตอบทั้งหมด (รวมโหวต)', 'เวลาเฉลี่ย (วินาที)', 'ตอบถูกติดกันสูงสุด'],
    ...players.map((p) => [p.rank, p.nickname, p.score, p.correctCount, p.gradedCount, p.answeredCount, seconds(p.avgMs), p.bestStreak]),
  ];
}

function questionRows(questions: ReportQuestion[]) {
  return [
    ['ข้อ', 'ด่าน', 'ประเภท', 'คำถาม', 'ตัวเลือก 1', 'ตัวเลือก 2', 'ตัวเลือก 3', 'ตัวเลือก 4', 'คำตอบที่ถูก', 'จำนวนคนตอบ', 'ตอบถูก', '% ถูก', 'เวลาเฉลี่ย (วินาที)', 'ค่าเฉลี่ยที่ทาย'],
    ...questions.map((q) => {
      const poll = q.type === 'poll';
      // a puzzle's items have no counts: players order all of them, they don't pick one
      const options = [0, 1, 2, 3].map((i) =>
        q.options[i] === undefined ? null : q.type === 'puzzle' ? q.options[i] : `${q.options[i]} (${q.counts[i] ?? 0} คน)`,
      );
      return [
        q.number,
        q.roundTitle,
        TYPE_LABEL[q.type],
        q.prompt,
        ...options,
        poll ? null : rightAnswer(q),
        q.answered,
        poll ? null : q.correctCount,
        poll ? null : percent(q.correctCount, q.answered),
        poll ? null : seconds(q.avgMs),
        q.type === 'slider' ? (q.average ?? null) : null,
      ];
    }),
  ];
}

/** the right answer in one cell: the right tiles, a puzzle's order, every accepted spelling, or the number */
function rightAnswer(q: ReportQuestion): string {
  switch (q.type) {
    case 'puzzle':
      return q.options.join(' → ');
    case 'type':
      return q.options.join(' / ');
    case 'slider':
      return q.slider ? `${fmtValue(q.slider.answer, q.slider.unit)}${q.slider.margin > 0 ? ` (±${fmtValue(q.slider.margin)})` : ''}` : '';
    default:
      return q.correct.map((i) => q.options[i]).join(' / ');
  }
}
