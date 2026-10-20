'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { PlayerState } from '@icebreaker/shared';
import { withBase } from '@/lib/paths';
import { sfx } from '@/lib/sfx';
import { keys } from '@/lib/storage';
import { usePlayer } from '@/lib/use-player';
import { useSound, type SoundControl } from '@/lib/use-sound';
import { useWakeLock } from '@/lib/use-wake-lock';
import { CountUp } from '../motion-bits';
import { Connecting, Notice } from '../Notice';
import { JoinName } from './JoinName';
import { JoinPin } from './JoinPin';
import { PlayerQuestion } from './PlayerQuestion';
import { PlayerResult } from './PlayerResult';
import { PlayerFinal, PlayerLobby, PlayerRank, PlayerRound } from './PlayerScreens';

type Player = ReturnType<typeof usePlayer>;

/** Everything on a player's phone, from typing the PIN to the final medal. */
export function PlayerApp({ initialPin }: { initialPin: string | null }) {
  const player = usePlayer(initialPin);
  const sound = useSound(keys.phoneSound, false);
  const { status, state, pin, error } = player;
  useWakeLock(status === 'playing');

  if (status === 'checking') return <Connecting label="กำลังเข้าห้อง" />;
  if (status === 'need_pin') return <JoinPin onSubmit={player.checkPin} error={error} />;
  if (status === 'need_name' || status === 'joining') {
    return <JoinName title={player.roomTitle} pin={pin ?? ''} busy={status === 'joining'} error={error} onSubmit={player.join} />;
  }
  if (status === 'kicked') {
    return (
      <Notice
        emoji="👋"
        title="คุณถูกนำออกจากห้อง"
        actions={
          <button type="button" onClick={() => void player.leave()} className="btn btn-light">
            ใส่ PIN ใหม่
          </button>
        }
      >
        ผู้จัดนำชื่อนี้ออกจากเกมแล้ว ถ้าเป็นความเข้าใจผิด ลองเข้าห้องใหม่อีกครั้ง
      </Notice>
    );
  }
  if (status === 'closed') {
    return (
      <Notice
        emoji="🏁"
        title="ห้องนี้ปิดแล้ว"
        actions={
          <a href={withBase('/play')} className="btn btn-light">
            ใส่ PIN ใหม่
          </a>
        }
      >
        ขอบคุณที่ร่วมสนุก! มีเกมใหม่เมื่อไหร่ ใส่ PIN ได้เลย
      </Notice>
    );
  }
  if (!state) return <Connecting label="กำลังเข้าห้อง" />;
  return <InGame state={state} player={player} sound={sound} />;
}

function InGame({ state, player, sound }: { state: PlayerState; player: Player; sound: SoundControl }) {
  const { phase, me, question: q } = state;
  const showNumber = q && (phase === 'question' || phase === 'reveal');
  const showFooter = phase !== 'lobby' && phase !== 'podium';
  const sceneKey =
    phase === 'question' || phase === 'reveal' ? `${phase}-${q?.id}` : phase === 'round' ? `round-${state.round?.index}` : phase;

  // the same music as the big screen; it only plays once the player turns sound on
  useEffect(() => {
    if (phase !== 'lobby' && phase !== 'question') return;
    sfx.music(phase);
    return () => sfx.music(null);
  }, [phase]);

  return (
    <div className="flex min-h-dvh flex-col">
      <OfflineBanner online={player.online} />

      {/* z-10: the result / round screens paint a full-screen color layer behind the content */}
      <header className="relative z-10 flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <span className="shrink-0 rounded-full bg-black/25 px-3 py-1 font-display text-sm font-semibold tabular-nums">PIN {state.pin}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-white/80">{state.gameTitle}</span>
        {showNumber && (
          <span className="shrink-0 rounded-full bg-black/25 px-3 py-1 text-sm font-semibold tabular-nums">
            ข้อ {q.number}/{q.total}
          </span>
        )}
        <SoundButton sound={sound} />
      </header>

      <main className="relative flex flex-1 flex-col px-4 py-3">
        {/* opacity only: a transform here would trap the screens' fixed color layers inside this box */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={sceneKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-1 flex-col"
          >
            {phase === 'lobby' && <PlayerLobby me={me} onLeave={() => void player.leave(true)} />}
            {phase === 'round' && state.round && <PlayerRound round={state.round} />}
            {phase === 'question' && q && (
              <PlayerQuestion q={q} myAnswer={player.myAnswer} late={player.late} onAnswer={(sent) => void player.answer(q.id, sent)} />
            )}
            {phase === 'reveal' && <PlayerResult state={state} />}
            {phase === 'leaderboard' && <PlayerRank me={me} />}
            {phase === 'podium' && <PlayerFinal me={me} onPlayAgain={() => void player.leave()} />}
          </motion.div>
        </AnimatePresence>
      </main>

      {showFooter && (
        <footer className="relative z-10 flex items-center gap-3 bg-black/25 px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <span className="text-3xl" aria-hidden>
            {me.avatar}
          </span>
          <span className="min-w-0 flex-1 truncate font-semibold">{me.nickname}</span>
          <span className="rounded-full bg-white px-4 py-1 font-display text-lg font-extrabold text-ink">
            <Score value={me.score} />
          </span>
        </footer>
      )}
    </div>
  );
}

/**
 * Phones start muted so a room full of them stays quiet; whoever wants the music
 * turns it on here. Spelled out while off, since a bare 🔇 is easy to miss.
 */
function SoundButton({ sound }: { sound: SoundControl }) {
  // on, but the browser still waits for a tap (a reload remembers "on" but not the tap)
  if (sound.blocked) {
    return (
      <button type="button" onClick={sound.unlock} className="shrink-0 animate-pulse rounded-full bg-gold px-3 py-1 text-sm font-semibold text-ink">
        🔈 แตะเพื่อเปิดเสียง
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={sound.toggle}
      aria-pressed={sound.on}
      aria-label={sound.on ? 'ปิดเพลงและเสียง' : 'เปิดเพลงและเสียง'}
      className={`flex h-9 shrink-0 items-center justify-center gap-1 rounded-full bg-black/25 text-lg ${sound.on ? 'w-9' : 'px-3'}`}
    >
      {sound.on ? '🔊' : <>🔇<span className="text-sm font-semibold">เปิดเพลง</span></>}
    </button>
  );
}

/** Counts from the last score shown to the new one, so points visibly land after each reveal. */
function Score({ value }: { value: number }) {
  const [shown, setShown] = useState({ from: value, to: value });
  if (value !== shown.to) setShown({ from: shown.to, to: value });
  return <CountUp from={shown.from} to={shown.to} duration={1} delay={0.4} />;
}

function OfflineBanner({ online }: { online: boolean }) {
  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          role="status"
          initial={{ y: '-100%' }}
          animate={{ y: 0 }}
          exit={{ y: '-100%' }}
          className="fixed inset-x-0 top-0 z-50 bg-bad px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 text-center text-sm font-semibold shadow-lg"
        >
          สัญญาณหลุด กำลังเชื่อมต่อใหม่… คะแนนของคุณยังอยู่ครบ
        </motion.div>
      )}
    </AnimatePresence>
  );
}
