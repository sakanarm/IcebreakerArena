'use client';

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Phase } from '@icebreaker/shared';
import { ANSWER_BG, AnswerShape } from '../shapes';

// a new round opens with its own full-screen intro, and a reveal stays on its question
const WIPED: ReadonlySet<Phase> = new Set(['question', 'leaderboard', 'podium']);
export const wipesInto = (phase: Phase) => WIPED.has(phase);

/** how much of the screen the blinds hide: none of it, part of it (they are on their way), or all of it */
export type Cover = 'none' | 'shutting' | 'shut';

/** the blinds are shut over the whole screen (the stage provides it) */
export const BlindsShut = createContext(false);
/**
 * True while the blinds are shut over a scene that has just mounted under them: what it holds back until this goes
 * false comes in as they open, so its entrance is the first thing the room sees of it. Never true without the
 * blinds (reduced motion, a reload).
 */
export const useBlindsShut = () => useContext(BlindsShut);

// column k moves k × STAGGER_MS after the first: it shuts in SHUT_MS, stays shut, then opens in OPEN_MS
const STAGGER_MS = 20;
const SHUT_MS = 180;
const OPEN_MS = 160;
/** the last column stays shut at least this long, so the four shapes register: 0.6 s in all */
const HOLD_MS = 140;
/** the new scene gets a frame or two to paint before the blinds move */
const PAINT_MS = 50;
/** they count as shut, and later open, even if the browser never says so (a hidden tab draws no frames) */
const GIVE_UP_MS = 1500;

interface Blinds {
  /** a new id remounts the columns, so each move starts its animations afresh */
  id: number;
  mode: 'shut' | 'open';
  /** when this move started, on performance.now() */
  at: number;
  /** shutting again halfway through an opening: how far each column had opened, in ms of its opening */
  back?: number[];
  /** when the last column got there and the screen was all covered, on performance.now() */
  full?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/**
 * How long a column's animation has run, delay included: from its start time by the real clock, since the
 * animations' own clock moves on only with each frame and a busy page can go a while without one (the
 * compositor keeps the columns moving all the same). One not started yet has not moved.
 */
const clock = (el: Element) => {
  const a = el.getAnimations()[0];
  if (typeof a?.startTime === 'number') return performance.now() - a.startTime;
  const t = a?.currentTime;
  return typeof t === 'number' ? t : 0;
};

/**
 * The blinds between two scenes of the big screen: the four answer colors shut over the old scene one after
 * another, stay shut until the new scene is on screen under them, and open again, 0.6 s in all. CSS keyframes
 * (wipe-* in globals.css) run on the compositor, so they stay smooth while React mounts the new scene.
 * `run` goes up once for every scene change that wipes; `ready` says the newest scene has mounted; `onCover`
 * hears how much they hide, so the old scene goes only once it is out of sight, and a scene that changes under
 * them needs no fade of its own. Not shown under reduced motion.
 */
export function SceneWipe({ run, ready, onCover }: { run: number; ready: boolean; onCover: (cover: Cover) => void }) {
  const [blinds, setBlinds] = useState<Blinds | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cover: Cover = blinds?.mode !== 'shut' ? 'none' : blinds.full === undefined ? 'shutting' : 'shut';
  useLayoutEffect(() => onCover(cover), [cover, onCover]);

  // before paint, so the old scene never shows a frame without the blinds on their way
  useLayoutEffect(() => {
    if (!run) return;
    const now = performance.now();
    // how far each column of an opening on screen has got: under load it starts late
    const el = ref.current;
    const opening = el?.dataset.wipe === 'open' ? { id: Number(el.dataset.id), t: [...el.children].map(clock) } : null;
    setBlinds((b) => {
      // already shut or shutting: the newer scene mounts under the same cover
      if (b?.mode === 'shut') return b;
      const id = (b?.id ?? 0) + 1;
      if (!b) return { id, mode: 'shut', at: now };
      // an opening not on screen yet has not moved at all
      const t = opening?.id === b.id ? opening.t : [0, 0, 0, 0];
      const back = t.map((x, k) => clamp(x - k * STAGGER_MS, 0, OPEN_MS));
      // halfway open: they go back the way they came, from where they are
      return back[3] < OPEN_MS ? { id, mode: 'shut', at: now, back } : { id, mode: 'shut', at: now };
    });
  }, [run]);

  // shut once every column says it is, and gone once every column has opened: they keep their own clock, which
  // can start late under load, so a timer of ours would let the old scene go while part of it still shows, or
  // take the blinds away halfway open
  useEffect(() => {
    if (!blinds || blinds.full !== undefined) return;
    const { id, at, mode } = blinds;
    let live = true;
    const done = () => {
      if (!live) return;
      if (mode === 'open') setBlinds((b) => (b?.id === id ? null : b));
      else setBlinds((b) => (b?.id === id && b.full === undefined ? { ...b, full: performance.now() } : b));
    };
    // a move cut short (the blinds hidden for reduced motion) leaves nothing to wait for either
    const moves = ref.current?.getAnimations({ subtree: true }) ?? [];
    Promise.all(moves.map((m) => m.finished)).then(done, done);
    const t = setTimeout(done, at + GIVE_UP_MS - performance.now());
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [blinds]);

  useEffect(() => {
    if (blinds?.mode !== 'shut' || blinds.full === undefined) return;
    const now = performance.now();
    // open once the newest scene is on screen, but not before the shapes have had their moment
    const at = ready ? Math.max(blinds.full + HOLD_MS, now + PAINT_MS) : blinds.full + GIVE_UP_MS;
    const t = setTimeout(() => setBlinds({ id: blinds.id + 1, mode: 'open', at: performance.now() }), at - now);
    return () => clearTimeout(t);
  }, [blinds, ready]);

  if (!blinds) return null;
  const { id, mode, back } = blinds;
  const move = mode === 'open' || back ? 'open' : 'shut';
  return (
    // over the scene and its header, under the Host's dock (z-40); clicks go through
    <div
      ref={ref}
      key={id}
      aria-hidden
      data-id={id}
      data-wipe={back ? 'back' : mode}
      className="wipe pointer-events-none fixed inset-0 z-30 overflow-hidden"
    >
      {[0, 1, 2, 3].map((k) => {
        const up = k % 2 === 1;
        // going back plays the opening in reverse, starting where each column had got to
        const timing: React.CSSProperties = back
          ? { animationDuration: `${OPEN_MS}ms`, animationDelay: `${back[k] - OPEN_MS}ms`, animationDirection: 'reverse' }
          : { animationDuration: `${mode === 'shut' ? SHUT_MS : OPEN_MS}ms`, animationDelay: `${k * STAGGER_MS}ms` };
        return (
          <div
            key={k}
            className={`absolute inset-y-0 grid place-items-center ${ANSWER_BG[k]} wipe-${move}-${up ? 'up' : 'down'} ${up ? 'pt-[14vh]' : 'pb-[14vh]'}`}
            // a pixel of overlap, so no hairline shows between two columns on an odd screen width
            style={{ left: `${k * 25}%`, width: 'calc(25% + 1px)', ...timing }}
          >
            <div className={`wipe-spin-${move === 'open' ? 'out' : 'in'}${up ? '-back' : ''}`} style={timing}>
              <AnswerShape index={k} className="size-[min(18vw,30vh)] text-white" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
