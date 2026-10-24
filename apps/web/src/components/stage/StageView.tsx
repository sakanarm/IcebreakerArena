'use client';

import { AnimatePresence, motion, usePresence, usePresenceData, useReducedMotion, type Variants } from 'motion/react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { StageState } from '@icebreaker/shared';
import { sfx } from '@/lib/sfx';
import type { SoundControl } from '@/lib/use-sound';
import { FloatingShapes, Logo } from '../shapes';
import { BlindsShut, type Cover, SceneWipe, useBlindsShut, wipesInto } from './SceneWipe';
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
  onExpect?: (count: number) => void;
  /** the Host's control dock sits under the stage */
  docked?: boolean;
}

const FADE_S = 0.2;
// a wiped scene comes and goes under the blinds' full cover, so it needs no fade of its own: Hold keeps the old
// one as it is until the blinds are shut over it
const SCENE: Variants = {
  enter: (wiped: boolean) => ({ opacity: wiped ? 1 : 0 }),
  shown: { opacity: 1 },
  gone: (wiped: boolean) => (wiped ? {} : { opacity: 0, transition: { duration: FADE_S } }),
};

/** The big screen: one scene per phase, each with its own entrance. */
export function StageView({ state, join, sound, online, onKick, onExpect, docked = false }: Props) {
  // the leaderboard has no current question, but its header still says which one just ended
  const [lastQ, setLastQ] = useState<{ id: string; number: number; total: number } | null>(null);
  if (state.question && state.question.id !== lastQ?.id) setLastQ(state.question);

  const reduce = useReducedMotion();
  const key = sceneKey(state, state.question?.id ?? lastQ?.id);
  // the wipe marks a change of scene, so there is none for the first one (a reload, or a screen opened mid-game)
  const [scene, setScene] = useState({ key, wipes: 0 });
  if (scene.key !== key) setScene({ key, wipes: scene.wipes + (!reduce && wipesInto(state.phase) ? 1 : 0) });
  // a scene that changes while the blinds are shutting or shut swaps under them as well
  const [cover, setCover] = useState<Cover>('none');
  const wiped = !reduce && ((scene.wipes > 0 && wipesInto(state.phase)) || cover !== 'none');
  // the scene in the page, and the question it came in with: the blinds stay shut until the newest one is in,
  // and the header's counter changes with it, out of sight
  const [shown, setShown] = useState({ key, q: lastQ });

  useEffect(() => {
    // question music belongs to the open question itself (it stops on reveal)
    if (state.phase === 'lobby') sfx.music('lobby');
    else if (state.phase !== 'question') sfx.music(null);
  }, [state.phase]);

  const counter = shown.key !== 'lobby' && shown.key !== 'podium' ? shown.q : null;

  // a scene that had to scroll leaves the next one starting at its top
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [shown.key]);

  return (
    // the dock measures itself (two rows on a phone, a slimmer one on a phone on its side); until it has, a guess
    <div className={`relative flex h-dvh flex-col overflow-hidden ${docked ? 'pb-[var(--dock-h,6rem)]' : ''}`}>
      <FloatingShapes opacity={state.phase === 'lobby' ? 0.14 : 0.08} />
      <header className="relative z-10 flex items-center gap-2 px-4 pt-3 pb-2 sm:gap-3 sm:px-6 sm:pt-4 short:pt-2 short:pb-1 lg:px-10">
        <Logo small compact />
        {/* one row on a phone too: what doesn't fit (a reconnect and a muted tab at once) goes onto a second */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:gap-3">
          {counter && (
            <span className="glass px-3 py-1 font-display text-base font-semibold whitespace-nowrap sm:px-4 sm:py-1.5 sm:text-lg short:py-1 short:text-base">
              ข้อ {counter.number} / {counter.total}
            </span>
          )}
          {!docked && state.phase !== 'lobby' && (
            <span className="rounded-full bg-white px-3 py-1 font-display text-base font-extrabold tracking-wider whitespace-nowrap text-ink sm:px-4 sm:py-1.5 sm:text-lg">
              PIN {state.pin}
            </span>
          )}
          {!online && (
            <span className="animate-pulse rounded-full bg-bad px-3 py-1 text-sm font-semibold whitespace-nowrap sm:px-4 sm:py-1.5 sm:text-base">
              <span className="max-sm:hidden">กำลัง</span>เชื่อมต่อใหม่…
            </span>
          )}
          {/* a freshly opened projector tab stays silent until someone clicks on it */}
          {sound.blocked && (
            <button
              type="button"
              onClick={sound.unlock}
              className="animate-pulse rounded-full bg-gold px-3 py-1 text-sm font-semibold whitespace-nowrap text-ink sm:px-4 sm:py-1.5 sm:text-base"
            >
              🔈 <span className="max-sm:hidden">คลิกเพื่อ</span>เปิดเสียง
            </button>
          )}
          <TopButton onClick={sound.toggle} label={sound.on ? 'ปิดเสียง' : 'เปิดเสียง'}>
            {sound.on ? '🔊' : '🔇'}
          </TopButton>
          <FullscreenButton />
        </div>
      </header>
      {/* the longest questions and answers can need more height than a phone (or a laptop) has: then the scene
          scrolls, as its parts never squeeze below what they hold (without a bar, which would flash up as tiles
          slide in from below) */}
      <main
        ref={mainRef}
        className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pb-4 [scrollbar-width:none] sm:px-6 sm:pb-5 short:pb-2 lg:px-10"
      >
        <BlindsShut.Provider value={cover === 'shut'}>
          {/* the leaving scene was rendered before anyone knew what comes next, so it gets custom from here */}
          <AnimatePresence mode="wait" custom={wiped}>
            <motion.section
              key={key}
              data-scene={key}
              custom={wiped}
              className="h-full"
              variants={SCENE}
              initial="enter"
              animate="shown"
              exit="gone"
            >
              <Scene state={state} join={join} onKick={onKick} onExpect={onExpect} />
              <Mounted value={{ key, q: lastQ }} onMount={setShown} />
              <Hold />
            </motion.section>
          </AnimatePresence>
        </BlindsShut.Provider>
      </main>
      <SceneWipe run={reduce ? 0 : scene.wipes} ready={shown.key === key} onCover={setCover} />
    </div>
  );
}

