'use client';

import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef } from 'react';
import type { StageState } from '@icebreaker/shared';
import { fmt } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { GameCover } from '../cover/GameCover';
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
  const cover = { title: state.gameTitle, cover: state.cover ?? undefined };

  return (
    <div className="flex h-full flex-col gap-5">
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="mx-auto flex w-full max-w-5xl items-stretch gap-4"
      >
        <div className="card flex min-w-0 flex-1 flex-col justify-center px-5 py-5 sm:px-8">
          <p className="text-lg text-slate-500 lg:text-xl">
            ใช้มือถือเข้า <span className="font-semibold text-ink">{join?.label ?? '…'}</span>
            {join && <span className="max-sm:hidden"> หรือสแกน QR</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-5">
            <span className="font-display text-2xl font-semibold text-slate-500">PIN เกม</span>
            <span className="flex font-display text-6xl font-extrabold tracking-wider text-ink sm:text-7xl lg:text-8xl" aria-label={`PIN ${state.pin}`}>
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
        {/* no room for it next to the PIN on a phone, and the PIN is right there */}
        {join && (
          <motion.div
            initial={{ scale: 0.5, opacity: 0, rotate: 8 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ delay: 0.55, type: 'spring', stiffness: 300, damping: 18 }}
            className="card grid place-items-center p-3 max-sm:hidden"
          >
            <QRCodeSVG value={join.url} size={156} level="M" marginSize={0} title="สแกนเพื่อเข้าร่วมเกม" />
          </motion.div>
        )}
      </motion.div>

      {/* on a phone the title drops under the count instead of being cut to a few letters */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-x-4 gap-y-3 px-1 max-sm:flex-wrap">
        <div className="glass flex shrink-0 items-center gap-3 px-5 py-2">
          <span className="text-3xl" aria-hidden>
            👥
          </span>
          <PopNumber value={state.playerCount} className="font-display text-4xl font-extrabold" />
          <span className="text-lg whitespace-nowrap text-white/70">ผู้เล่น</span>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {/* the poster below shrinks into this once someone joins */}
          {players.length > 0 && (
            <motion.span layoutId="lobby-cover" style={{ borderRadius: 12 }} className="block aspect-video w-20 shrink-0 overflow-hidden shadow-lg sm:w-24 lg:w-28" aria-hidden>
              <GameCover game={cover} />
            </motion.span>
          )}
          <h1 className="truncate text-xl font-semibold text-white/85 lg:text-2xl">{state.gameTitle}</h1>
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-6xl flex-1 overflow-y-auto pb-2">
        {players.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            {/* full width down to the poster, so on a phone it shrinks to the screen instead of hanging off it
                (less a little room for its ring) */}
            <div className="flex w-full min-w-0 flex-col items-center px-1">
              <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }} className="max-w-full">
                <motion.div
                  layoutId="lobby-cover"
                  style={{ borderRadius: 28 }}
                  className="relative aspect-video w-[min(32rem,46dvh)] max-w-full overflow-hidden shadow-2xl ring-4 ring-white/15"
                  aria-hidden
                >
                  <GameCover game={cover} />
                  <span className="shine animate-shine motion-reduce:hidden" style={{ animationDuration: '5s' }} />
                </motion.div>
              </motion.div>
              <p className="mt-6 flex items-center gap-3 text-2xl text-white/80">
                <span aria-hidden>📱</span> รอผู้เล่นเข้าห้อง <WaitingDots />
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
