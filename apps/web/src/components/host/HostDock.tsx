'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { StageState } from '@icebreaker/shared';
import { fmt } from '@/lib/format';
import { withBase } from '@/lib/paths';
import { getSocket } from '@/lib/socket';

/** a double click or a bouncing clicker must not skip a question */
const COOLDOWN_MS = 700;
const NEXT_KEYS = ['Space', 'Enter', 'ArrowRight', 'PageDown', 'KeyN'];

function primaryLabel(state: StageState): string {
  switch (state.phase) {
    case 'lobby':
      return 'เริ่มเกม ▶';
    case 'round':
      return 'ข้ามบทนำ ⏭';
    case 'question':
      return 'เฉลยเลย';
    case 'reveal':
      return state.isLastQuestion ? 'ประกาศผล 🏆' : 'ดูอันดับ ▶';
    case 'leaderboard':
      return 'ข้อถัดไป ▶';
    case 'podium':
      return '📊 ดูรายงาน';
  }
}

/**
 * The Host's controls, docked under the big screen: one "Next" button that
 * always does the obvious thing, plus the keyboard (Space, Enter, →, a clicker).
 */
export function HostDock({ state, onReport, blocked }: { state: StageState; onReport: () => void; blocked: boolean }) {
  const lastPress = useRef(0);
  const waiting = state.phase === 'lobby' && state.playerCount === 0;
  const canEnd = state.phase !== 'lobby' && state.phase !== 'podium';
  const label = primaryLabel(state);

  const next = () => {
    if (state.phase === 'podium') return onReport();
    if (waiting) return;
    const now = Date.now();
    if (now - lastPress.current < COOLDOWN_MS) return;
    lastPress.current = now;
    getSocket().emit('host:next');
  };

  const end = () => {
    if (confirm('จบเกมตอนนี้แล้วไปประกาศผลเลยไหม?')) getSocket().emit('host:end');
  };

  // leaving does not close the room, but nobody can move the game on until the Host comes back
  const leave = (e: React.MouseEvent) => {
    if (canEnd && !confirm('เกมยังเล่นอยู่ ออกจากหน้านี้ไหม?\nผู้เล่นจะค้างอยู่ที่ข้อนี้ จนกว่าคุณจะกดย้อนกลับมา')) e.preventDefault();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocked || e.repeat || e.altKey || e.ctrlKey || e.metaKey || !NEXT_KEYS.includes(e.code)) return;
      // a focused button or field handles its own keys
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      e.preventDefault();
      next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <motion.div
      initial={{ y: 120 }}
      animate={{ y: 0 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 260, damping: 26 }}
      className="fixed inset-x-0 bottom-0 z-40 px-4 pb-3"
    >
      <div className="glass mx-auto flex max-w-6xl items-center gap-3 bg-night/70 px-4 py-3">
        <Link href="/" onClick={leave} className="btn btn-ghost shrink-0 px-3 text-xl" aria-label="กลับหน้าแรก" title="กลับหน้าแรก">
          🏠
        </Link>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-sm lg:text-base">
          <span className="rounded-full bg-white px-3 py-1 font-display font-extrabold tracking-wider text-ink">PIN {state.pin}</span>
          <span className="rounded-full bg-white/10 px-3 py-1">👥 {fmt(state.playerCount)}</span>
          {state.phase === 'question' && (
            <span className="rounded-full bg-white/10 px-3 py-1">
              ตอบแล้ว {fmt(state.answeredCount)}/{fmt(state.playerCount)}
            </span>
          )}
          <span className="hidden text-white/50 xl:inline">กด Space หรือ → เพื่อไปต่อ</span>
        </div>

        <a href={withBase(`/stage/${state.pin}`)} target="_blank" rel="noopener" className="btn btn-ghost hidden px-4 text-base md:inline-flex" title="เปิดจอแสดงผลแยก สำหรับโปรเจกเตอร์">
          🖥️ จอแยก
        </a>
        {canEnd && (
          <button type="button" onClick={end} className="btn btn-ghost px-4 text-base" title="จบเกมแล้วประกาศผลทันที">
            ⏹ จบเกม
          </button>
        )}
        {state.phase === 'podium' && (
          <Link href="/host" className="btn btn-ghost px-4 text-base" title="กลับไปเลือกเกม แล้วเปิดห้องใหม่">
            🎮 เล่นเกมอื่น
          </Link>
        )}
        <button
          type="button"
          onClick={next}
          disabled={waiting}
          title={waiting ? 'รอผู้เล่นอย่างน้อย 1 คน' : undefined}
          className="btn btn-gold min-w-48 px-8 py-4 text-xl"
        >
          <motion.span key={label} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            {waiting ? 'รอผู้เล่น…' : label}
          </motion.span>
        </button>
      </div>
    </motion.div>
  );
}
