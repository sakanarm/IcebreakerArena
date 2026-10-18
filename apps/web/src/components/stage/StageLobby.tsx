'use client';

import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef } from 'react';
import type { StageState } from '@icebreaker/shared';
import { fmt } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { PopNumber, WaitingDots } from '../motion-bits';

/** small stable number per player, so the wiggles don't all move in sync */
const phase = (id: string) => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 26;

export function StageLobby({
  state,
  join,
  onKick,
}: {
  state: StageState;
  join: { url: string; label: string } | null;
  onKick?: (id: string, nickname: string) => void;
}) {
  const lastCount = useRef(state.playerCount);
  useEffect(() => {
    if (state.playerCount > lastCount.current) sfx.play('pop');
    lastCount.current = state.playerCount;
  }, [state.playerCount]);

  // newest first, so a player sees their name pop in at the top
  const players = [...state.players].reverse();
  const notListed = state.playerCount - players.length;

  return (
    <div className="flex h-full flex-col gap-5">
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="mx-auto flex w-full max-w-5xl items-stretch gap-4"
      >
        <div className="card flex flex-1 flex-col justify-center px-8 py-5">
          <p className="text-lg text-slate-500 lg:text-xl">
            ใช้มือถือเข้า <span className="font-semibold text-ink">{join?.label ?? '…'}</span> หรือสแกน QR
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-5">
            <span className="font-display text-2xl font-semibold text-slate-500">PIN เกม</span>
            <span className="flex font-display text-7xl font-extrabold tracking-wider text-ink lg:text-8xl" aria-label={`PIN ${state.pin}`}>
              {state.pin.split('').map((d, i) => (
                <motion.span
                  key={i}
                  initial={{ y: 36, opacity: 0, rotate: -12 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ delay: 0.2 + i * 0.07, type: 'spring', stiffness: 420, damping: 16 }}
                >
                  {d}
                </motion.span>
              ))}
            </span>
          </div>
        </div>
        {join && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0, rotate: 8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ delay: 0.55, type: 'spring', stiffness: 300, damping: 18 }}
            className="card grid place-items-center p-3"
          >
            <QRCodeSVG value={join.url} size={156} level="M" marginSize={0} title="สแกนเพื่อเข้าร่วมเกม" />
          </motion.div>
        )}
      </motion.div>

      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-1">
        <div className="glass flex items-center gap-3 px-5 py-2">
          <span className="text-3xl" aria-hidden>
            👥
          </span>
          <PopNumber value={state.playerCount} className="font-display text-4xl font-extrabold" />
          <span className="text-lg text-white/70">ผู้เล่น</span>
        </div>
        <h1 className="truncate text-xl font-semibold text-white/85 lg:text-2xl">{state.gameTitle}</h1>
      </div>

      <div className="relative mx-auto w-full max-w-6xl flex-1 overflow-y-auto pb-2">
        {players.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <motion.div
                className="text-7xl"
                animate={{ rotate: [0, -10, 10, 0], y: [0, -12, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                aria-hidden
              >
                📱
              </motion.div>
              <p className="mt-5 flex items-center gap-3 text-2xl text-white/80">
                รอผู้เล่นเข้าห้อง <WaitingDots />
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-wrap content-start justify-center gap-3">
            <AnimatePresence initial={false}>
              {players.map((p) => (
                <motion.li
                  key={p.id}
                  layout
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: p.connected ? 1 : 0.45 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 26 }}
                >
                  <button
                    type="button"
                    disabled={!onKick}
                    onClick={() => onKick?.(p.id, p.nickname)}
                    title={onKick ? `คลิกเพื่อนำ ${p.nickname} ออกจากห้อง` : undefined}
                    className="flex items-center gap-2 rounded-full bg-white py-2 pr-5 pl-3 font-semibold text-ink shadow-lg transition-colors enabled:hover:bg-bad enabled:hover:text-white disabled:cursor-default"
                  >
                    <span className="animate-wiggle inline-block text-2xl" style={{ animationDelay: `${-phase(p.id) / 10}s` }}>
                      {p.avatar}
                    </span>
                    <span className="max-w-56 truncate text-lg">{p.nickname}</span>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
        {notListed > 0 && <p className="mt-4 text-center text-white/60">และอีก {fmt(notListed)} คน</p>}
      </div>
    </div>
  );
}
