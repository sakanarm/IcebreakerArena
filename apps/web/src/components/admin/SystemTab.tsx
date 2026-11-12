'use client';

import { useEffect, useState } from 'react';
import { getOverview, type Overview } from '@/lib/admin';
import { apiMessage } from '@/lib/api';
import { WaitingDots } from '../motion-bits';
import { Badge, Say, fullTime, num, timeAgo, type Tone } from './ui';

const ACTION: Record<string, string> = {
  admin_role_set: 'เปลี่ยนบทบาท',
  admin_perms_set: 'เปลี่ยนสิทธิ์',
  admin_user_disabled: 'ปิดบัญชี',
  admin_user_enabled: 'เปิดบัญชี',
  admin_name_set: 'แก้ชื่อ',
  admin_sessions_ended: 'ให้ออกจากระบบทุกเครื่อง',
  admin_ai_tested: 'ทดสอบการเชื่อมต่อ AI',
  local_email_set: 'แก้อีเมล',
  local_user_created: 'สร้างบัญชี',
  local_password_set: 'ตั้งรหัสผ่านใหม่',
  ai_settings_saved: 'บันทึกการตั้งค่า AI',
};

const AUTH_LABEL: Record<string, string> = {
  off: 'ปิดระบบบัญชี (ทุกคนเล่นได้ ไม่มีการบันทึก)',
  mock: 'โหมดทดสอบ (ไม่มีรหัสผ่าน)',
  local: 'บัญชีในระบบ (ชื่อผู้ใช้ + รหัสผ่าน)',
  oidc: 'บัญชีบริษัท (OIDC)',
};

export function SystemTab() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getOverview().then(setData, (e) => setError(apiMessage(e)));
  };
  useEffect(load, []);

  if (error) {
    return (
      <div className="exam-card p-6">
        <Say tone="bad">{error}</Say>
        <button type="button" className="exam-btn mt-4" onClick={load}>
          ลองใหม่
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <p className="exam-card flex items-center gap-3 p-6 text-ex-muted">
        กำลังโหลดข้อมูลระบบ <WaitingDots />
      </p>
    );
  }

  const { system: s, counts: c } = data;
  const services: { title: string; value: string; tone: Tone; badge: string; problem?: string | null }[] = [
    {
      title: 'การเข้าสู่ระบบ',
      value: AUTH_LABEL[s.authMode] ?? s.authMode,
      tone: s.authProblem ? 'bad' : s.authMode === 'local' || s.authMode === 'oidc' ? 'good' : 'gold',
      badge: s.authProblem ? 'มีปัญหา' : s.authMode === 'local' || s.authMode === 'oidc' ? 'ปกติ' : 'ไม่ใช่โหมดจริง',
      problem: s.authProblem,
    },
    {
      title: 'เข้าด้วยบัญชีบริษัท (Keycloak)',
      value: s.sso ? 'เปิดใช้งาน ผู้ใช้กดปุ่มบัญชีบริษัทในหน้าเข้าสู่ระบบได้' : 'ยังไม่ได้ตั้งค่า',
      tone: s.ssoProblem ? 'bad' : s.sso ? 'good' : 'neutral',
      badge: s.ssoProblem ? 'มีปัญหา' : s.sso ? 'ปกติ' : 'ปิด',
      problem: s.ssoProblem,
    },
    {
      title: 'คลังความรู้ Pika',
      value: s.pika ? 'เชื่อมต่อแล้ว ผู้ใช้ที่มีอีเมลสร้างคลังส่วนตัวได้' : 'ยังไม่ได้ตั้งค่าคีย์องค์กร',
      tone: s.pika ? 'good' : 'neutral',
      badge: s.pika ? 'ปกติ' : 'ปิด',
    },
    {
      title: 'ฐานข้อมูล',
      value: s.database === 'postgres' ? `PostgreSQL · schema รุ่นที่ ${s.schemaVersion}` : `PGlite ในเครื่อง (สำหรับพัฒนา) · schema รุ่นที่ ${s.schemaVersion}`,
      tone: s.database === 'postgres' ? 'good' : 'gold',
      badge: s.database === 'postgres' ? 'ปกติ' : 'ในเครื่อง',
    },
  ];

  const tiles: { label: string; value: number; sub?: string }[] = [
    { label: 'บัญชีทั้งหมด', value: c.users, sub: c.disabled ? `ปิดใช้งาน ${num(c.disabled)}` : undefined },
    { label: 'กำลังเข้าใช้อยู่', value: c.signedIn, sub: 'บัญชีที่ยังไม่หมดเวลา' },
    { label: 'ผู้ดูแลระบบ', value: c.admins, sub: `ผู้ตรวจเนื้อหา ${num(c.curators)}` },
    { label: 'เกมทั้งหมด', value: c.games },
    { label: 'ข้อสอบ', value: c.exams },
    { label: 'แชร์ในคลังกลาง', value: c.shared },
  ];

  return (
    <div className="grid gap-5">
      <section aria-label="ภาพรวม">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="admin-counts">
          {tiles.map((t) => (
            <li key={t.label} className="exam-card p-4 sm:p-5">
              <p className="text-sm text-ex-soft">{t.label}</p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{num(t.value)}</p>
              {t.sub && <p className="mt-0.5 text-xs text-ex-soft">{t.sub}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section className="exam-card p-5 sm:p-6" data-testid="admin-services">
        <h2 className="font-display text-lg font-semibold">บริการที่เชื่อมต่อ</h2>
        <ul className="mt-3 divide-y divide-ex-line">
          {services.map((v) => (
            <li key={v.title} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="font-semibold">{v.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-ex-soft">{v.value}</p>
                {v.problem && <p className="mt-1 font-mono text-xs wrap-anywhere text-ex-bad">{v.problem}</p>}
              </div>
              <Badge tone={v.tone}>{v.badge}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-ex-line pt-3 text-xs text-ex-soft">
          Node {s.node} · ค่าเชื่อมต่อทั้งหมดเก็บไว้ในโฟลเดอร์ var/secrets บนเซิร์ฟเวอร์ ไม่แสดงในหน้านี้
        </p>
      </section>

      <section className="exam-card p-5 sm:p-6" data-testid="admin-changes">
        <h2 className="font-display text-lg font-semibold">การเปลี่ยนแปลงล่าสุด</h2>
        {data.changes.length === 0 ? (
          <p className="mt-3 text-ex-muted">ยังไม่มีการเปลี่ยนแปลงจากผู้ดูแลระบบ</p>
        ) : (
          <ol className="mt-3 divide-y divide-ex-line">
            {data.changes.map((ch, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm">
                <p className="min-w-0 flex-1 basis-64 leading-relaxed">
                  <span className="font-semibold">{ch.actor ?? 'ระบบ'}</span> <span className="text-ex-muted">{ACTION[ch.action] ?? ch.action}</span>
                  {ch.target && ch.target !== ch.actor && (
                    <>
                      {' '}
                      <span className="text-ex-muted">ของ</span> <span className="font-semibold">{ch.target}</span>
                    </>
                  )}
                </p>
                <time dateTime={ch.at} title={fullTime(ch.at)} className="shrink-0 text-xs text-ex-soft">
                  {timeAgo(ch.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
