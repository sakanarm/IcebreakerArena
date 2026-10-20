'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useId, useState } from 'react';
import {
  LIMITS,
  OPTION_COUNT,
  QUESTION_TYPES,
  TIME_CHOICES_S,
  hasCorrectTiles,
  onScale,
  sliderStart,
  type Question,
  type QuestionMultiplier,
  type QuestionType,
  type Round,
  type SliderSpec,
} from '@icebreaker/shared';
import { fmt, fmtValue, roundLabel, TYPE_ICON, TYPE_LABEL } from '@/lib/format';
import { newId } from '@/lib/games';
import { ANSWER_BG, ANSWER_NAMES, AnswerShape } from '../shapes';
import { retype, type Edit, type Selection } from './model';
import { Counter, FieldLabel, IconButton, Issues, Segmented } from './ui';

const BLURB: Record<QuestionType, string> = {
  quiz: 'เลือกคำตอบที่ถูก',
  truefalse: 'ถูกหรือผิด',
  poll: 'โหวตความเห็น',
  puzzle: 'เรียงให้ถูกลำดับ',
  type: 'พิมพ์คำตอบเอง',
  slider: 'เลื่อนทายตัวเลข',
};

const HINTS: Record<QuestionType, string> = {
  quiz: 'แตะ ✓ ที่คำตอบที่ถูก (ถูกได้มากกว่า 1 ข้อ) · ช่องที่ 3–4 เว้นว่างได้ถ้าไม่ใช้',
  truefalse: 'แตะ ✓ ที่คำตอบที่ถูก',
  poll: 'โพลไม่มีคำตอบผิด: ทุกคนที่โหวตได้แต้มเท่ากัน แล้วดูผลโหวตบนจอใหญ่',
  puzzle: 'ใส่รายการตามลำดับที่ถูกจากบนลงล่าง · มือถือผู้เล่นจะเห็นรายการสลับที่ ต้องเรียงถูกทั้งหมดถึงได้คะแนน · ช่องที่ 4 เว้นว่างได้',
  type: 'ไม่สนตัวพิมพ์เล็ก/ใหญ่ ช่องว่าง และเครื่องหมาย (“Tom-Yum” ตรงกับ “tomyum”) · คำสะกดอื่นที่ใส่ไว้ก็นับว่าถูก',
  slider: 'ผู้เล่นเลื่อนเลือกตัวเลข ตรงเป๊ะได้เต็ม ห่างไม่เกินระยะได้คะแนนก็ยังได้แต้มลดหลั่นลงไป',
};

const timeLabel = (s: number) => (s >= 60 ? `${s / 60} นาที` : `${s} วินาที`);

/** changes this question in place (on the editor's copy of the game) */
type Change = (mutate: (q: Question) => void) => void;

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
  const set: Change = (mutate) => edit((d) => mutate(d.rounds[ri].questions[qi]));
  const editable = q.type !== 'truefalse';
  const limits = OPTION_COUNT[q.type];

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

  /** a puzzle's items swap places; nothing is marked correct on them, the order is the answer */
  const moveOption = (i: number, to: number) =>
    set((x) => {
      [x.options[i], x.options[to]] = [x.options[to], x.options[i]];
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
        <TypePicker value={q.type} onChange={(t) => edit((d) => void (d.rounds[ri].questions[qi] = retype(d.rounds[ri].questions[qi], t)))} />

        <div className="mt-4 flex flex-wrap items-center gap-3">
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
            placeholder={PROMPT_EXAMPLE[q.type]}
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

        {q.type === 'slider' ? (
          <SliderFields question={q} set={set} />
        ) : q.type === 'type' ? (
          <TypedAnswers question={q} set={set} onRemove={removeOption} />
        ) : (
          <div className={`mt-5 grid grid-cols-1 gap-3 ${q.type === 'puzzle' ? '' : 'sm:grid-cols-2'}`}>
            <AnimatePresence initial={false}>
              {q.options.map((text, i) => (
                <OptionTile
                  key={i}
                  index={i}
                  text={text}
                  ordered={q.type === 'puzzle'}
                  last={i === q.options.length - 1}
                  correct={q.correct.includes(i)}
                  showCorrect={hasCorrectTiles(q.type)}
                  editable={editable}
                  required={i < limits.min || q.correct.includes(i)}
                  removable={editable && q.options.length > limits.min}
                  onText={(t) => set((x) => void (x.options[i] = t))}
                  onToggle={() => toggleCorrect(i)}
                  onRemove={() => removeOption(i)}
                  onMove={q.type === 'puzzle' ? (to) => moveOption(i, to) : undefined}
                />
              ))}
            </AnimatePresence>
            {editable && q.options.length < limits.max && (
              <AddButton onClick={() => set((x) => void x.options.push(''))} className="min-h-20">
                {q.type === 'puzzle' ? '＋ เพิ่มรายการ' : '＋ เพิ่มตัวเลือก'}
              </AddButton>
            )}
          </div>
        )}
        <p className="mt-3 text-sm text-slate-500">{HINTS[q.type]}</p>
        <Issues items={issues} />
      </div>
    </div>
  );
}

