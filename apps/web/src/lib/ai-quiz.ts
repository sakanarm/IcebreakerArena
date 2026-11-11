import type { Round } from '@pika-arena/shared';
import { ApiError, api, apiMessage, mutationHeaders } from './api';
import { withBase } from './paths';

/**
 * "ให้ AI ออกข้อสอบ" from the browser's side (the server side is server/ai-quiz.ts and
 * app/api/exam-ai/quiz). The page sends the document's text; the answer comes back as a stream of
 * lines, one event a line, so the page can say how far the AI has got.
 */

/** the server holds the same numbers (QUIZ_LIMITS) */
export const QUIZ_TEXT_MIN = 200;
export const QUIZ_TEXT_MAX = 40_000;
export const QUIZ_FOCUS_MAX = 150;
export const QUIZ_COUNTS = [5, 10, 15, 20] as const;

export type QuizLevel = 'easy' | 'mixed' | 'hard';
export type QuizLanguage = 'th' | 'same';

export type QuizStatus = { enabled: false } | { enabled: true; needsLogin: true } | { enabled: true; needsLogin: false; left: number; perDay: number };

/** Whether the admin has turned AI on and how many papers this maker has left. A failure shows no tab. */
export async function quizStatus(): Promise<QuizStatus> {
  try {
    return await api<QuizStatus>('/exam-ai/quiz');
  } catch {
    return { enabled: false };
  }
}

export interface QuizAsk {
  text: string;
  name: string;
  count: number;
  level: QuizLevel;
  language: QuizLanguage;
  focus: string;
}

export interface QuizPaper {
  title: string;
  rounds: Round[];
  count: number;
  dropped: number;
  /** the document's own words behind each question, by question id */
  quotes: Record<string, string>;
  left?: number;
}

/**
 * Has the AI write a paper. `onProgress` hears how many questions are finished. Every refusal, early
 * (quota, not logged in) or late (the AI failed), comes back as an ApiError.
 */
export async function writeQuiz(ask: QuizAsk, onProgress: (done: number) => void, signal?: AbortSignal): Promise<QuizPaper> {
  let res: Response;
  try {
    res = await fetch(withBase('/api/exam-ai/quiz'), {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify(ask),
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch {
    if (signal?.aborted) throw new ApiError(0, 'quiz_stopped');
    throw new ApiError(0, 'offline');
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // a proxy that refuses a big body answers in HTML, without our error field
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : res.status === 413 ? 'quiz_text_long' : 'server_error', data);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) pending += value;
      const lines = pending.split('\n');
      pending = done ? '' : (lines.pop() ?? '');
      for (const line of lines) {
        if (!line.trim()) continue;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event.t === 'progress' && typeof event.done === 'number') onProgress(event.done);
        else if (event.t === 'done') return event as unknown as QuizPaper;
        else if (event.t === 'error') throw new ApiError(200, typeof event.error === 'string' ? event.error : 'server_error', event);
      }
      if (done) break;
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (signal?.aborted) throw new ApiError(0, 'quiz_stopped');
    throw new ApiError(0, 'quiz_cut');
  } finally {
    reader.releaseLock();
  }
  // the connection ended without an answer: a proxy or the network cut it
  throw new ApiError(0, signal?.aborted ? 'quiz_stopped' : 'quiz_cut');
}

const MESSAGES: Record<string, string> = {
  ai_limit: 'วันนี้ให้ AI ออกข้อสอบครบโควตาแล้ว พรุ่งนี้ใช้ต่อได้',
  ai_limit_site: 'วันนี้ทั้งระบบใช้ AI ครบโควตาแล้ว พรุ่งนี้ใช้ต่อได้',
  ai_busy: 'มีคนให้ AI ออกข้อสอบอยู่หลายคน รอสักครู่แล้วลองใหม่ (ไม่นับโควตา)',
  quiz_running: 'AI กำลังออกข้อสอบให้คุณอยู่อีกหน้าหนึ่ง รอให้เสร็จก่อน',
  ai_timeout: 'AI ใช้เวลานานเกินไป ลองใหม่ หรือลดจำนวนข้อ (ไม่นับโควตา)',
  ai_unavailable: 'ตอนนี้ต่อกับ AI ไม่ได้ ลองใหม่ภายหลัง (ไม่นับโควตา)',
  ai_declined: 'AI ไม่ออกข้อสอบจากเนื้อหานี้ ลองใช้เนื้อหาอื่น',
  ai_off: 'ผู้ดูแลระบบปิดการใช้ AI ไว้',
  quiz_empty: 'AI ยังออกข้อสอบจากเนื้อหานี้ไม่ได้ ลองใส่เนื้อหาที่มีข้อเท็จจริงมากขึ้น (ไม่นับโควตา)',
  quiz_cut: 'การเชื่อมต่อขาดระหว่างรอ AI ลองใหม่อีกครั้ง',
  quiz_stopped: 'หยุดแล้ว',
  quiz_text_short: `เนื้อหาสั้นเกินไป ใส่อย่างน้อย ${QUIZ_TEXT_MIN} ตัวอักษร`,
  quiz_text_long: `เนื้อหายาวเกิน ${QUIZ_TEXT_MAX.toLocaleString('th-TH')} ตัวอักษร เลือกเฉพาะส่วนที่ต้องการ`,
  login_required: 'หมดเวลาเข้าสู่ระบบแล้ว เข้าสู่ระบบอีกครั้งแล้วลองใหม่',
};

export function quizMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'ai_limit' && e.data.scope === 'site') return MESSAGES.ai_limit_site!;
    if (e.code === 'ai_limit' && typeof e.data.perDay === 'number') return `วันนี้ให้ AI ออกข้อสอบครบ ${e.data.perDay} ครั้งแล้ว พรุ่งนี้ใช้ต่อได้`;
    if (MESSAGES[e.code]) return MESSAGES[e.code]!;
  }
  return apiMessage(e);
}
