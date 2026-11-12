'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { applyExamTheme, examTheme, setExamTheme, subscribeExamTheme } from '@/lib/exam-theme';

/** the exam pages' look; the server always draws dark, and the client moves to the stored choice right after */
export function useExamTheme() {
  return useSyncExternalStore(subscribeExamTheme, examTheme, () => 'dark' as const);
}

/**
 * The sun/moon button that switches the exam pages between the night look and the light paper look.
 * `bar` sits in the dark site bar; `paper` sits on the paper itself (the bar over a sitting).
 */
export function ExamThemeToggle({ tone = 'bar' }: { tone?: 'bar' | 'paper' }) {
  const light = useExamTheme() === 'light';

  // the <head> script has already put the choice on <html>; this keeps it there after React (re)mounts the page
  useLayoutEffect(() => applyExamTheme(), []);

  const look =
    tone === 'bar'
      ? 'border border-white/10 bg-white/[0.06] text-white/85 hover:bg-white/10 hover:text-white'
      : 'exam-btn min-h-0 p-0';
  return (
    <button
      type="button"
      data-testid="exam-theme"
      aria-label="โหมดสว่าง"
      aria-pressed={light}
      title={light ? 'เปลี่ยนเป็นโหมดมืด' : 'เปลี่ยนเป็นโหมดสว่าง'}
      onClick={() => setExamTheme(light ? 'dark' : 'light')}
      className={`grid size-10 shrink-0 place-items-center rounded-full transition-colors ${look}`}
    >
      {light ? (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.8 6.8 0 0 0 10.7 10.7Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
        </svg>
      )}
    </button>
  );
}
