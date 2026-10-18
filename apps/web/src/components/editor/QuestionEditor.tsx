'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { LIMITS, TIME_CHOICES_S, type Question, type QuestionMultiplier, type QuestionType, type Round } from '@icebreaker/shared';
import { roundLabel, TYPE_LABEL } from '@/lib/format';
import { newId } from '@/lib/games';
import { ANSWER_BG, ANSWER_NAMES, AnswerShape } from '../shapes';
import { retype, type Edit, type Selection } from './model';
import { Counter, FieldLabel, IconButton, Issues, Segmented } from './ui';

const TYPES: QuestionType[] = ['quiz', 'truefalse', 'poll'];

const HINTS: Record<QuestionType, string> = {
  quiz: 'แตะ ✓ ที่คำตอบที่ถูก (ถูกได้มากกว่า 1 ข้อ) · ช่องที่ 3–4 เว้นว่างได้ถ้าไม่ใช้',
  truefalse: 'แตะ ✓ ที่คำตอบที่ถูก',
  poll: 'โพลไม่มีคำตอบผิด: ทุกคนที่โหวตได้แต้มเท่ากัน แล้วดูผลโหวตบนจอใหญ่',
};

const timeLabel = (s: number) => (s >= 60 ? `${s / 60} นาที` : `${s} วินาที`);

