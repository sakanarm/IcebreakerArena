'use client';

import { coverColor, coverSeed, type Game } from '@icebreaker/shared';
import { useId, useMemo, type ReactNode } from 'react';
import { ArtDrawing } from './arts';
import { COVER_SHADES, type CoverShades } from './palette';
import { Backdrop, H, Shape, Sparkle, W, r1 } from './parts';

/** small fast random numbers: the same seed draws the same cover everywhere */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T,>(rand: Rand, list: readonly T[]): T => list[Math.floor(rand() * list.length)];
const between = (rand: Rand, lo: number, hi: number) => r1(lo + rand() * (hi - lo));

/** where the emoji sits; patterns leave room around it */
const BADGE = { x: W / 2, y: H / 2, r: 42 };
const nearBadge = (x: number, y: number, gap: number) => Math.hypot(x - BADGE.x, y - BADGE.y) < BADGE.r + gap;

/*
 * Each pattern draws every random number it may need for a spot before deciding what to draw
 * there, so adding or removing the emoji clears its middle without reshuffling the rest.
 */

/** Bauhaus tiles: quarter and half circles, triangles, rings and our shapes on a 60 grid */
function tiles(rand: Rand, c: CoverShades, clear: boolean): ReactNode[] {
  const S = 60;
  const out: ReactNode[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 6; col++) {
      const x = col * S - 20;
      const y = row * S;
      const [cx, cy] = [x + S / 2, y + S / 2];
      const tinted = rand() < 0.35;
      const tint = pick(rand, [c.deep, c.light]);
      const fill = pick(rand, [c.deep, c.deep, c.light, c.light, c.pop, '#ffffff']);
      const motif = pick(rand, ['quarter', 'quarter', 'half', 'circle', 'ring', 'tri', 'shape', 'dots', 'blank'] as const);
      const turn = Math.floor(rand() * 4) * 90;
      const shape = Math.floor(rand() * 4);
      const tilt = pick(rand, [-15, 0, 15]);
      const k = `${row}-${col}`;
      if (tinted) out.push(<rect key={`t${k}`} x={x} y={y} width={S} height={S} fill={tint} opacity={0.22} />);
      if (clear && nearBadge(cx, cy, 0)) continue;
      // corner pieces are drawn for the top left, then turned around the tile's middle
      const turned = `rotate(${turn} ${cx} ${cy})`;
      if (motif === 'quarter') out.push(<path key={k} d={`M${x} ${y}H${x + S}A${S} ${S} 0 0 1 ${x} ${y + S}Z`} transform={turned} fill={fill} />);
      else if (motif === 'half') out.push(<path key={k} d={`M${x} ${y}H${x + S}A${S / 2} ${S / 2} 0 0 1 ${x} ${y}Z`} transform={turned} fill={fill} />);
      else if (motif === 'tri') out.push(<path key={k} d={`M${x} ${y}H${x + S}L${x} ${y + S}Z`} transform={turned} fill={fill} />);
      else if (motif === 'circle') out.push(<circle key={k} cx={cx} cy={cy} r={S * 0.36} fill={fill} />);
      else if (motif === 'ring') out.push(<circle key={k} cx={cx} cy={cy} r={S * 0.28} stroke={fill} strokeWidth={8} fill="none" />);
      else if (motif === 'shape') out.push(<Shape key={k} i={shape} x={cx} y={cy} size={40} rotate={tilt} fill={fill} />);
      else if (motif === 'dots') {
        for (let i = 0; i < 9; i++) out.push(<circle key={`${k}-${i}`} cx={cx + ((i % 3) - 1) * 16} cy={cy + (Math.floor(i / 3) - 1) * 16} r={3.2} fill={fill} />);
      }
    }
  }
  return out;
}

