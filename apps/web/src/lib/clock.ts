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
