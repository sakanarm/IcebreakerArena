'use client';

import Link from 'next/link';
import { AccountChip } from './AccountChip';
import { Logo } from './shapes';

export type NavPlace = 'host' | 'exam' | 'create' | null;

const PLACES: { key: Exclude<NavPlace, null>; href: string; label: string; testid: string }[] = [
  { key: 'host', href: '/host', label: 'เกมของฉัน', testid: 'nav-host' },
  { key: 'exam', href: '/exam', label: 'ข้อสอบ', testid: 'nav-exam' },
  { key: 'create', href: '/create', label: 'สร้างใหม่', testid: 'nav-create' },
];

/**
 * The top bar of the maker's dark pages (games, create, import, knowledge base): the logo, the three
 * places a maker moves between, and who is logged in. On a phone the places drop to a full-width row
 * under the logo, so nothing wraps into a column of buttons.
 */
export function SiteNav({ here, loginLink = true }: { here: NavPlace; loginLink?: boolean }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <Link href="/" aria-label="กลับหน้าแรก" className="rounded-2xl">
        <Logo small />
      </Link>
      <div className="flex items-center gap-2 sm:order-last">
        <AccountChip loginLink={loginLink} />
      </div>
      <nav aria-label="เมนูหลัก" className="flex w-full gap-1 rounded-2xl border border-white/10 bg-white/[0.06] p-1 sm:ml-auto sm:w-auto">
        {PLACES.map((p) => {
          const on = p.key === here;
          const make = p.key === 'create';
          return (
            <Link
              key={p.key}
              href={p.href}
              data-testid={p.testid}
              aria-current={on ? 'page' : undefined}
              className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-semibold whitespace-nowrap transition-colors sm:flex-none ${
                on ? 'bg-white text-ink shadow-sm' : make ? 'text-gold hover:bg-white/10' : 'text-white/75 hover:bg-white/10 hover:text-white'
              }`}
            >
              {make && (
                <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              )}
              {p.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
