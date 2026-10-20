import { useEffect, useState } from 'react';
import type { GameClient } from './socket';

/** server clock minus this device's clock, so countdowns match the server's timers */
let offsetMs = 0;

export const serverNow = () => Date.now() + offsetMs;

/** Keeps the sample with the shortest round trip: it has the smallest error. */
export async function syncClock(socket: GameClient, samples = 5) {
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < samples; i++) {
    const sent = Date.now();
    try {
      const server = await socket.timeout(3000).emitWithAck('time:sync');
      const received = Date.now();
      if (received - sent < best.rtt) best = { rtt: received - sent, offset: server - (sent + received) / 2 };
    } catch {
      // a lost sample is fine; the others still count
    }
  }
  if (best.rtt !== Infinity) offsetMs = best.offset;
}

/**
 * Syncs now and again every 30 s while connected: a device that corrects its own clock mid-game
 * (Windows and phones do, by a second or more) would otherwise open and close questions at the wrong time.
 */
export function keepClockSynced(socket: GameClient, everyMs = 30_000) {
  const run = () => {
    if (socket.connected) void syncClock(socket);
  };
  run();
  const id = setInterval(run, everyMs);
  return () => clearInterval(id);
}

/** Server time that re-renders every `intervalMs` while `active`. */
export function useServerNow(active = true, intervalMs = 100) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    if (!active) return;
    setNow(serverNow());
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
