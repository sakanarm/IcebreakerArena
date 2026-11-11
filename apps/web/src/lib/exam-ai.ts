import { ApiError, api, apiMessage } from './api';
import type { PaperOrigin } from './exam';

/**
 * "ถาม AI" under an answer in exam mode, from the browser's side (the server side is server/ai.ts).
 * The browser only names the paper and the question; the server reads the question itself.
 */

/** how the server finds the paper: a sample game, an exam link, or the maker's own game */
export interface AiPaper {
  kind: 'sample' | 'link' | 'game';
  id: string;
}

/** A game kept only in this browser is not on the server, so there is nothing for it to look up. */
export function aiPaper(code: string, origin: PaperOrigin): AiPaper | null {
  if (origin === 'sample') return { kind: 'sample', id: code };
  if (origin === 'link') return { kind: 'link', id: code };
  if (origin === 'own') return { kind: 'game', id: code };
  return null;
}

export type AiStatus = { enabled: false } | { enabled: true; needsLogin: boolean };

let status: Promise<AiStatus> | null = null;

/** Whether the admin has turned AI on, asked once per page. A failure to ask shows no button. */
export function aiStatus(): Promise<AiStatus> {
  status ??= api<AiStatus>('/exam-ai').catch(() => {
    status = null;
    return { enabled: false } as const;
  });
  return status;
}

export interface AiTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** what one person may send: the server holds the same numbers (AI_LIMITS) */
export const AI_TURNS = 6;
export const AI_QUESTION_MAX = 600;

export async function askAi(paper: AiPaper, questionId: string, chosen: number | null, messages: AiTurn[]): Promise<{ reply: string; left: number }> {
  return api('/exam-ai', { method: 'POST', body: { paper, questionId, chosen, messages } });
}

/** the conversations on this page, by question, so going to another question and back keeps one */
export const threads = new Map<string, AiTurn[]>();

const MESSAGES: Record<string, string> = {
  ai_limit: 'วันนี้ถาม AI ครบโควตาแล้ว พรุ่งนี้ถามต่อได้',
  ai_limit_site: 'วันนี้มีคนถาม AI ครบโควตาของทั้งระบบแล้ว พรุ่งนี้ถามต่อได้',
  ai_busy: 'AI กำลังตอบอยู่ หรือมีคนใช้มาก รอสักครู่แล้วลองใหม่',
  ai_timeout: 'AI ใช้เวลานานเกินไป ลองถามใหม่อีกครั้ง (ไม่นับโควตา)',
  ai_unavailable: 'ตอนนี้ต่อกับ AI ไม่ได้ ลองใหม่ภายหลัง (ไม่นับโควตา)',
  ai_declined: 'AI ไม่ตอบคำถามนี้ ลองถามเรื่องเนื้อหาของข้อนี้แทน',
  ai_off: 'ผู้ดูแลระบบปิดการถาม AI ไว้',
  login_required: 'เข้าสู่ระบบก่อนจึงจะถาม AI ได้',
  question_gone: 'ไม่พบข้อนี้แล้ว เจ้าของอาจแก้หรือปิดข้อสอบไปแล้ว',
  question_too_long: `คำถามยาวเกินไป ถามได้ครั้งละไม่เกิน ${AI_QUESTION_MAX} ตัวอักษร`,
};

export function aiMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'ai_limit' && e.data.scope === 'site') return MESSAGES.ai_limit_site!;
    if (MESSAGES[e.code]) return MESSAGES[e.code]!;
  }
  return apiMessage(e);
}
