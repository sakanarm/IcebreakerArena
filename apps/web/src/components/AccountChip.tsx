'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { logout, useAccount, type AccountUser } from '@/lib/account';
import { apiMessage } from '@/lib/api';

/**
 * Who is logged in, with a log-out menu; a login link when nobody is (unless `loginLink` is off).
 * Nothing when accounts are off.
 */
export function AccountChip({ loginLink = true }: { loginLink?: boolean }) {
  const account = useAccount();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (account.status !== 'ready' || account.mode === 'off') return null;

  if (!account.user) {
    if (!loginLink) return null;
    return (
      <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="btn btn-ghost px-4 text-base">
        เข้าสู่ระบบ
      </Link>
    );
  }

  // the login changed in another tab: this page still acts for account.user until it is reloaded
  if (account.switched) {
    return (
      <button type="button" onClick={() => location.reload()} className="btn bg-gold px-3 text-base text-ink" title={switchedText(account.user, account.switched.to)}>
        ⚠️ <span className="max-w-[10rem] truncate">{account.user.name}</span> · โหลดใหม่
      </button>
    );
  }

  const out = async () => {
    try {
      await logout();
      setOpen(false);
    } catch (e) {
      alert(apiMessage(e));
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="btn btn-ghost max-w-[12rem] gap-2 px-3 text-base"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-2 text-sm font-bold text-ink" aria-hidden>
          {[...account.user.name][0]?.toUpperCase()}
        </span>
        <span className="truncate">{account.user.name}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 z-40 mt-2 w-64 rounded-2xl bg-ink p-2 text-white shadow-2xl ring-1 ring-white/15"
          >
            <p className="px-3 py-2 text-sm text-white/60">
              เข้าสู่ระบบในชื่อ <span className="font-semibold text-white">{account.user.name}</span>
              {account.mode === 'mock' && <span className="mt-1 block text-xs text-gold">โหมดทดสอบ (ไม่มีรหัสผ่าน)</span>}
            </p>
            <button type="button" role="menuitem" onClick={out} className="w-full rounded-xl px-3 py-2 text-left font-semibold hover:bg-white/10">
              ออกจากระบบ
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** What happened to the login, for a page still acting for `mine`. */
export function switchedText(mine: AccountUser, to: AccountUser | null) {
  return to
    ? `อีกแท็บเข้าสู่ระบบเป็น ${to.name} แล้ว หน้านี้ยังเป็นของ ${mine.name} และจะไม่บันทึกอะไรลงบัญชี ${to.name} โหลดหน้าใหม่เพื่อใช้บัญชี ${to.name}`
    : `หมดเวลาเข้าสู่ระบบ หรือออกจากระบบจากอีกแท็บ เข้าสู่ระบบเป็น ${mine.name} อีกครั้งในแท็บใหม่เพื่อทำงานต่อ`;
}
