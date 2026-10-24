'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Phase } from '@icebreaker/shared';
import { getSocket } from '@/lib/socket';
import { hostedPins, keys, load, remove } from '@/lib/storage';
import { warmHostSound } from '@/lib/use-sound';

interface OpenRoom {
  pin: string;
  title: string;
  phase: Phase;
}

/** a browser that hosted a lot keeps only its latest tokens worth asking about */
const MAX_CHECKED = 8;

const PHASE_TEXT: Record<Phase, string> = {
  lobby: 'รอผู้เล่น',
  round: 'กำลังเล่น',
  question: 'กำลังเล่น',
  reveal: 'กำลังเล่น',
  leaderboard: 'กำลังเล่น',
  podium: 'จบเกมแล้ว',
};

/**
 * Rooms this browser opened that are still open: leaving the host page does not close a room
 * (a refresh must not end the game), so this is where a Host finds one again, or closes it.
 */
export function OpenRooms({ say }: { say: (text: string) => void }) {
  const [rooms, setRooms] = useState<OpenRoom[]>([]);
  const [closing, setClosing] = useState<string | null>(null);

  useEffect(() => {
    const pins = hostedPins();
    if (!pins.length) return;
    let live = true;
    void (async () => {
      const socket = getSocket();
      const found: OpenRoom[] = [];
      for (const pin of pins.slice(-MAX_CHECKED)) {
        try {
          const res = await socket.timeout(5000).emitWithAck('room:check', pin);
          if (res.ok) found.push({ pin, title: res.title, phase: res.phase });
          else if (res.error === 'room_not_found') remove(keys.hostToken(pin)); // closed or expired: nothing to come back to
        } catch {
          // no answer: leave the token, the next visit asks again
        }
      }
      if (live) setRooms(found);
    })();
    return () => {
      live = false;
    };
  }, []);

  const close = async (room: OpenRoom) => {
    const ask =
      room.phase === 'podium' || room.phase === 'lobby'
        ? `ปิดห้อง ${room.pin} เลยไหม?\nผู้เล่นที่ยังอยู่จะออกจากห้อง`
        : `ห้อง ${room.pin} ยังเล่นไม่จบ ปิดเลยไหม?\nผู้เล่นทุกคนจะออกจากห้องทันที และจะไม่มีรายงานของเกมนี้`;
    if (!confirm(ask)) return;
    setClosing(room.pin);
    try {
      const res = await getSocket().timeout(8000).emitWithAck('host:close', { pin: room.pin, hostToken: load(keys.hostToken(room.pin), '') });
      if (res.ok || res.error === 'room_not_found') {
        remove(keys.hostToken(room.pin));
        setRooms((rs) => rs.filter((r) => r.pin !== room.pin));
      } else say('ปิดห้องไม่สำเร็จ ลองอีกครั้ง');
    } catch {
      say('เชื่อมต่อเกมเซิร์ฟเวอร์ไม่ได้ ลองอีกครั้ง');
    }
    setClosing(null);
  };

  return (
    <AnimatePresence>
      {rooms.length > 0 && (
        <motion.section
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -8, opacity: 0 }}
          aria-label="ห้องที่ยังเปิดอยู่"
          className="glass mt-8 p-4 sm:p-5"
        >
          <h2 className="flex flex-wrap items-baseline gap-x-3 font-display text-xl font-extrabold">
            🚪 ห้องที่คุณเปิดค้างไว้
            <span className="text-sm font-normal text-white/60">กลับไปเล่นต่อ หรือปิดห้องที่ไม่ใช้แล้ว</span>
          </h2>
          <ul className="mt-3 grid gap-2">
            <AnimatePresence initial={false}>
              {rooms.map((r) => (
                <motion.li
                  key={r.pin}
                  layout
                  exit={{ opacity: 0, height: 0 }}
                  className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/5 px-4 py-3"
                >
                  <span className="rounded-full bg-white px-3 py-1 font-display font-extrabold tracking-wider text-ink">{r.pin}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{r.title}</span>
                    <span className="text-sm text-white/60">{PHASE_TEXT[r.phase]}</span>
                  </span>
                  <span className="flex gap-2">
                    <Link href={`/host/${r.pin}`} onClick={warmHostSound} className="btn btn-light px-4 text-base">
                      กลับไปที่ห้อง
                    </Link>
                    <button type="button" disabled={closing === r.pin} onClick={() => void close(r)} className="btn btn-ghost px-4 text-base">
                      {closing === r.pin ? 'กำลังปิด…' : 'ปิดห้อง'}
                    </button>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