const PROMPT_EXAMPLE: Record<QuestionType, string> = {
  quiz: 'พิมพ์คำถามที่นี่ เช่น ใครในทีมเคยไปเที่ยวต่างประเทศมากที่สุด?',
  truefalse: 'พิมพ์ข้อความให้ทาย เช่น ออฟฟิศเรามีแมวประจำออฟฟิศ',
  poll: 'พิมพ์คำถามโหวต เช่น มื้อเที่ยงวันนี้กินอะไรดี?',
  puzzle: 'พิมพ์คำถาม เช่น เรียงดาวเคราะห์จากใกล้ดวงอาทิตย์ไปไกล',
  type: 'พิมพ์คำถาม เช่น 🍜🦐🌶️ คืออาหารอะไร?',
  slider: 'พิมพ์คำถาม เช่น iPhone รุ่นแรกเปิดตัวปี ค.ศ. ไหน?',
};

/** Six cards to pick the question type: icon, name, and what players do. */
function TypePicker({ value, onChange }: { value: QuestionType; onChange: (t: QuestionType) => void }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label="ประเภทคำถาม" className="grid grid-cols-3 gap-2 lg:grid-cols-6">
      {QUESTION_TYPES.map((t) => {
        const on = t === value;
        return (
          <motion.button
            key={t}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={TYPE_LABEL[t]}
            title={BLURB[t]}
            onClick={() => onChange(t)}
            whileTap={{ scale: 0.94 }}
            className={`relative flex flex-col items-center gap-0.5 rounded-2xl px-1.5 pt-2 pb-2.5 text-center transition-colors ${on ? 'text-white' : 'bg-slate-100 text-ink hover:bg-slate-200'}`}
          >
            {on && (
              <motion.span
                layoutId={`type-${id}`}
                className="absolute inset-0 rounded-2xl bg-ink shadow-[inset_0_-4px_0_rgb(0_0_0/0.35)]"
                transition={{ type: 'spring', stiffness: 500, damping: 35 }}
              />
            )}
            <motion.span
              aria-hidden
              animate={on ? { scale: [1, 1.35, 1], rotate: [0, -10, 0] } : { scale: 1, rotate: 0 }}
              transition={{ duration: 0.35 }}
              className="relative text-2xl"
            >
              {TYPE_ICON[t]}
            </motion.span>
            <span className="relative text-sm leading-tight font-semibold">{TYPE_LABEL[t]}</span>
            <span aria-hidden className={`relative text-[11px] leading-tight ${on ? 'text-white/70' : 'text-slate-500'}`}>
              {BLURB[t]}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

function AddButton({ onClick, className = '', children }: { onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <motion.button
      layout
      type="button"
      onClick={onClick}
      className={`rounded-2xl border-2 border-dashed border-slate-300 font-semibold text-slate-500 transition-colors hover:border-brand hover:text-brand ${className}`}
    >
      {children}
    </motion.button>
  );
}

function OptionTile({
  index,
  text,
  ordered,
  last,
  correct,
  showCorrect,
  editable,
  required,
  removable,
  onText,
  onToggle,
  onRemove,
  onMove,
}: {
  index: number;
  text: string;
  /** a puzzle item: numbered, and moved up or down instead of marked correct */
  ordered: boolean;
  last: boolean;
  correct: boolean;
  showCorrect: boolean;
  editable: boolean;
  required: boolean;
  removable: boolean;
  onText: (text: string) => void;
  onToggle: () => void;
  onRemove: () => void;
  onMove?: (to: number) => void;
}) {
  const name = ordered ? 'ลำดับที่' : 'ตัวเลือก';
  return (
    <motion.div
      layout
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.8, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={`flex items-center gap-3 rounded-2xl p-3 text-white shadow-[inset_0_-6px_0_rgb(0_0_0/0.2)] ${ordered ? 'min-h-16' : 'min-h-20'} ${ANSWER_BG[index]}`}
    >
      {ordered ? (
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-white font-display text-lg font-extrabold text-ink shadow">
          {index + 1}
        </span>
      ) : (
        <AnswerShape index={index} className="size-9 shrink-0 drop-shadow" />
      )}
      {editable ? (
        <input
          value={text}
          onChange={(e) => onText(e.target.value)}
          maxLength={LIMITS.optionMax}
          placeholder={required ? `${name} ${index + 1}` : `${name} ${index + 1} (ไม่บังคับ)`}
          aria-label={ordered ? `ลำดับที่ ${index + 1}` : `ตัวเลือก ${index + 1} (${ANSWER_NAMES[index]})`}
          className="w-full min-w-0 flex-1 rounded-xl bg-white/15 px-3 py-2 text-lg font-semibold outline-none placeholder:font-normal placeholder:text-white/70 focus:bg-white/25"
        />
      ) : (
        <span className="flex-1 text-lg font-semibold">{text}</span>
      )}
      {onMove && (
        <span className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => onMove(index - 1)}
            disabled={index === 0}
            aria-label={`เลื่อนลำดับที่ ${index + 1} ขึ้น`}
            className="grid h-6 w-8 place-items-center rounded-lg text-xs text-white/90 hover:bg-black/15 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => onMove(index + 1)}
            disabled={last}
            aria-label={`เลื่อนลำดับที่ ${index + 1} ลง`}
            className="grid h-6 w-8 place-items-center rounded-lg text-xs text-white/90 hover:bg-black/15 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            ▼
          </button>
        </span>
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
        <button type="button" onClick={onRemove} aria-label={`ลบ${name} ${index + 1}`} className="grid size-8 shrink-0 place-items-center rounded-full text-white/80 hover:bg-black/15">
          ✕
        </button>
      )}
    </motion.div>
  );
}

/** A typed question's right answers: the first shows on the big screen, the others are spellings that also count. */
function TypedAnswers({ question: q, set, onRemove }: { question: Question; set: Change; onRemove: (i: number) => void }) {
  const { min, max } = OPTION_COUNT.type;
  return (
    <div className="mt-5 flex flex-col gap-2.5">
      <AnimatePresence initial={false}>
        {q.options.map((text, i) => {
          const main = i === 0;
          const name = main ? 'คำตอบที่ถูก' : `คำสะกดอื่นที่ถือว่าถูก ${i}`;
          return (
            <motion.div
              key={i}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              className={`flex items-center gap-3 rounded-2xl p-3 ${main ? 'bg-good text-white shadow-[inset_0_-6px_0_rgb(0_0_0/0.18)]' : 'bg-slate-100 text-ink'}`}
            >
              <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-full text-xl ${main ? 'bg-white/20' : 'bg-white'}`}>
                {main ? '⌨️' : '＝'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-xs font-semibold ${main ? 'text-white/85' : 'text-slate-500'}`}>
                    {main ? 'คำตอบที่ถูก · โชว์บนจอใหญ่ตอนเฉลย' : name}
                  </span>
                  <span className={main ? 'opacity-80 [&>span]:text-white' : ''}>
                    <Counter length={text.length} max={LIMITS.typedMax} />
                  </span>
                </div>
                <input
                  value={text}
                  onChange={(e) => {
                    const t = e.target.value;
                    set((x) => void (x.options[i] = t));
                  }}
                  maxLength={LIMITS.typedMax}
                  placeholder={main ? 'เช่น ต้มยำกุ้ง' : 'เช่น tom yum (ไม่บังคับ)'}
                  aria-label={name}
                  className={`mt-1 w-full rounded-xl px-3 py-2 text-lg font-semibold outline-none ${
                    main
                      ? 'bg-white/15 placeholder:font-normal placeholder:text-white/70 focus:bg-white/25'
                      : 'bg-white ring-1 ring-slate-200 placeholder:font-normal placeholder:text-slate-400 focus:ring-2 focus:ring-brand'
                  }`}
                />
              </div>
              {q.options.length > min && (
                <button
                  type="button"
                  onClick={() => onRemove(i)}
                  aria-label={`ลบ${name}`}
                  className={`grid size-8 shrink-0 place-items-center rounded-full ${main ? 'text-white/80 hover:bg-black/15' : 'text-slate-500 hover:bg-slate-200'}`}
                >
                  ✕
                </button>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
      {q.options.length < max && (
        <AddButton onClick={() => set((x) => void x.options.push(''))} className="min-h-14">
          ＋ เพิ่มคำสะกดอื่นที่ถือว่าถูก
        </AddButton>
      )}
    </div>
  );
}

const BLANK_SLIDER: SliderSpec = { min: NaN, max: NaN, step: NaN, answer: NaN, margin: NaN };

/** A slider question's numbers, and the scale as the phone will show it. */
function SliderFields({ question: q, set }: { question: Question; set: Change }) {
  const s = q.slider ?? BLANK_SLIDER;
  const put = (patch: Partial<SliderSpec>) =>
    set((x) => {
      const next: SliderSpec = { ...(x.slider ?? BLANK_SLIDER), ...patch };
      if (!next.unit) delete next.unit;
      x.slider = next;
    });
  const id = (k: string) => `slider-${k}-${q.id}`;

  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <NumberField id={id('min')} label="ค่าน้อยสุด" value={s.min} onChange={(min) => put({ min })} />
        <NumberField id={id('max')} label="ค่ามากสุด" value={s.max} onChange={(max) => put({ max })} />
        <NumberField id={id('step')} label="เลื่อนทีละ" value={s.step} onChange={(step) => put({ step })} />
        <NumberField id={id('answer')} label="คำตอบที่ถูก" value={s.answer} onChange={(answer) => put({ answer })} strong />
        <NumberField id={id('margin')} label="ระยะได้คะแนน ±" value={s.margin} onChange={(margin) => put({ margin })} />
        <div>
          <FieldLabel htmlFor={id('unit')}>หน่วย</FieldLabel>
          <input
            id={id('unit')}
            value={s.unit ?? ''}
            onChange={(e) => put({ unit: e.target.value })}
            maxLength={LIMITS.unitMax}
            placeholder="ไม่บังคับ เช่น ปี"
            className="field text-lg"
          />
        </div>
      </div>
      <SliderPreview spec={s} />
    </div>
  );
}

/** whole numbers only; thousands commas and spaces are fine to type */
function parseWhole(text: string) {
  const t = text.replace(/[\s,]/g, '');
  return /^-?\d+$/.test(t) ? Number(t) : NaN;
}

/**
 * A number box that can hold half-typed text ("", "-") while the question keeps NaN, which the
 * game check reports. Undo and switching type change the value from outside, and the text follows.
 */
function NumberField({ id, label, value, onChange, strong }: { id: string; label: string; value: number; onChange: (n: number) => void; strong?: boolean }) {
  const shown = Number.isFinite(value) ? String(value) : '';
  const [text, setText] = useState(shown);
  const [seen, setSeen] = useState(value);
  if (!Object.is(seen, value)) {
    setSeen(value);
    setText(shown);
  }
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          const n = parseWhole(t);
          setText(t);
          setSeen(n);
          onChange(n);
        }}
        className={`field text-lg font-semibold tabular-nums ${strong ? 'border-good bg-good/5' : ''}`}
      />
    </div>
  );
}

/** the same checks as the game check, so the preview shows only a scale that can be played */
function playable(s: SliderSpec) {
  const nums = [s.min, s.max, s.step, s.answer, s.margin];
  if (!nums.every((n) => Number.isInteger(n) && Math.abs(n) <= LIMITS.sliderAbs)) return false;
  if (s.max <= s.min || s.step < 1 || s.margin < 0) return false;
  const span = s.max - s.min;
  return span % s.step === 0 && span / s.step <= LIMITS.sliderSteps && onScale(s, s.answer);
}

/** The scale as players will see it: where the answer sits and how far off still scores. */
function SliderPreview({ spec: s }: { spec: SliderSpec }) {
  if (!playable(s)) {
    return (
      <p className="mt-5 rounded-2xl bg-slate-100 px-4 py-6 text-center text-sm text-slate-500">
        🎚️ ใส่ตัวเลขให้ครบและถูกต้อง แล้วจะเห็นตัวอย่างสไลเดอร์ตรงนี้
      </p>
    );
  }
  const at = (v: number) => ((Math.min(s.max, Math.max(s.min, v)) - s.min) / (s.max - s.min)) * 100;
  const lo = at(s.answer - s.margin);
  const hi = at(s.answer + s.margin);
  const a = at(s.answer);
  const values = (s.max - s.min) / s.step + 1;

  return (
    <div className="arena-bg mt-5 overflow-hidden rounded-2xl px-5 pt-4 pb-5 text-white">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display font-semibold">ตัวอย่างสเกล</p>
        <p className="text-xs text-white/65">ผู้เล่นเลือกได้ {fmt(values)} ค่า</p>
      </div>
      <div className="relative mt-12 h-4 rounded-full bg-white/20">
        <motion.div
          className="absolute inset-y-0 rounded-full bg-good/80"
          initial={false}
          animate={{ left: `${lo}%`, width: `${hi - lo}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        />
        <motion.div
          className="absolute top-1/2 size-7 rounded-full border-[5px] border-gold bg-white shadow-lg"
          style={{ translate: '-50% -50%' }}
          initial={false}
          animate={{ left: `${a}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        />
        <motion.span
          className="absolute bottom-full mb-2.5 rounded-full bg-gold px-3 py-0.5 font-display font-extrabold whitespace-nowrap text-ink tabular-nums shadow"
          style={{ translate: `-${Math.min(90, Math.max(10, a))}% 0` }}
          initial={false}
          animate={{ left: `${a}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        >
          {fmtValue(s.answer, s.unit)}
        </motion.span>
      </div>
      <div className="mt-2 flex justify-between text-xs text-white/65 tabular-nums">
        <span>{fmtValue(s.min, s.unit)}</span>
        <span>{fmtValue(s.max, s.unit)}</span>
      </div>
      <p className="mt-3 text-sm text-white/90">
        {s.margin === 0
          ? '🎯 ต้องตอบตรงเป๊ะเท่านั้นถึงได้คะแนน'
          : `🎯 ตรงเป๊ะได้เต็ม · ห่าง ±${fmtValue(s.margin)} ได้ครึ่งหนึ่ง · ไกลกว่านั้นได้ 0`}
      </p>
      {s.answer === sliderStart(s) && (
        <p className="mt-2 rounded-xl bg-gold/20 px-3 py-2 text-sm font-semibold text-gold">
          ⚠️ คำตอบอยู่กลางสเกลพอดี ซึ่งเป็นจุดที่สไลเดอร์เริ่ม ลองปรับช่วงให้คำตอบไม่อยู่ตรงกลาง จะได้ไม่ใบ้
        </p>
      )}
    </div>
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
      {/* no maxLength: a pasted link that is too long would be cut silently into a broken one */}
      {url.length > LIMITS.imageUrlMax && (
        <p role="alert" className="mt-2 text-sm font-semibold text-bad">
          ลิงก์ยาว {url.length.toLocaleString()} ตัวอักษร เกิน {LIMITS.imageUrlMax.toLocaleString()} ที่บันทึกได้ ใช้ลิงก์ที่สั้นกว่านี้ (เช่น ลิงก์รูปจากเว็บโดยตรง ไม่ใช่รูปที่ฝังเป็นข้อความ)
        </p>
      )}
    </div>
  );
}