/** confetti: our four shapes, dots and squiggles thrown over two soft blobs */
function confetti(rand: Rand, c: CoverShades, clear: boolean): ReactNode[] {
  const out: ReactNode[] = [
    <circle key="b1" cx={between(rand, 0, 80)} cy={between(rand, 120, 180)} r={96} fill={c.deep} opacity={0.3} />,
    <circle key="b2" cx={between(rand, 240, 320)} cy={between(rand, 0, 60)} r={80} fill={c.light} opacity={0.25} />,
  ];
  const cols = 7;
  const rows = 4;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const skip = rand() < 0.2;
      const x = r1((col + 0.5 + (rand() - 0.5) * 0.6) * (W / cols));
      const y = r1((row + 0.5 + (rand() - 0.5) * 0.6) * (H / rows));
      const kind = rand();
      const fill = pick(rand, [c.light, c.light, '#ffffff', '#ffffff', c.pop, c.deep]);
      const shape = Math.floor(rand() * 4);
      const size = between(rand, 18, 34);
      const tilt = between(rand, -35, 35);
      const k = `${row}-${col}`;
      if (skip || (clear && nearBadge(x, y, 22))) continue;
      if (kind < 0.62) out.push(<Shape key={k} i={shape} x={x} y={y} size={size} rotate={tilt} fill={fill} />);
      else if (kind < 0.8) out.push(<circle key={k} cx={x} cy={y} r={r1(size / 4)} fill={fill} />);
      else {
        out.push(
          <path key={k} d={`M${x - 12} ${y}q6 -8 12 0t12 0`} transform={`rotate(${tilt} ${x} ${y})`} stroke={fill} strokeWidth={4} strokeLinecap="round" fill="none" />,
        );
      }
    }
  }
  return out;
}

/** a game-show sunburst from a glow below, with a big shape in the far corner and sparkles */
function burst(rand: Rand, c: CoverShades, clear: boolean): ReactNode[] {
  const cx = between(rand, 30, 290);
  const cy = between(rand, 150, 210);
  const n = 20;
  const turn = rand() * Math.PI;
  const out: ReactNode[] = [];
  for (let k = 0; k < n; k += 2) {
    const a1 = turn + (k * 2 * Math.PI) / n;
    const a2 = turn + ((k + 1) * 2 * Math.PI) / n;
    const at = (a: number) => `${r1(cx + 520 * Math.cos(a))} ${r1(cy + 520 * Math.sin(a))}`;
    out.push(<path key={`r${k}`} d={`M${cx} ${cy}L${at(a1)}L${at(a2)}Z`} fill={c.light} opacity={0.17} />);
  }
  out.push(<circle key="glow" cx={cx} cy={cy} r={64} fill={c.light} opacity={0.3} />);
  out.push(<circle key="core" cx={cx} cy={cy} r={34} fill={c.light} opacity={0.35} />);
  const bigX = cx < W / 2 ? between(rand, 240, 300) : between(rand, 20, 80);
  out.push(<Shape key="big" i={Math.floor(rand() * 4)} x={bigX} y={between(rand, 30, 55)} size={110} rotate={between(rand, -20, 20)} fill={c.deep} opacity={0.45} />);
  const popX = r1(W - bigX);
  const popY = between(rand, 44, 64);
  const popR = between(rand, 14, 20);
  out.push(<circle key="pop-ring" cx={popX} cy={popY} r={r1(popR + 9)} stroke={c.pop} strokeWidth={3} opacity={0.5} fill="none" />);
  out.push(<circle key="pop" cx={popX} cy={popY} r={popR} fill={c.pop} />);
  // spots taken so far, as x, y and how much room each needs
  const taken: [number, number, number][] = [[popX, popY, popR + 9]];
  for (let k = 0; k < 11; k++) {
    const x = between(rand, 16, 304);
    const y = between(rand, 26, 154);
    const kind = rand();
    const shape = Math.floor(rand() * 4);
    const size = between(rand, 14, 30);
    const tilt = between(rand, -30, 30);
    const fill = pick(rand, ['#ffffff', '#ffffff', c.light, c.pop]);
    // crowding is checked before the badge, so the emoji never changes which other spots are drawn
    if (taken.some(([tx, ty, room]) => Math.hypot(x - tx, y - ty) < room + 16)) continue;
    taken.push([x, y, 16]);
    if (clear && nearBadge(x, y, 20)) continue;
    if (kind < 0.55) out.push(<Shape key={`s${k}`} i={shape} x={x} y={y} size={size} rotate={tilt} fill={fill} />);
    else if (kind < 0.8) out.push(<Sparkle key={`s${k}`} x={x} y={y} r={r1(size / 2.2)} />);
    else out.push(<circle key={`s${k}`} cx={x} cy={y} r={r1(size / 5)} fill={fill} />);
  }
  return out;
}

