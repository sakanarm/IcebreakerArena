'use client';

import { useEffect, useRef, useState } from 'react';
import { QUIZ_COUNTS, QUIZ_FOCUS_MAX, QUIZ_TEXT_MAX, QUIZ_TEXT_MIN, quizMessage, quizStatus, writeQuiz, type QuizLanguage, type QuizLevel, type QuizPaper } from '@/lib/ai-quiz';
import { ApiError } from '@/lib/api';
import { DOC_ACCEPT, readDocFile, tidyText } from '@/lib/doc-text';
import { WaitingDots } from '../motion-bits';

/** what the maker has typed so far: kept by the page, so going back from the preview keeps it */
export interface AiForm {
  text: string;
  /** the file's name, when the text came from one */
  name: string;
  count: number;
  level: QuizLevel;
  language: QuizLanguage;
  focus: string;
}

export const AI_FORM: AiForm = { text: '', name: '', count: 10, level: 'mixed', language: 'th', focus: '' };

const LEVELS: [QuizLevel, string, string][] = [
  ['easy', 'ง่าย', 'จำข้อเท็จจริง คำนิยาม ตัวเลขสำคัญ'],
  ['mixed', 'ผสม', 'มีทั้งจำ เข้าใจ และนำไปใช้'],
  ['hard', 'ยาก', 'สถานการณ์จริง เงื่อนไข ข้อยกเว้น'],
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** The "ให้ AI ออกข้อสอบ" tab: a document in, a checked paper out to the same preview a spreadsheet gets. */
export function AiPick({
  form,
  onForm,
  left,
  perDay,
  onWritten,
  onLeft,
}: {
  form: AiForm;
  onForm: (f: AiForm) => void;
  left: number;
  perDay: number;
  onWritten: (paper: QuizPaper, asked: number) => void;
  onLeft: (left: number) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [writing, setWriting] = useState<{ done: number; since: number } | null>(null);
  const [now, setNow] = useState(0);
  const stop = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // leaving the page stops the AI; the server is told and gives the paper back if nothing was written
  useEffect(() => () => stop.current?.abort(), []);
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [writing]);

  const set = (patch: Partial<AiForm>) => onForm({ ...form, ...patch });
  const text = tidyText(form.text);
  const length = text.length;
  const tooShort = length < QUIZ_TEXT_MIN;
  const tooLong = length > QUIZ_TEXT_MAX;

  const open = async (file: File) => {
    setError(null);
    setReading(true);
    const res = await readDocFile(file);
    setReading(false);
    if (!res.ok) return setError(res.error);
    onForm({ ...form, text: res.text, name: res.name });
  };

  const write = async () => {
    setError(null);
    const ctrl = new AbortController();
    stop.current = ctrl;
    const since = Date.now();
    setNow(since);
    setWriting({ done: 0, since });
    try {
      const paper = await writeQuiz(
        { text, name: form.name, count: form.count, level: form.level, language: form.language, focus: form.focus.trim() },
        (done) => setWriting((w) => (w ? { ...w, done } : w)),
        ctrl.signal,
      );
      if (typeof paper.left === 'number') onLeft(paper.left);
      onWritten(paper, form.count);
    } catch (e) {
      if (e instanceof ApiError && typeof e.data.left === 'number') onLeft(e.data.left);
      if (e instanceof ApiError && e.code === 'quiz_stopped') {
        // a stop hears nothing back; ask again once the server has settled it
        setTimeout(() => {
          void quizStatus().then((s) => {
            if (s.enabled && !s.needsLogin) onLeft(s.left);
          });
        }, 800);
      } else setError(quizMessage(e));
      setWriting(null);
    } finally {
      stop.current = null;
    }
  };

  if (writing) {
    const pct = Math.min(100, Math.max(4, (writing.done / form.count) * 100));
    return (
      <div className="grid gap-4 rounded-2xl bg-black/20 p-5 sm:p-6" data-testid="ai-writing" aria-live="polite">
        <div className="flex items-center gap-4">
          <span className="text-4xl motion-safe:animate-pulse" aria-hidden>
            ✨
          </span>
          <div className="min-w-0">
            <p className="text-lg font-bold">
              {writing.done === 0 ? 'AI กำลังอ่านเนื้อหาและวางโครงข้อสอบ' : `AI เขียนแล้ว ${Math.min(writing.done, form.count)} จาก ${form.count} ข้อ`} <WaitingDots />
            </p>
            <p className="text-sm text-white/60">มักใช้เวลา 1–3 นาที · ผ่านไป {mmss(Math.max(0, Math.round((now - writing.since) / 1000)))} · ปิดหน้านี้ระหว่างรอไม่ได้</p>
          </div>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={form.count} aria-valuenow={writing.done}>
          <div className="h-full rounded-full bg-gold transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <button type="button" onClick={() => stop.current?.abort()} className="btn btn-ghost px-4 text-base" data-testid="ai-stop">
            หยุด
          </button>
          <span className="text-sm text-white/50">ถ้า AI เริ่มอ่านแล้ว การหยุดนับเป็น 1 ครั้ง</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) void open(file);
        }}
        className={`grid gap-3 rounded-2xl border-2 border-dashed p-3 transition sm:p-4 ${over ? 'border-gold bg-gold/10' : 'border-white/20 bg-black/15'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="ai-text" className="font-semibold">
            เนื้อหาที่จะใช้ออกข้อสอบ
          </label>
          <button type="button" disabled={reading} onClick={() => input.current?.click()} className="btn btn-ghost px-4 text-base">
            {reading ? (
              <>
                กำลังอ่าน <WaitingDots />
              </>
            ) : (
              '📄 เปิดไฟล์ Word / PowerPoint'
            )}
          </button>
          <input
            ref={input}
            type="file"
            accept={DOC_ACCEPT}
            className="hidden"
            data-testid="ai-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void open(file);
            }}
          />
        </div>
        {form.name && (
          <p className="-mt-1 text-sm text-white/65">
            จากไฟล์ <b className="text-white/85">{form.name}</b>
          </p>
        )}
        <textarea
          id="ai-text"
          value={form.text}
          onChange={(e) => set({ text: e.target.value })}
          rows={10}
          placeholder="วางเนื้อหาที่นี่ เช่น คู่มือ นโยบาย สไลด์อบรม หรือบทความ หรือลากไฟล์ .docx .pptx .txt มาวาง · ไฟล์ PDF ให้เปิดแล้วคัดลอกข้อความมาวาง"
          className="field min-h-48 text-base leading-relaxed"
          data-testid="ai-text"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className={tooLong ? 'font-semibold text-rose-200' : 'text-white/55'} data-testid="ai-length">
            {length.toLocaleString('th-TH')} / {QUIZ_TEXT_MAX.toLocaleString('th-TH')} ตัวอักษร
            {length > 0 && tooShort && ` · ต้องมีอย่างน้อย ${QUIZ_TEXT_MIN}`}
          </span>
          {tooLong && (
            <button type="button" onClick={() => set({ text: text.slice(0, QUIZ_TEXT_MAX) })} className="font-semibold text-gold underline" data-testid="ai-trim">
              ใช้ {QUIZ_TEXT_MAX.toLocaleString('th-TH')} ตัวอักษรแรก
            </button>
          )}
          {!tooLong && form.text && (
            <button type="button" onClick={() => onForm({ ...form, text: '', name: '' })} className="text-white/55 underline hover:text-white">
              ล้าง
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-semibold">จำนวนข้อ</legend>
          <Segmented
            label="จำนวนข้อ"
            value={form.count}
            onChange={(count) => set({ count })}
            options={QUIZ_COUNTS.map((n) => [n, `${n} ข้อ`])}
            testId="ai-count"
          />
        </fieldset>
        <fieldset className="grid gap-2">
          <legend className="mb-2 font-semibold">ภาษาของข้อสอบ</legend>
          <Segmented
            label="ภาษาของข้อสอบ"
            value={form.language}
            onChange={(language) => set({ language })}
            options={[
              ['th', 'ภาษาไทย'],
              ['same', 'ตามภาษาเนื้อหา'],
            ]}
          />
        </fieldset>
        <fieldset className="grid gap-2 sm:col-span-2">
          <legend className="mb-2 font-semibold">ระดับความยาก</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="ระดับความยาก">
            {LEVELS.map(([key, name, hint]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={form.level === key}
                onClick={() => set({ level: key })}
                className={`rounded-2xl px-4 py-3 text-left transition ${form.level === key ? 'bg-white text-ink shadow' : 'bg-black/20 text-white/80 hover:bg-black/30'}`}
              >
                <span className="block font-bold">{name}</span>
                <span className={`block text-sm ${form.level === key ? 'text-slate-500' : 'text-white/55'}`}>{hint}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <label className="grid gap-2 sm:col-span-2">
          <span className="font-semibold">
            เน้นเรื่อง <span className="font-normal text-white/55">(ไม่บังคับ)</span>
          </span>
          <input
            value={form.focus}
            onChange={(e) => set({ focus: e.target.value })}
            maxLength={QUIZ_FOCUS_MAX}
            placeholder="เช่น ขั้นตอนเบิกค่าใช้จ่าย, บทที่ 3, ข้อห้ามด้านความปลอดภัย"
            className="field"
            data-testid="ai-focus"
          />
        </label>
      </div>

      <p className="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/65">
        🔒 เนื้อหาจะส่งให้ AI ที่บริษัทกำหนดไว้เพื่อออกข้อสอบเท่านั้น ระบบนี้ไม่เก็บเนื้อหาไว้ · ไม่ควรใส่ข้อมูลส่วนบุคคลหรือข้อมูลลับของลูกค้า · AI อาจผิดได้ ตรวจทุกข้อก่อนบันทึก
      </p>

      {error && (
        <p role="alert" className="rounded-xl bg-rose-500/20 px-4 py-3 text-rose-100" data-testid="ai-error">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button type="button" onClick={() => void write()} disabled={tooShort || tooLong || left <= 0} className="btn btn-gold" data-testid="ai-write">
          ✨ ให้ AI ออกข้อสอบ {form.count} ข้อ
        </button>
        <span className="text-sm text-white/60" data-testid="ai-left">
          {left > 0 ? `วันนี้ใช้ได้อีก ${left} จาก ${perDay} ครั้ง` : `วันนี้ใช้ครบ ${perDay} ครั้งแล้ว พรุ่งนี้ใช้ต่อได้`}
        </span>
      </div>
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1 rounded-2xl bg-black/25 p-1" data-testid={testId}>
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`flex-1 rounded-xl px-3 py-2 font-semibold whitespace-nowrap transition ${value === v ? 'bg-white text-ink shadow' : 'text-white/75 hover:text-white'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