/** Says a scene is in the page, with what it came in with: once it is in the DOM, before the browser paints it. */
function Mounted<T>({ value, onMount }: { value: T; onMount: (value: T) => void }) {
  // every scene has its own, so this runs once per scene
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => onMount(value), []);
  return null;
}

/**
 * Keeps a leaving scene in the page until it may go: a wiped one until the blinds are shut over all of it (they
 * run on their own clock, which under load can lag behind ours), any other until it has faded out, so a wipe that
 * starts during the fade still finds it there. Its props froze when it left, so what it waits on comes by context.
 */
function Hold() {
  const [present, safeToRemove] = usePresence();
  const wiped = usePresenceData() === true;
  const shut = useBlindsShut();
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (present) return;
    const t = setTimeout(() => setFaded(true), FADE_S * 1000);
    return () => clearTimeout(t);
  }, [present]);

  // in the same commit the blinds shut in, so the new scene mounts under them straight away
  useLayoutEffect(() => {
    if (!present && (wiped ? shut : faded)) safeToRemove?.();
  }, [present, wiped, shut, faded, safeToRemove]);
  return null;
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

// the stage renders again each time the blinds move, and the scene under them has no need to: on a slow screen
// that work would hold up the blinds' next frame
const Scene = memo(function Scene({ state, join, onKick, onExpect }: Pick<Props, 'state' | 'join' | 'onKick' | 'onExpect'>) {
  switch (state.phase) {
    case 'lobby':
      return <StageLobby state={state} join={join} onKick={onKick} onExpect={onExpect} />;
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
});

function TopButton({ onClick, label, className = '', children }: { onClick: () => void; label: string; className?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid size-10 shrink-0 place-items-center rounded-full bg-white/10 text-lg transition-colors hover:bg-white/20 sm:size-11 sm:text-xl short:size-9 short:text-lg ${className}`}
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
    // a phone's browser has no full screen for a page (iPhone) or fills the screen already
    <TopButton onClick={toggle} label={full ? 'ออกจากเต็มจอ' : 'เต็มจอ'} className="max-sm:hidden">
      {full ? '🗗' : '⛶'}
    </TopButton>
  );
}
