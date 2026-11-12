'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ExamQuestion } from '@pika-arena/shared';
import { AI_QUESTION_MAX, AI_TURNS, aiMessage, aiStatus, askAi, threads, type AiPaper, type AiStatus, type AiTurn } from '@/lib/exam-ai';
import { letter } from '@/lib/exam';

/**
 * "ถาม AI" under an answer: a short conversation about this one question. Shown only when the admin
 * has set AI up on the server and the paper is one the server can look up (not a game kept only in
 * this browser).
 */
export function AskAi({ paper, question, chosen }: { paper: AiPaper | null; question: ExamQuestion; chosen: number | null }) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const known = paper !== null;
  useEffect(() => {
    if (!known) return;
    let live = true;
    void aiStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [known]);
  if (!paper || !status?.enabled) return null;
  // a new question, or another answer to it, is a new conversation
  const key = `${paper.kind}:${paper.id}:${question.id}:${chosen ?? '-'}`;
  return <Thread key={key} threadKey={key} paper={paper} question={question} chosen={chosen} needsLogin={status.needsLogin} />;
}

function suggestions(q: ExamQuestion, chosen: number | null): string[] {
  const right = q.correct.map(letter).join(' หรือ ');
  const wrong = chosen !== null && !q.correct.includes(chosen);
  return [
    wrong ? `ทำไม ${letter(chosen)} ถึงผิด` : `ทำไมคำตอบคือ ${right}`,
    'อธิบายให้ง่ายกว่านี้หน่อย',
    'ขอตัวอย่างการใช้งานจริง',
  ];
}

function Thread({
  threadKey,
  paper,
  question,
  chosen,
  needsLogin,
}: {
  threadKey: string;
  paper: AiPaper;
  question: ExamQuestion;
  chosen: number | null;
  needsLogin: boolean;
}) {
  const [turns, setTurns] = useState<AiTurn[]>(() => threads.get(threadKey) ?? []);
  const [open, setOpen] = useState(turns.length > 0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState<number | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  useEffect(() => {
    threads.set(threadKey, turns);
  }, [threadKey, turns]);

  // opening the panel puts the cursor in the box; each new line keeps the latest in view
  useEffect(() => {
    if (open && !opened.current && !needsLogin) input.current?.focus({ preventScroll: true });
    opened.current = open;
  }, [open, needsLogin]);
  useEffect(() => {
    if (turns.length > 0 || busy) end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [turns.length, busy]);

  const asked = turns.filter((t) => t.role === 'user').length;
  const full = asked >= AI_TURNS;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || full || q.length > AI_QUESTION_MAX) return;
    const next: AiTurn[] = [...turns, { role: 'user', text: q }];
    setTurns(next);
    setDraft('');
    setError('');
    setBusy(true);
    try {
      const res = await askAi(paper, question.id, chosen, next);
      setTurns([...next, { role: 'assistant', text: res.reply }]);
      setLeft(res.left);
    } catch (e) {
      // the question goes back in the box, to send again
      setTurns(turns);
      setDraft(q);
      setError(aiMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="exam-btn mt-4 border-ex-accent/50 text-ex-accent" data-ask-ai>
        <span aria-hidden>✦</span> ถาม AI เพิ่มเติมเกี่ยวกับข้อนี้
      </button>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-ex-accent/35 bg-ex-raised" aria-label="ถาม AI เกี่ยวกับข้อนี้" data-ask-ai-panel>
      <div className="flex items-center justify-between gap-2 border-b border-ex-line px-4 py-2.5">
        <p className="font-semibold text-ex-accent">
          <span aria-hidden>✦</span> ถาม AI
        </p>
        <button type="button" onClick={() => setOpen(false)} className="exam-btn exam-btn-quiet -mr-2 min-h-9 px-2 text-sm">
          ซ่อน
        </button>
      </div>

      {/* minmax(0, 1fr): a long word in the box (which grows with what is typed) wraps instead of widening the page */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3">
        <p className="text-xs leading-relaxed text-ex-soft">คำตอบจาก AI ช่วยให้เข้าใจเนื้อหา แต่อาจผิดพลาดได้ ถ้าไม่แน่ใจ ตรวจกับเอกสารต้นทางอีกครั้ง</p>

        {turns.length > 0 && (
          <ol className="grid gap-3" aria-live="polite">
            {turns.map((t, i) => (
              <li key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
                {t.role === 'user' ? (
                  <p className="max-w-[85%] rounded-xl rounded-br-sm bg-brand/30 px-3 py-2 exam-light:bg-ex-accent/[0.12] leading-relaxed wrap-anywhere whitespace-pre-line text-ex-fg">
                    <span className="sr-only">คุณถาม: </span>
                    {t.text}
                  </p>
                ) : (
                  <div className="rounded-xl rounded-tl-sm border border-ex-line bg-ex-card px-3 py-2.5" data-ai-reply>
                    <p className="text-xs font-semibold text-ex-accent">AI</p>
                    <p className="mt-1 leading-relaxed wrap-anywhere whitespace-pre-line text-ex-fg">{t.text}</p>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-ex-soft" role="status">
            <span className="inline-block size-2 animate-pulse rounded-full bg-ex-cue" aria-hidden /> AI กำลังคิด…
          </p>
        )}
        {error && (
          <p className="rounded-xl bg-ex-bad/12 px-3 py-2 text-sm text-ex-bad" role="alert">
            {error}
          </p>
        )}
        <div ref={end} />

        {needsLogin ? (
          <p className="text-sm leading-relaxed text-ex-muted">
            ต้องเข้าสู่ระบบก่อนจึงจะถาม AI ได้{' '}
            <Link href={`/login?next=${encodeURIComponent(`/exam/${paper.id}`)}`} className="font-semibold text-ex-accent underline">
              เข้าสู่ระบบ
            </Link>
          </p>
        ) : full ? (
          <p className="text-sm text-ex-muted">ถามเรื่องข้อนี้ครบ {AI_TURNS} คำถามแล้ว ถ้ายังสงสัย ลองไปข้อถัดไปแล้วกลับมาถามใหม่ได้</p>
        ) : (
          <>
            {turns.length === 0 && !busy && (
              <div className="flex flex-wrap gap-2" role="group" aria-label="คำถามตัวอย่าง">
                {suggestions(question, chosen).map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="exam-btn min-h-9 rounded-full px-3 text-sm font-normal">
                    {s}
                  </button>
                ))}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
            >
              <label className="min-w-0 flex-1">
                <span className="sr-only">พิมพ์คำถามถึง AI</span>
                <textarea
                  ref={input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                  rows={1}
                  maxLength={AI_QUESTION_MAX}
                  placeholder={turns.length === 0 ? 'พิมพ์สิ่งที่ยังสงสัยเกี่ยวกับข้อนี้' : 'ถามต่อ'}
                  className="exam-field field-sizing-content block max-h-40 min-h-11 w-full resize-none px-3 py-2.5 leading-relaxed"
                />
              </label>
              <button type="submit" disabled={busy || !draft.trim()} className="exam-btn exam-btn-primary shrink-0">
                ส่ง
              </button>
            </form>
            {left !== null && <p className="text-xs text-ex-soft">วันนี้ถาม AI ได้อีก {left} ครั้ง</p>}
          </>
        )}
      </div>
    </section>
  );
}
