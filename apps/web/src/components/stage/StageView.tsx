'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import type { StageState } from '@icebreaker/shared';
import { sfx } from '@/lib/sfx';
import type { SoundControl } from '@/lib/use-sound';
import { FloatingShapes, Logo } from '../shapes';
import { StageLeaderboard } from './StageLeaderboard';
import { StageLobby } from './StageLobby';
import { StagePodium } from './StagePodium';
import { StageQuestion } from './StageQuestion';
import { StageReveal } from './StageReveal';
import { StageRoundIntro } from './StageRoundIntro';

interface Props {
  state: StageState;
  join: { url: string; label: string } | null;
  sound: SoundControl;
  online: boolean;
  onKick?: (id: string, nickname: string) => void;
  /** the Host's control dock sits under the stage */
  docked?: boolean;
}

/** The big screen: one scene per phase, each with its own entrance. */
export function StageView({ state, join, sound, online, onKick, docked = false }: Props) {
  // the leaderboard has no current question, but its header still says which one just ended
  const [lastQ, setLastQ] = useState<{ id: string; number: number; total: number } | null>(null);
  if (state.question && state.question.id !== lastQ?.id) setLastQ(state.question);

  useEffect(() => {
    // question music belongs to the open question itself (it stops on reveal)
    if (state.phase === 'lobby') sfx.music('lobby');
    else if (state.phase !== 'question') sfx.music(null);
  }, [state.phase]);

  const showCounter = lastQ && state.phase !== 'lobby' && state.phase !== 'podium';

  return (
    <div className={`relative flex h-dvh flex-col overflow-hidden ${docked ? 'pb-24' : ''}`}>
      <FloatingShapes opacity={state.phase === 'lobby' ? 0.14 : 0.08} />
      <header className="relative z-10 flex items-center gap-3 px-6 pt-4 pb-2 lg:px-10">
        <Logo small />
        <div className="flex-1" />
        {showCounter && (
          <span className="glass px-4 py-1.5 font-display text-lg font-semibold">
            ข้อ {lastQ.number} / {lastQ.total}
          </span>
        )}
        {!docked && state.phase !== 'lobby' && (
          <span className="rounded-full bg-white px-4 py-1.5 font-display text-lg font-extrabold tracking-wider text-ink">PIN {state.pin}</span>
        )}
        {!online && <span className="animate-pulse rounded-full bg-bad px-4 py-1.5 font-semibold">กำลังเชื่อมต่อใหม่…</span>}
        {/* a freshly opened projector tab stays silent until someone clicks on it */}
        {sound.blocked && (
          <button type="button" onClick={sound.unlock} className="animate-pulse rounded-full bg-gold px-4 py-1.5 font-semibold text-ink">
            🔈 คลิกเพื่อเปิดเสียง
          </button>
        )}
        <TopButton onClick={sound.toggle} label={sound.on ? 'ปิดเสียง' : 'เปิดเสียง'}>
          {sound.on ? '🔊' : '🔇'}
        </TopButton>
        <FullscreenButton />
      </header>
      <main className="relative min-h-0 flex-1 px-6 pb-5 lg:px-10">
        <AnimatePresence mode="wait">
          <motion.section
            key={sceneKey(state, lastQ?.id)}
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <Scene state={state} join={join} onKick={onKick} />
          </motion.section>
        </AnimatePresence>
      </main>
    </div>
  );
}

function sceneKey(state: StageState, lastQuestionId: string | undefined) {
  switch (state.phase) {
    case 'round':
      return `round-${state.round?.index}`;
    case 'question':
    case 'reveal':
      return `${state.phase}-${state.question?.id}`;
    case 'leaderboard':
      return `leaderboard-${lastQuestionId}`;
    default:
      return state.phase;
  }
}

function Scene({ state, join, onKick }: Pick<Props, 'state' | 'join' | 'onKick'>) {
  switch (state.phase) {
    case 'lobby':
      return <StageLobby state={state} join={join} onKick={onKick} />;
    case 'round':
      return state.round && <StageRoundIntro round={state.round} />;
    case 'question':
      return state.question && <StageQuestion state={state} />;
    case 'reveal':
      return state.question && state.reveal && <StageReveal state={state} />;
    case 'leaderboard':
      return <StageLeaderboard state={state} />;
    case 'podium':
      return <StagePodium state={state} />;
  }
}

function TopButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center rounded-full bg-white/10 text-xl transition-colors hover:bg-white/20"
    >
      {children}
    </button>
  );
}

function FullscreenButton() {
  const [full, setFull] = useState(false);

  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else document.documentElement.requestFullscreen?.()?.catch(() => {});
  };

  return (
    <TopButton onClick={toggle} label={full ? 'ออกจากเต็มจอ' : 'เต็มจอ'}>
      {full ? '🗗' : '⛶'}
    </TopButton>
  );
}