export function QuestionEditor({
  question: q,
  round,
  ri,
  qi,
  issues,
  edit,
  onSelect,
}: {
  question: Question;
  round: Round;
  ri: number;
  qi: number;
  issues: string[];
  edit: Edit;
  onSelect: (sel: Selection) => void;
}) {
  const count = round.questions.length;
  const set = (mutate: (q: Question) => void) => edit((d) => mutate(d.rounds[ri].questions[qi]));
  const choiceType = q.type !== 'truefalse';

  const toggleCorrect = (i: number) =>
    set((x) => {
      if (x.type === 'truefalse') x.correct = [i];
      else x.correct = x.correct.includes(i) ? x.correct.filter((c) => c !== i) : [...x.correct, i].sort((a, b) => a - b);
    });

  const removeOption = (i: number) =>
    set((x) => {
      x.options.splice(i, 1);
      x.correct = x.correct.filter((c) => c !== i).map((c) => (c > i ? c - 1 : c));
    });

  const move = (to: number) =>
    edit((d) => {
      const list = d.rounds[ri].questions;
      [list[qi], list[to]] = [list[to], list[qi]];
    });

  const duplicate = () => {
    const copy: Question = { ...structuredClone(q), id: newId('q') };
    edit((d) => void d.rounds[ri].questions.splice(qi + 1, 0, copy));
    onSelect({ kind: 'question', id: copy.id });
  };

  const remove = () => {
    if (q.prompt.trim() && !confirm('ลบคำถามนี้ใช่ไหม?')) return;
    const next = round.questions[qi + 1] ?? round.questions[qi - 1];
    edit((d) => void d.rounds[ri].questions.splice(qi, 1));
    onSelect(next ? { kind: 'question', id: next.id } : { kind: 'round', id: round.id });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-white/60">{roundLabel(ri, round.title, ' · ')}</p>
          <h2 className="text-2xl font-extrabold">
            ข้อ {qi + 1} <span className="text-base font-normal text-white/60">จาก {count}</span>
          </h2>
        </div>
        <div className="flex gap-2 rounded-2xl bg-white p-1.5">
          <IconButton label="เลื่อนขึ้น" onClick={() => move(qi - 1)} disabled={qi === 0}>
            ↑
          </IconButton>
          <IconButton label="เลื่อนลง" onClick={() => move(qi + 1)} disabled={qi === count - 1}>
            ↓
          </IconButton>
          <IconButton label="ทำสำเนาคำถาม" onClick={duplicate}>
            ⧉
          </IconButton>
          <IconButton label={count === 1 ? 'ด่านต้องมีอย่างน้อย 1 ข้อ' : 'ลบคำถาม'} onClick={remove} disabled={count === 1} danger>
            🗑
          </IconButton>
        </div>
      </div>

      <div className="card mt-4 p-5 md:p-7">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="ประเภทคำถาม"
            value={q.type}
            options={TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
            onChange={(t) => edit((d) => void (d.rounds[ri].questions[qi] = retype(d.rounds[ri].questions[qi], t)))}
          />
          <label className="flex items-center gap-2 rounded-2xl bg-slate-100 py-1 pr-1 pl-3 text-sm font-semibold">
            ⏱️
            <select
              value={q.timeLimitS}
              onChange={(e) => set((x) => void (x.timeLimitS = Number(e.target.value)))}
              className="rounded-xl bg-white px-2 py-1.5 outline-none"
              aria-label="เวลาตอบ"
            >
              {TIME_CHOICES_S.map((s) => (
                <option key={s} value={s}>
                  {timeLabel(s)}
                </option>
              ))}
              {!(TIME_CHOICES_S as readonly number[]).includes(q.timeLimitS) && <option value={q.timeLimitS}>{timeLabel(q.timeLimitS)}</option>}
            </select>
          </label>
          <Segmented<QuestionMultiplier>
            label="คะแนน"
            value={q.multiplier ?? 1}
            options={[
              { value: 0, label: 'ไม่คิดแต้ม', title: 'ข้อนี้เล่นสนุก ไม่นับคะแนน' },
              { value: 1, label: 'ปกติ' },
              { value: 2, label: 'แต้ม ×2', title: 'ข้อนี้ได้คะแนนสองเท่า' },
            ]}
            onChange={(m) => set((x) => void (x.multiplier = m))}
          />
        </div>

        <div className="mt-5">
          <FieldLabel htmlFor={`prompt-${q.id}`} extra={<Counter length={q.prompt.length} max={LIMITS.promptMax} />}>
            คำถาม
          </FieldLabel>
          <textarea
            id={`prompt-${q.id}`}
            value={q.prompt}
            onChange={(e) => set((x) => void (x.prompt = e.target.value))}
            maxLength={LIMITS.promptMax}
            rows={2}
            placeholder="พิมพ์คำถามที่นี่ เช่น ใครในทีมเคยไปเที่ยวต่างประเทศมากที่สุด?"
            className="field resize-none text-center font-display text-xl font-semibold md:text-2xl"
          />
        </div>

        <ImageField
          question={q}
          onChange={(url) =>
            set((x) => {
              if (url) x.imageUrl = url;
              else delete x.imageUrl;
            })
          }
        />

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AnimatePresence initial={false}>
            {q.options.map((text, i) => (
              <OptionTile
                key={i}
                index={i}
                text={text}
                correct={q.correct.includes(i)}
                showCorrect={q.type !== 'poll'}
                editable={choiceType}
                required={i < 2 || q.correct.includes(i)}
                removable={choiceType && q.options.length > 2}
                onText={(t) => set((x) => void (x.options[i] = t))}
                onToggle={() => toggleCorrect(i)}
                onRemove={() => removeOption(i)}
              />
            ))}
          </AnimatePresence>
          {choiceType && q.options.length < 4 && (
            <motion.button
              layout
              type="button"
              onClick={() => set((x) => void x.options.push(''))}
              className="min-h-20 rounded-2xl border-2 border-dashed border-slate-300 font-semibold text-slate-500 transition-colors hover:border-brand hover:text-brand"
            >
              ＋ เพิ่มตัวเลือก
            </motion.button>
          )}
        </div>
        <p className="mt-3 text-sm text-slate-500">{HINTS[q.type]}</p>
        <Issues items={issues} />
      </div>
    </div>
  );
}

function OptionTile({
  index,
  text,
  correct,
  showCorrect,
  editable,
  required,
  removable,
  onText,
  onToggle,
  onRemove,
}: {
  index: number;
  text: string;
  correct: boolean;
  showCorrect: boolean;
  editable: boolean;
  required: boolean;
  removable: boolean;
  onText: (text: string) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <motion.div
      layout
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={`flex min-h-20 items-center gap-3 rounded-2xl p-3 text-white shadow-[inset_0_-6px_0_rgb(0_0_0/0.2)] ${ANSWER_BG[index]}`}
    >
      <AnswerShape index={index} className="size-9 shrink-0 drop-shadow" />
      {editable ? (
        <input
          value={text}
          onChange={(e) => onText(e.target.value)}
          maxLength={LIMITS.optionMax}
          placeholder={required ? `ตัวเลือก ${index + 1}` : `ตัวเลือก ${index + 1} (ไม่บังคับ)`}
          aria-label={`ตัวเลือก ${index + 1} (${ANSWER_NAMES[index]})`}
          className="w-full min-w-0 flex-1 rounded-xl bg-white/15 px-3 py-2 text-lg font-semibold outline-none placeholder:font-normal placeholder:text-white/70 focus:bg-white/25"
        />
      ) : (
        <span className="flex-1 text-lg font-semibold">{text}</span>
      )}
      {showCorrect && (
        <motion.button
          type="button"
          role="checkbox"
          aria-checked={correct}
          aria-label={`ตัวเลือก ${index + 1} เป็นคำตอบที่ถูก`}
          onClick={onToggle}
          whileTap={{ scale: 0.85 }}
          className={`grid size-10 shrink-0 place-items-center rounded-full border-4 border-white text-xl font-extrabold transition-colors ${correct ? 'bg-good' : 'bg-black/10'}`}
        >
          <AnimatePresence>
            {correct && (
              <motion.span initial={{ scale: 0, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 20 }}>
                ✓
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      )}
      {removable && (
        <button type="button" onClick={onRemove} aria-label={`ลบตัวเลือก ${index + 1}`} className="grid size-8 shrink-0 place-items-center rounded-full text-white/80 hover:bg-black/15">
          ✕
        </button>
      )}
    </motion.div>
  );
}

/** Optional picture above the question: only https links, previewed right here. */
function ImageField({ question: q, onChange }: { question: Question; onChange: (url: string) => void }) {
  const [open, setOpen] = useState(!!q.imageUrl);
  const [broken, setBroken] = useState<string | null>(null);
  const url = q.imageUrl ?? '';
  const valid = /^https:\/\/\S+$/.test(url);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 text-sm font-semibold text-brand hover:underline">
        🖼️ เพิ่มรูปประกอบ (ไม่บังคับ)
      </button>
    );
  }
  return (
    <div className="mt-4">
      <FieldLabel htmlFor={`img-${q.id}`}>ลิงก์รูปประกอบ</FieldLabel>
      <div className="flex gap-2">
        <input
          id={`img-${q.id}`}
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => onChange(e.target.value.trim())}
          placeholder="https://… (ไม่บังคับ)"
          className="field"
        />
        <button
          type="button"
          onClick={() => {
            onChange('');
            setOpen(false);
          }}
          className="btn bg-slate-100 px-4 text-base text-ink"
        >
          เอาออก
        </button>
      </div>
      {valid && broken !== url && (
        <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(url)} className="mt-3 max-h-48 rounded-2xl object-contain" />
      )}
      {valid && broken === url && <p className="mt-2 text-sm text-bad">โหลดรูปจากลิงก์นี้ไม่ได้ ลองตรวจลิงก์อีกครั้ง</p>}
    </div>
  );
}
