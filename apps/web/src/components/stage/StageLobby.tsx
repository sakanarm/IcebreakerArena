'use client';

import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';
import { MAX_PLAYERS_PER_ROOM, type StageState } from '@icebreaker/shared';
import { burst } from '@/lib/confetti';
import { fmt } from '@/lib/format';
import { sfx } from '@/lib/sfx';
import { GameCover } from '../cover/GameCover';
import { PopNumber, WaitingDots } from '../motion-bits';

/** small stable number per player, so the wiggles don't all move in sync */
const phase = (id: string) => [...id].reduce((n, c) => n + c.charCodeAt(0), 0) % 26;
/** a name lands at a slight angle of its own, between 7 and 13 degrees either way, and straightens up */
const tilt = (id: string) => (phase(id) % 2 ? 1 : -1) * (7 + (phase(id) % 7));

export function StageLobby({
  state,
  join,
  onKick,
  onExpect,
}: {
  state: StageState;
  join: { url: string; label: string } | null;
  onKick?: (id: string, nickname: string) => void;
  /** the Host's: sets the head count to wait for, 0 for none */
  onExpect?: (count: number) => void;
}) {
  // the names already in when the screen opens are just there; from then on each one pops in, the first one too,
  // whose list only starts as they come in
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
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
    // a phone on its side: everything a size down, so the players' names still get some of the height
    <div className="flex h-full flex-col gap-5 short:gap-2">
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="mx-auto flex w-full max-w-5xl items-stretch gap-4 short:gap-3"
      >
        <div className="card flex min-w-0 flex-1 flex-col justify-center px-5 py-5 sm:px-8 short:py-2">
          <p className="text-lg text-slate-500 lg:text-xl short:text-base">
            ใช้มือถือเข้า <span className="font-semibold text-ink">{join?.label ?? '…'}</span>
            {join && <span className="max-sm:hidden"> หรือสแกน QR</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-5 short:mt-0">
            <span className="font-display text-2xl font-semibold text-slate-500 short:text-lg">PIN เกม</span>
            <span className="flex font-display text-6xl font-extrabold tracking-wider text-ink sm:text-7xl lg:text-8xl short:text-5xl" aria-label={`PIN ${state.pin}`}>
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
            className="card grid place-items-center p-3 max-sm:hidden short:p-2"
          >
            <QRCodeSVG value={join.url} size={156} level="M" marginSize={0} title="สแกนเพื่อเข้าร่วมเกม" className="short:size-24" />
          </motion.div>
        )}
      </motion.div>

      {/* on a phone the title drops under the count instead of being cut to a few letters */}
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-x-4 gap-y-3 px-1 max-sm:flex-wrap">
        <HeadCount count={state.playerCount} expected={state.expected ?? null} onExpect={onExpect} />
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
                  className="relative aspect-video w-[min(32rem,46dvh)] max-w-full overflow-hidden shadow-2xl ring-4 ring-white/15 short:w-[min(32rem,20dvh)]"
                  aria-hidden
                >
                  <GameCover game={cover} />
                  <span className="shine animate-shine motion-reduce:hidden" style={{ animationDuration: '5s' }} />
                </motion.div>
              </motion.div>
              <p className="mt-6 flex items-center gap-3 text-2xl text-white/80 short:mt-2 short:text-lg">
                <span aria-hidden>📱</span> รอผู้เล่นเข้าห้อง <WaitingDots />
              </p>
            </div>
          </div>
        ) : (
          <ul className="flex flex-wrap content-start justify-center gap-3">
            <AnimatePresence initial={live}>
              {players.map((p) => (
                <motion.li
                  key={p.id}
                  layout
                  initial={{ scale: 0, opacity: 0, rotate: tilt(p.id) }}
                  animate={{ scale: 1, opacity: p.connected ? 1 : 0.45, rotate: 0 }}
                  exit={{ scale: 0, opacity: 0, rotate: -tilt(p.id) }}
                  // the first name waits for the poster to shrink away first: that is the screen's heaviest frame,
                  // and a slow screen that drops it would take the start of the name's pop with it
                  transition={{
                    type: 'spring',
                    stiffness: 520,
                    damping: 26,
                    delay: players.length === 1 ? 0.18 : 0,
                    layout: { type: 'spring', stiffness: 520, damping: 26 },
                  }}
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

/**
 * How many are in. Once the Host sets how many they wait for, it counts toward that with a bar, and as the last of
 * them comes in a "พร้อมแล้ว!" badge pops up beside it, with a chime and a little confetti.
 */
function HeadCount({ count, expected, onExpect }: { count: number; expected: number | null; onExpect?: (count: number) => void }) {
  const ready = expected !== null && count >= expected;
  const [draft, setDraft] = useState<string | null>(null);
  // Escape closes the field, and the blur that may come as it goes must not save it
  const dropped = useRef(false);
  const badge = useRef<HTMLSpanElement>(null);

  // as it happens, not when a screen opens on a lobby that is ready already
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current) {
      sfx.play('ready');
      // from the badge, which is still a dot at its middle as it starts to grow
      const r = badge.current?.getBoundingClientRect();
      if (r) burst({ x: (r.left + r.width / 2) / innerWidth, y: (r.top + r.height / 2) / innerHeight }, 70);
    }
    wasReady.current = ready;
  }, [ready]);

  const save = () => {
    if (draft === null) return;
    const n = Math.min(MAX_PLAYERS_PER_ROOM, Number.parseInt(draft, 10) || 0);
    if (n !== (expected ?? 0)) onExpect?.(n);
    setDraft(null);
  };

  return (
    <>
      <div
        data-count
        className={`glass relative flex shrink-0 items-center gap-3 overflow-hidden px-5 py-2 transition-shadow short:py-1 ${ready ? 'ring-2 ring-good' : ''}`}
      >
        <span className="text-3xl short:text-2xl" aria-hidden>
          👥
        </span>
        <span className="flex items-baseline gap-2">
          <PopNumber value={count} className="font-display text-4xl font-extrabold short:text-3xl" />
          {draft !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              className="flex items-baseline gap-2"
            >
              <span className="font-display text-2xl text-white/60 short:text-xl">/</span>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
                onFocus={(e) => e.target.select()}
                onBlur={() => dropped.current || save()}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return;
                  dropped.current = true;
                  setDraft(null);
                }}
                inputMode="numeric"
                placeholder="จำนวน"
                aria-label="จำนวนผู้เล่นที่รอ (เว้นว่างไว้ถ้าไม่ตั้ง)"
                className="w-20 self-center rounded-lg bg-white px-2 py-0.5 text-center font-display text-2xl font-bold text-ink outline-none placeholder:text-base placeholder:font-normal placeholder:text-slate-400 short:text-xl"
              />
              <button type="submit" className="self-center rounded-full bg-good px-3 py-1 font-semibold text-white">
                ตั้ง
              </button>
            </form>
          ) : (
            // past the count set, "66 / 6" would read as a mistake: the count alone, with the badge beside it
            expected !== null &&
            count <= expected && (
              <span className="font-display text-2xl font-semibold text-white/60 short:text-xl">/ {fmt(expected)}</span>
            )
          )}
        </span>
        {draft === null && <span className="text-lg whitespace-nowrap text-white/70">ผู้เล่น</span>}
        {onExpect && draft === null && (
          <button
            type="button"
            onClick={() => {
              dropped.current = false;
              setDraft(expected === null ? '' : String(expected));
            }}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-lg transition-colors hover:bg-white/25 short:size-7 short:text-base"
            title={expected === null ? 'ตั้งจำนวนผู้เล่นที่รอ จอจะขึ้น "พร้อมแล้ว!" เมื่อมาครบ' : 'เปลี่ยนจำนวนผู้เล่นที่รอ'}
            aria-label="ตั้งจำนวนผู้เล่นที่รอ"
          >
            🎯
          </button>
        )}
        {expected !== null && draft === null && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-white/10" aria-hidden>
            <motion.span
              data-bar
              className={`block h-full origin-left ${ready ? 'bg-good' : 'bg-gold'}`}
              initial={false}
              animate={{ scaleX: Math.min(1, count / Math.max(1, expected)) }}
              transition={{ type: 'spring', stiffness: 160, damping: 22 }}
            />
          </span>
        )}
      </div>
      <AnimatePresence>
        {ready && (
          <motion.span
            ref={badge}
            data-ready
            initial={{ scale: 0, rotate: -18 }}
            animate={{ scale: 1, rotate: -3 }}
            // not on the bouncy spring it came in on, which would take it past nothing and back, mirrored
            exit={{ scale: 0, opacity: 0, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 14 }}
            className="relative shrink-0 overflow-hidden rounded-full bg-good px-5 py-1.5 font-display text-2xl font-extrabold whitespace-nowrap text-white shadow-lg short:py-0.5 short:text-lg"
            role="status"
          >
            {/* the emoji at its plain weight: a heavy one has the browser look for a bold emoji font first, which
                takes it most of a frame, right as the badge pops */}
            พร้อมแล้ว! <span className="font-normal">🎉</span>
            <span className="shine animate-shine motion-reduce:hidden" />
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}
