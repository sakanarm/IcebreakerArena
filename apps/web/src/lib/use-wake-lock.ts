'use client';

import { useEffect } from 'react';

/**
 * Keeps the phone screen on during a game, where the browser allows it.
 * The browser drops the lock whenever the tab is hidden, so it is asked for again on return.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;

    const request = async () => {
      try {
        const next = await navigator.wakeLock.request('screen');
        if (alive) lock = next;
        else void next.release();
      } catch {
        // refused (battery saver, older browser): the screen may dim, nothing else breaks
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
