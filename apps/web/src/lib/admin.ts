'use client';

import type { Perm, Role } from './account';
import { api } from './api';

/** The admin page's view of the server (app/api/admin). Secrets never come this way: only whether they are set. */

export interface AdminUser {
  id: string;
  name: string;
  kind: 'local' | 'mock' | 'sso';
  username: string | null;
  email: string | null;
  role: Role;
  can: Record<Perm, boolean>;
  disabled: boolean;
  hasPassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  games: number;
}

export type Effort = 'low' | 'medium' | 'high';

export interface AiSettings {
  configured: boolean;
  problem: 'bad_json' | null;
  enabled: boolean;
  apiKeySet: boolean;
  baseUrl: string | null;
  headerNames: string[];
  model: string;
  effort: Effort;
  maxTokens: number;
  fallbacks: boolean;
  perPersonPerDay: number;
  perDay: number;
  who: 'anyone' | 'signed-in';
  quizPerPersonPerDay: number;
  quizEffort: Effort;
  structuredOutput: boolean;
  live: boolean;
}

export type AiTestResult =
  | { ok: true; ms: number; model: string; reply: string }
  | { ok: false; ms: number; status: number | null; message: string };

export interface Overview {
  system: {
    authMode: string;
    authProblem: string | null;
    sso: boolean;
    ssoProblem: string | null;
    pika: boolean;
    database: 'postgres' | 'pglite';
    schemaVersion: number;
    node: string;
  };
  counts: { users: number; disabled: number; admins: number; curators: number; signedIn: number; games: number; exams: number; shared: number };
  usage: {
    days: { day: string; asks: number; quiz: number; tokensIn: number; tokensOut: number }[];
    top: { name: string | null; asks: number; quiz: number; tokens: number }[];
  };
  changes: { at: string; action: string; actor: string | null; target: string | null }[];
}

/** How people can log in on this site now: passwords (the password form is there) and company login (Keycloak is set up). */
export type LoginWays = { passwords: boolean; company: boolean };

export const listUsers = (q: string) =>
  api<{ users: AdminUser[]; total: number; matched: number; login: LoginWays }>(`/admin/users${q ? `?${new URLSearchParams({ q })}` : ''}`);

export const createUser = (body: { username: string; name: string; email: string; password: 'generate' | 'none'; role: Role }) =>
  api<{ user: AdminUser; password: string | null }>('/admin/users', { method: 'POST', body });

export type UserPatch = Partial<{ role: Role; can: Partial<Record<Perm, boolean>>; disabled: boolean; name: string; email: string | null }>;

export const updateUser = (id: string, patch: UserPatch) => api<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });

export const resetPassword = (id: string) => api<{ user: AdminUser; password: string }>(`/admin/users/${encodeURIComponent(id)}/password`, { method: 'POST' });

export const endSessions = (id: string) => api<{ ended: number }>(`/admin/users/${encodeURIComponent(id)}/sessions`, { method: 'DELETE' });

export const getAi = () => api<{ settings: AiSettings }>('/admin/ai');

export const saveAi = (body: Record<string, unknown>) => api<{ settings: AiSettings }>('/admin/ai', { method: 'PUT', body });

export const testAi = () => api<{ result: AiTestResult }>('/admin/ai/test', { method: 'POST' });

export const getOverview = () => api<Overview>('/admin/overview');

export const ROLE_LABEL: Record<Role, string> = { maker: 'ผู้สร้าง', curator: 'ผู้ตรวจเนื้อหา', admin: 'ผู้ดูแลระบบ' };

export const ROLE_TEXT: Record<Role, string> = {
  maker: 'สร้างเกมและข้อสอบของตัวเอง แชร์เข้าคลังกลางได้',
  curator: 'ทำได้ทุกอย่างของผู้สร้าง และซ่อนหรือถอนเกมใดก็ได้ในคลังกลาง',
  admin: 'ทำได้ทุกอย่าง และเข้าหน้านี้เพื่อจัดการผู้ใช้ สิทธิ์ และการตั้งค่า AI',
};

export const PERM_LABEL: Record<Perm, { title: string; text: string }> = {
  share: { title: 'แชร์เกมเข้าคลังกลาง', text: 'ให้คนอื่นในบริษัทเห็นและทำสำเนาเกมของบัญชีนี้ได้' },
  aiQuiz: { title: 'ให้ AI ออกข้อสอบ', text: 'ใช้ AI เขียนข้อสอบจากเอกสาร (นับโควตาต่อวัน)' },
  pika: { title: 'คลังความรู้ Pika', text: 'เพิ่มเอกสารเข้าคลังส่วนตัวและตั้งข้อสอบจากคลัง' },
};

export const PERMS: Perm[] = ['share', 'aiQuiz', 'pika'];
