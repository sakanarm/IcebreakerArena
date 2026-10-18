'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { sfx } from './sfx';
import { load, save } from './storage';

/**
 * Sound on/off for this screen, remembered per device. The big screen starts
 * with sound on; phones start muted so a room full of phones stays quiet.
 */
export function useSound(key: string, defaultOn: boolean) {
  const [on, setOn] = useState(false);
  // on, but the browser is still waiting for a first click before it plays anything
  const blocked = useSyncExternalStore(sfx.subscribe, sfx.isBlocked, () => false);

  useEffect(() => {
    const saved = load(key, defaultOn);
    setOn(saved);
    sfx.setEnabled(saved);
    return () => sfx.music(null);
  }, [key, defaultOn]);

  const toggle = () => {
    const next = !on;
    setOn(next);
    save(key, next);
    sfx.setEnabled(next);
    if (next) sfx.play('tap');
  };

  const unlock = () => {
    sfx.unlock();
    sfx.play('tap');
  };

  return { on, blocked, toggle, unlock };
}

export type SoundControl = ReturnType<typeof useSound>;
