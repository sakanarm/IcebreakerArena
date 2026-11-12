'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { refreshAccount, useAccount } from '@/lib/account';
import { WaitingDots } from '../motion-bits';
import { Notice } from '../Notice';
import { SiteNav } from '../SiteNav';
import { AiTab } from './AiTab';
import { SystemTab } from './SystemTab';
import { UsersTab } from './UsersTab';

type Tab = 'users' | 'ai' | 'system';
const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  {
    key: 'users',
    label: 'ผู้ใช้และสิทธิ์',
    icon: (
      <>
        <circle cx="7.5" cy="7" r="3" />
        <path d="M2 17c.6-3 2.8-4.6 5.5-4.6S12.4 14 13 17" />
        <path d="M13 4.3a3 3 0 010 5.4M15 12.8c1.5.6 2.6 2 3 4.2" />
      </>
    ),
  },
  {
    key: 'ai',
    label: 'AI (LLM)',
    icon: (
      <>
        <path d="M10 2.5l1.6 4.3 4.4 1.7-4.4 1.7L10 14.5l-1.6-4.3L4 8.5l4.4-1.7z" />
        <path d="M15.5 13.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
      </>
    ),
  },
  {
    key: 'system',
    label: 'ระบบ',
    icon: (
      <>
        <rect x="2.5" y="3.5" width="15" height="10" rx="2" />
        <path d="M7 17h6M10 13.5V17" />
      </>
    ),
  },
];

const tabFromHash = (): Tab => {
  const h = typeof location === 'undefined' ? '' : location.hash.slice(1);
  return TABS.some((t) => t.key === h) ? (h as Tab) : 'users';
};

/** /admin: people, their roles and permissions, the AI connection, and how the site is doing. Admins only. */
export function AdminApp() {
  const account = useAccount();
  const [tab, setTab] = useState<Tab>('users');
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  // the tab lives in the address, so a reload or a shared link opens the same one
  useEffect(() => {
    const read = () => setTab(tabFromHash());
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  const go = (t: Tab, focus = false) => {
    setTab(t);
    history.replaceState(null, '', t === 'users' ? location.pathname + location.search : `#${t}`);
    if (focus) tabRefs.current[t]?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.key === tab);
    const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    go(TABS[(to + TABS.length) % TABS.length].key, true);
  };

  if (account.status === 'loading') {
    return (
      <div className="exam-page grid place-items-center text-xl">
        <span className="flex items-center gap-3">
          กำลังเปิด <WaitingDots />
        </span>
      </div>
    );
  }
  if (account.status === 'error') {
    return (
      <Notice
        emoji="📡"
        title="เชื่อมต่อไม่ได้"
        actions={
          <button type="button" onClick={() => void refreshAccount()} className="btn btn-primary">
            ลองใหม่
          </button>
        }
      >
        ตรวจว่าเครื่องนี้ต่อ Wi-Fi บริษัทหรือ VPN อยู่ แล้วลองใหม่
      </Notice>
    );
  }
  if (account.mode === 'off') {
    return (
      <Notice
        emoji="🔒"
        title="ยังไม่ได้เปิดระบบบัญชี"
        actions={
          <Link href="/" className="btn btn-ghost">
            กลับหน้าแรก
          </Link>
        }
      >
        หน้าตั้งค่าระบบใช้ได้เมื่อเปิดระบบบัญชี (AUTH_MODE=local) และเข้าสู่ระบบเป็นผู้ดูแลระบบ
      </Notice>
    );
  }
  if (!account.user) {
    return (
      <Notice
        emoji="🔑"
        title="เข้าสู่ระบบก่อน"
        actions={
          <>
            <Link href={`/login?next=${encodeURIComponent('/admin')}`} className="btn btn-primary" data-testid="admin-login">
              เข้าสู่ระบบ
            </Link>
            <Link href="/" className="btn btn-ghost">
              กลับหน้าแรก
            </Link>
          </>
        }
      >
        หน้านี้สำหรับผู้ดูแลระบบ ใช้จัดการผู้ใช้ สิทธิ์ และการตั้งค่า AI
      </Notice>
    );
  }
  if (account.user.role !== 'admin') {
    return (
      <Notice
        emoji="🛡️"
        title="หน้านี้สำหรับผู้ดูแลระบบเท่านั้น"
        actions={
          <Link href="/host" className="btn btn-ghost" data-testid="admin-denied">
            ไปที่เกมของฉัน
          </Link>
        }
      >
        บัญชี {account.user.name} ไม่ได้เป็นผู้ดูแลระบบ ถ้าต้องการสิทธิ์นี้ ติดต่อผู้ดูแลระบบของบริษัท
      </Notice>
    );
  }

  return (
    <div className="exam-page [color-scheme:dark]">
      <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-5">
        <SiteNav here={null} />
      </div>
      <main className="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-5">
        <p className="text-sm font-semibold tracking-wide text-brand-2">สำหรับผู้ดูแลระบบ</p>
        <h1 className="mt-1 font-display text-3xl font-semibold sm:text-4xl">ตั้งค่าระบบ</h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-ex-muted">จัดการบัญชีผู้ใช้ บทบาทและสิทธิ์ เชื่อมต่อ AI และดูสถานะของระบบ ทุกการเปลี่ยนแปลงมีผลทันทีและถูกบันทึกไว้ว่าใครทำ</p>

        <div role="tablist" aria-label="หมวดการตั้งค่า" onKeyDown={onKey} className="mt-6 flex gap-1 overflow-x-auto rounded-2xl border border-ex-line bg-ex-card p-1 sm:inline-flex">
          {TABS.map((t) => (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${t.key}`}
              aria-selected={tab === t.key}
              aria-controls={`panel-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              onClick={() => go(t.key)}
              data-testid={`admin-tab-${t.key}`}
              className={`flex min-h-11 flex-1 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-base font-semibold whitespace-nowrap transition-colors sm:flex-none ${
                tab === t.key ? 'bg-brand text-white shadow-[0_6px_18px_-8px_rgb(61_90_254/0.8)]' : 'text-ex-muted hover:bg-white/[0.06] hover:text-ex-fg'
              }`}
            >
              <svg viewBox="0 0 20 20" className="size-4.5 shrink-0" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                {t.icon}
              </svg>
              {t.label}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-6">
          {tab === 'users' ? <UsersTab me={account.user} /> : tab === 'ai' ? <AiTab /> : <SystemTab />}
        </div>
      </main>
    </div>
  );
}