/** ripples out of a corner, a dot grid in the opposite one */
function rings(rand: Rand, c: CoverShades, clear: boolean): ReactNode[] {
  const corner = Math.floor(rand() * 4);
  const ox = corner % 2 ? W : 0;
  const oy = corner < 2 ? 0 : H;
  const step = between(rand, 26, 36);
  const out: ReactNode[] = [];
  for (let k = 1; k <= 12; k++) {
    out.push(<circle key={`c${k}`} cx={ox} cy={oy} r={r1(k * step)} stroke={k % 2 ? c.deep : c.light} strokeWidth={r1(step / 2)} opacity={k % 2 ? 0.3 : 0.22} fill="none" />);
  }
  const dx = ox ? 24 : W - 24 - 4 * 14;
  const dy = oy ? 26 : H - 26 - 3 * 14;
  for (let i = 0; i < 20; i++) out.push(<circle key={`d${i}`} cx={dx + (i % 5) * 14} cy={dy + Math.floor(i / 5) * 14} r={2.6} fill="#ffffff" opacity={0.6} />);
  const sx = ox ? W - between(rand, 60, 90) : between(rand, 60, 90);
  const sy = oy ? H - between(rand, 50, 70) : between(rand, 50, 70);
  const shape = Math.floor(rand() * 4);
  const tilt = between(rand, -25, 25);
  const tx = between(rand, 110, 210);
  const ty = oy ? between(rand, 24, 40) : between(rand, 140, 156);
  if (!(clear && nearBadge(sx, sy, 28))) out.push(<Shape key="s" i={shape} x={sx} y={sy} size={56} rotate={tilt} fill={c.pop} />);
  out.push(<circle key="dot" cx={tx} cy={ty} r={9} fill="#ffffff" />);
  return out;
}

const PATTERNS = [tiles, confetti, burst, rings];

function pattern(seed: number, c: CoverShades, clear: boolean): ReactNode[] {
  // the low bits already pick the color, so the layout comes from higher ones
  return PATTERNS[(seed >>> 8) % PATTERNS.length](mulberry32(seed), c, clear);
}

/**
 * A game's cover: its drawn picture, or a pattern that comes from the title in its color with
 * the emoji in the middle. Fills its box and crops to it, keeping the middle.
 */
export function GameCover({ game, className = 'block size-full' }: { game: Pick<Game, 'title' | 'cover'>; className?: string }) {
  const id = `cv${useId().replace(/[^\w-]/g, '')}`;
  const art = game.cover?.art;
  const color = coverColor(game);
  const emoji = art ? undefined : game.cover?.emoji;
  const seed = coverSeed(game.title);
  const shades = COVER_SHADES[color];
  const drawn = useMemo(() => (art ? null : pattern(seed, shades, !!emoji)), [art, seed, shades, emoji]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden className={className}>
      {art ? (
        <ArtDrawing art={art} id={id} />
      ) : (
        <>
          <Backdrop id={id} stops={shades.bg} />
          {drawn}
          {emoji && (
            <g>
              <circle cx={BADGE.x} cy={BADGE.y + 6} r={BADGE.r} fill={shades.deep} opacity={0.6} />
              <circle cx={BADGE.x} cy={BADGE.y} r={BADGE.r} fill="#ffffff" />
              <text
                x={BADGE.x}
                y={BADGE.y + 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={48}
                fontFamily="'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif"
              >
                {emoji}
              </text>
            </g>
          )}
        </>
      )}
    </svg>
  );
}
