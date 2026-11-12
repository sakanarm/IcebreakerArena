import { keys, load, save } from './storage';

/**
 * The exam pages come in the app's dark night look (the default) or a light paper look, picked with the sun/moon
 * button in their top bar and remembered per browser. The choice lives on <html> as data-exam-theme="light";
 * globals.css only reads it under .exam-themed, so the game, the host screens and /admin never change.
 */
export type ExamTheme = 'dark' | 'light';

const LIGHT = JSON.stringify('light');

/**
 * Runs in <head> before the first paint (app/layout.tsx), so a light paper never shows dark for a moment while
 * the page loads. It only ever sets the one attribute, and a browser that blocks storage just stays dark.
 */
export const examThemeScript = `try{if(localStorage.getItem(${JSON.stringify(keys.examTheme)})===${JSON.stringify(LIGHT)})document.documentElement.setAttribute('data-exam-theme','light')}catch(e){}`;

let current: ExamTheme | null = null;
const listeners = new Set<() => void>();

const stored = (): ExamTheme => (load<unknown>(keys.examTheme, 'dark') === 'light' ? 'light' : 'dark');

/** this browser's choice (read once, then kept here) */
export function examTheme(): ExamTheme {
  if (current === null) current = stored();
  return current;
}

/** puts the choice on <html>, where the CSS reads it */
export function applyExamTheme(theme: ExamTheme = examTheme()) {
  const root = document.documentElement;
  if (theme === 'light') root.dataset.examTheme = 'light';
  else delete root.dataset.examTheme;
}

export function setExamTheme(theme: ExamTheme) {
  current = theme;
  save(keys.examTheme, theme);
  applyExamTheme(theme);
  listeners.forEach((l) => l());
}

/** For useSyncExternalStore. Another tab of the app switching the look switches this one too. */
export function subscribeExamTheme(listener: () => void) {
  listeners.add(listener);
  const fromOtherTab = (e: StorageEvent) => {
    if (e.key !== null && e.key !== keys.examTheme) return;
    current = stored();
    applyExamTheme(current);
    listener();
  };
  window.addEventListener('storage', fromOtherTab);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', fromOtherTab);
  };
}
