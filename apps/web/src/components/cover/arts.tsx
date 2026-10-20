import type { CoverArt } from '@icebreaker/shared';
import type { ReactNode } from 'react';
import { Backdrop, INK, Shape, Sparkle } from './parts';

/*
 * Covers drawn by hand for the built-in games, flat and in our brand colors, in the 320 × 180 box
 * (what matters between y 20 and 160, where cards crop). Each takes a prefix for its gradient ids,
 * so many covers can share a page.
 */

const round = { strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;

// the ice cube's two halves, split along a zigzag crack
const CRACK = 'L164 128 L152 112 L166 95 L154 78 L165 62 Z';
const ICE_LEFT = `M160 45 H128 A18 18 0 0 0 110 63 V127 A18 18 0 0 0 128 145 H156 ${CRACK}`;
const ICE_RIGHT = `M160 45 H192 A18 18 0 0 1 210 63 V127 A18 18 0 0 1 192 145 H156 ${CRACK}`;

function icebreaker(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#3ddcff', '#3d5afe']} />
      <Shape i={0} x={40} y={150} size={84} rotate={-15} fill="#ffffff" opacity={0.12} />
      <Shape i={1} x={292} y={34} size={66} rotate={12} fill="#ffffff" opacity={0.12} />
      <circle cx={160} cy={95} r={74} fill="#ffffff" opacity={0.12} />
      <circle cx={160} cy={95} r={54} fill="#ffffff" opacity={0.1} />
      {[[30, 30, 2.5], [62, 152, 2], [288, 72, 3], [300, 150, 2.5], [250, 22, 2], [22, 100, 2], [102, 22, 2.5], [222, 160, 2]].map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.6} />
      ))}
      <ellipse cx={160} cy={154} rx={78} ry={9} fill="#1f33b5" opacity={0.35} />
      <g transform="translate(-7 2) rotate(-5 135 95)">
        <path d={ICE_LEFT} transform="translate(0 8)" fill="#8fd9f5" />
        <path d={ICE_LEFT} fill="#eafcff" />
        <path d="M121 100 V72 Q121 58 134 57" stroke="#ffffff" strokeWidth={6} {...round} />
        <circle cx={121} cy={113} r={3} fill="#ffffff" />
        <circle cx={137} cy={88} r={5.5} fill={INK} />
        <circle cx={139} cy={86} r={1.8} fill="#ffffff" />
        <ellipse cx={128} cy={103} rx={8} ry={4.5} fill="#ff8fb8" opacity={0.75} />
        <path d="M146 104 Q152 112 159 111" stroke={INK} strokeWidth={4} {...round} />
      </g>
      <g transform="translate(7 2) rotate(5 185 95)">
        <path d={ICE_RIGHT} transform="translate(0 8)" fill="#8fd9f5" />
        <path d={ICE_RIGHT} fill="#eafcff" />
        <path d="M200 66 Q202 72 202 80" stroke="#ffffff" strokeWidth={4} opacity={0.8} {...round} />
        <circle cx={184} cy={88} r={5.5} fill={INK} />
        <circle cx={186} cy={86} r={1.8} fill="#ffffff" />
        <ellipse cx={193} cy={103} rx={8} ry={4.5} fill="#ff8fb8" opacity={0.75} />
        <path d="M163 111 Q170 112 175 104" stroke={INK} strokeWidth={4} {...round} />
      </g>
      <path d="M154 34 l-5 -9 M166 34 l5 -9 M160 31 v-10" stroke="#ffffff" strokeWidth={3.5} {...round} />
      <path d="M150 164 l-6 6 M170 164 l6 6" stroke="#ffffff" strokeWidth={3} opacity={0.8} {...round} />
      <polygon points="228,54 242,50 236,66" fill="#eafcff" />
      <polygon points="236,106 250,113 238,121" fill="#ccf6ff" />
      <polygon points="82,58 95,63 86,73" fill="#eafcff" />
      <polygon points="76,112 89,116 81,127" fill="#ccf6ff" />
      <Sparkle x={256} y={38} r={10} fill="#ffc83d" />
      <Sparkle x={68} y={40} r={7} />
      <Sparkle x={262} y={142} r={6} />
      <Sparkle x={60} y={142} r={8} fill="#ffc83d" />
    </>
  );
}

const SHIELD = 'M150 30 L200 47 V90 C200 121 179 142 150 154 C121 142 100 121 100 90 V47 Z';

function security(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#8a6dff', '#2f49e8']} />
      {Array.from({ length: 6 }, (_, row) =>
        Array.from({ length: 4 }, (_, col) => <circle key={`${row}-${col}`} cx={22 + col * 14} cy={34 + row * 14} r={1.8} fill="#ffffff" opacity={0.3} />),
      )}
      {[64, 84, 104].map((r) => (
        <circle key={r} cx={150} cy={92} r={r} stroke="#ffffff" strokeWidth={2} opacity={0.13} fill="none" />
      ))}
      <path d={SHIELD} transform="translate(0 7)" fill="#3f20b8" opacity={0.55} />
      <path d={SHIELD} fill="#ffffff" />
      <path d="M150 42 L189 55 V90 C189 114 173 131 150 141 C127 131 111 114 111 90 V55 Z" fill="#ebe6ff" />
      <path d="M150 42 L189 55 V90 C189 114 173 131 150 141 Z" fill="#d6ccff" />
      <path d="M138 92 V82 a12 12 0 0 1 24 0 V92" stroke="#6c4bf4" strokeWidth={7} {...round} />
      <rect x={130} y={89} width={40} height={32} rx={8} fill="#6c4bf4" />
      <rect x={134} y={93} width={7} height={24} rx={3.5} fill="#ffffff" opacity={0.2} />
      <circle cx={150} cy={102} r={4.5} fill="#ffffff" />
      <path d="M148 104 h4 l1 9 h-6 z" fill="#ffffff" />
      <circle cx={188} cy={132} r={15} fill="#17b26a" stroke="#ffffff" strokeWidth={4} />
      <path d="M181 132 l5 5 l9 -10" stroke="#ffffff" strokeWidth={4} {...round} />
      <path d="M262 0 V58" stroke="#ffffff" strokeWidth={2} opacity={0.8} />
      <path d="M262 56 V76 a11 11 0 0 1 -22 0 v-6" stroke="#ffc83d" strokeWidth={5} {...round} />
      <path d="M240 70 l-5 5" stroke="#ffc83d" strokeWidth={4} {...round} />
      <g transform="rotate(-12 251 104)">
        <rect x={229} y={89} width={44} height={30} rx={5} fill="#ffffff" />
        <path d="M231 92 L251 107 L271 92" stroke="#c5cfff" strokeWidth={3} {...round} />
        <circle cx={272} cy={89} r={9} fill="#ef4155" />
        <rect x={270.5} y={83} width={3} height={8} rx={1.5} fill="#ffffff" />
        <circle cx={272} cy={94.5} r={1.7} fill="#ffffff" />
      </g>
      <g transform="rotate(-6 54 131)">
        <rect x={22} y={120} width={64} height={22} rx={8} fill="#ffffff" opacity={0.92} />
        {[34, 45, 56, 67].map((x) => (
          <circle key={x} cx={x} cy={131} r={3.2} fill="#6c4bf4" />
        ))}
      </g>
      <Sparkle x={58} y={28} r={6} />
      <Sparkle x={292} y={150} r={8} fill="#00d1ff" />
      <Sparkle x={214} y={30} r={5} />
    </>
  );
}

function party(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#ff5fa2', '#ff9b3d']} />
      <circle cx={34} cy={26} r={62} fill="#ffffff" opacity={0.1} />
      <circle cx={304} cy={172} r={72} fill="#ffffff" opacity={0.08} />
      <path d="M128 92 l10 -10 M134 100 l14 -3 M122 86 l3 -14" stroke="#ffffff" strokeWidth={3.5} opacity={0.9} {...round} />
      <path d="M54 162 L98 86 L134 122 Z" fill="#ffc83d" />
      <polygon points="65,143 71.6,131.6 86,146 74,152" fill="#e0388b" />
      <polygon points="78.2,120.2 84.8,108.8 110,134 98,140" fill="#e0388b" />
      <ellipse cx={116} cy={104} rx={25.5} ry={8} transform="rotate(45 116 104)" fill="#d98a00" />
      <ellipse cx={117} cy={103} rx={19} ry={4.5} transform="rotate(45 117 103)" fill="#7a3d00" opacity={0.45} />
      <Shape i={0} x={152} y={60} size={28} rotate={10} fill="#ffc83d" />
      <Shape i={1} x={190} y={94} size={20} rotate={-8} fill="#00a99d" />
      <Shape i={2} x={140} y={30} size={20} rotate={-15} fill="#ffffff" />
      <Shape i={3} x={207} y={42} size={24} rotate={15} fill="#6c4bf4" />
      <Shape i={0} x={228} y={130} size={16} rotate={-20} fill="#ffffff" />
      <circle cx={172} cy={28} r={5} fill="#00d1ff" />
      <circle cx={124} cy={58} r={4} fill="#ffffff" />
      <circle cx={212} cy={72} r={4} fill="#ffc83d" />
      <circle cx={176} cy={124} r={5} fill="#6c4bf4" />
      <path d="M150 90 q8 -10 16 0 t16 0" stroke="#00d1ff" strokeWidth={4} {...round} />
      <path d="M100 40 q6 -8 12 0 t12 0" stroke="#ffc83d" strokeWidth={4} {...round} />
      <path d="M190 134 q7 -9 14 0 t14 0" stroke="#ffffff" strokeWidth={4} {...round} />
      <path d="M232 112 q-6 18 4 30 t-2 26" stroke="#ffffff" strokeWidth={1.5} opacity={0.85} {...round} />
      <ellipse cx={232} cy={93} rx={16} ry={19} fill="#ffc83d" />
      <path d="M229 112 l3 4 l3 -4 z" fill="#ffc83d" />
      <path d="M264 95 q-10 20 4 40 t-2 40" stroke="#ffffff" strokeWidth={1.5} opacity={0.85} {...round} />
      <ellipse cx={264} cy={63} rx={24} ry={29} fill="#6c4bf4" />
      <path d="M260 92 l4 5 l4 -5 z" fill="#6c4bf4" />
      <ellipse cx={255} cy={51} rx={6} ry={9} transform="rotate(-20 255 51)" fill="#ffffff" opacity={0.35} />
      <path d="M296 124 q8 18 -4 34 t2 30" stroke="#ffffff" strokeWidth={1.5} opacity={0.85} {...round} />
      <ellipse cx={296} cy={98} rx={20} ry={24} fill="#00a99d" />
      <path d="M293 121 l3 4 l3 -4 z" fill="#00a99d" />
      <ellipse cx={289} cy={88} rx={5} ry={7.5} transform="rotate(-20 289 88)" fill="#ffffff" opacity={0.35} />
      <Sparkle x={24} y={100} r={7} />
      <Sparkle x={100} y={150} r={5} fill="#ffc83d" />
    </>
  );
}

/** a yellow face with what makes it this face drawn over it */
function Face({ x, y, r, children }: { x: number; y: number; r: number; children: ReactNode }) {
  return (
    <g>
      <circle cx={x} cy={y + r * 0.08} r={r} fill="#f0a400" />
      <circle cx={x} cy={y} r={r} fill="#ffc83d" />
      {children}
    </g>
  );
}

function emoji(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#8a6dff', '#5a37e6']} />
      <circle cx={300} cy={10} r={60} fill="#ffffff" opacity={0.08} />
      <circle cx={10} cy={170} r={50} fill="#ffffff" opacity={0.08} />
      <Shape i={2} x={34} y={40} size={20} rotate={-12} fill="#ffc2dd" />
      <Shape i={2} x={294} y={162} size={14} rotate={10} fill="#ffc2dd" />
      <Shape i={0} x={302} y={68} size={14} rotate={8} fill="#ffc83d" />
      <Sparkle x={36} y={140} r={7} />
      <Sparkle x={182} y={150} r={5} fill="#ffc83d" />
      {/* laughing */}
      <rect x={54} y={36} width={120} height={92} rx={26} fill="#3f20b8" opacity={0.5} transform="translate(0 6)" />
      <rect x={54} y={36} width={120} height={92} rx={26} fill="#ffffff" />
      <path d="M78 124 L68 148 L104 126 Z" fill="#ffffff" />
      <Face x={114} y={82} r={33}>
        <path d="M97 75 q6 -8 12 0 M119 75 q6 -8 12 0" stroke={INK} strokeWidth={4} {...round} />
        <path d="M95 87 H133 A19 19 0 0 1 95 87 Z" fill={INK} />
        <path d="M98 87 H130 v4 H98 Z" fill="#ffffff" />
        <ellipse cx={114} cy={100} rx={9} ry={4.5} fill="#ef4155" />
        <path d="M93 80 q-7 9 -2 13 q5 2 6 -5 z M135 80 q7 9 2 13 q-5 2 -6 -5 z" fill="#3ddcff" />
      </Face>
      {/* in love */}
      <rect x={190} y={24} width={84} height={64} rx={20} fill="#3f20b8" opacity={0.5} transform="translate(0 5)" />
      <rect x={190} y={24} width={84} height={64} rx={20} fill="#ffffff" />
      <path d="M202 84 L196 102 L220 86 Z" fill="#ffffff" />
      <Face x={232} y={56} r={22}>
        <Shape i={2} x={223} y={52} size={13} fill="#ef4155" />
        <Shape i={2} x={241} y={52} size={13} fill="#ef4155" />
        <path d="M222 64 q10 9 20 0" stroke={INK} strokeWidth={3.5} {...round} />
      </Face>
      {/* winking */}
      <rect x={202} y={104} width={78} height={54} rx={18} fill="#3f20b8" opacity={0.5} transform="translate(0 5)" />
      <rect x={202} y={104} width={78} height={54} rx={18} fill="#ffffff" />
      <path d="M210 152 L196 166 L226 156 Z" fill="#ffffff" />
      <Face x={241} y={131} r={19}>
        <path d="M230 127 q4 -4 8 0" stroke={INK} strokeWidth={3} {...round} />
        <circle cx={249} cy={126} r={3} fill={INK} />
        <path d="M232 136 q9 8 18 0" stroke={INK} strokeWidth={3} {...round} />
        <path d="M243 139 q3 9 7 1 z" fill="#ef4155" />
      </Face>
    </>
  );
}

/** a rounded number tile with a lip, like our buttons */
function Tile({ x, y, rotate, fill, lip, ink, children }: { x: number; y: number; rotate: number; fill: string; lip: string; ink: string; children: string }) {
  return (
    <g transform={`rotate(${rotate} ${x + 23} ${y + 23})`}>
      <rect x={x} y={y + 5} width={46} height={46} rx={12} fill={lip} />
      <rect x={x} y={y} width={46} height={46} rx={12} fill={fill} />
      <text x={x + 23} y={y + 25} textAnchor="middle" dominantBaseline="central" fontFamily="Kanit, sans-serif" fontWeight={800} fontSize={30} fill={ink}>
        {children}
      </text>
    </g>
  );
}

function numbers(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#1fc8b8', '#00978b']} />
      {Array.from({ length: 15 }, (_, k) => (
        <path key={`v${k}`} d={`M${10 + k * 22} 0 V180`} stroke="#ffffff" strokeWidth={1} opacity={0.09} />
      ))}
      {Array.from({ length: 8 }, (_, k) => (
        <path key={`h${k}`} d={`M0 ${12 + k * 22} H320`} stroke="#ffffff" strokeWidth={1} opacity={0.09} />
      ))}
      <Tile x={36} y={30} rotate={-10} fill="#ffc83d" lip="#d98a00" ink={INK}>
        7
      </Tile>
      <Tile x={238} y={26} rotate={8} fill="#ff7a1a" lip="#c24f00" ink="#ffffff">
        3
      </Tile>
      <Tile x={252} y={92} rotate={-6} fill="#6c4bf4" lip="#3f20b8" ink="#ffffff">
        9
      </Tile>
      <path d="M96 66 h18 M105 57 v18" stroke="#ffffff" strokeWidth={5} {...round} />
      <path d="M204 56 l12 12 M216 56 l-12 12" stroke="#ffffff" strokeWidth={5} opacity={0.85} {...round} />
      <path d="M30 104 h16" stroke="#ffffff" strokeWidth={5} opacity={0.85} {...round} />
      <rect x={50} y={128} width={220} height={12} rx={6} fill="#006f66" />
      <rect x={50} y={128} width={120} height={12} rx={6} fill="#ffffff" />
      {[50, 105, 160, 215, 270].map((x) => (
        <path key={x} d={`M${x} 148 v6`} stroke="#ffffff" strokeWidth={2.5} opacity={0.7} {...round} />
      ))}
      <circle cx={170} cy={139} r={15} fill="#006f66" opacity={0.5} />
      <circle cx={170} cy={134} r={15} fill="#ffffff" stroke="#ffc83d" strokeWidth={5} />
      <rect x={140} y={64} width={60} height={44} rx={14} fill="#006f66" opacity={0.45} transform="translate(0 5)" />
      <rect x={140} y={64} width={60} height={44} rx={14} fill="#ffffff" />
      <path d="M162 107 L170 117 L178 107 Z" fill="#ffffff" />
      <text x={170} y={87} textAnchor="middle" dominantBaseline="central" fontFamily="Kanit, sans-serif" fontWeight={800} fontSize={30} fill={INK}>
        42
      </text>
      <Sparkle x={122} y={30} r={7} fill="#ffc83d" />
      <Sparkle x={300} y={160} r={6} />
      <Sparkle x={24} y={160} r={5} />
    </>
  );
}

function townhall(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#5c77ff', '#3f20b8']} />
      <polygon points="38,0 72,0 196,150 112,150" fill="#ffffff" opacity={0.13} />
      <polygon points="282,0 248,0 124,150 208,150" fill="#ffffff" opacity={0.13} />
      <rect x={40} y={-6} width={30} height={16} rx={6} fill={INK} />
      <rect x={250} y={-6} width={30} height={16} rx={6} fill={INK} />
      <ellipse cx={160} cy={146} rx={70} ry={10} fill="#ffffff" opacity={0.18} />
      <path d="M166 92 L174 64" stroke={INK} strokeWidth={3.5} {...round} />
      <ellipse cx={175.5} cy={59} rx={6.5} ry={9} transform="rotate(16 175.5 59)" fill={INK} />
      <ellipse cx={174} cy={56} rx={2} ry={4} transform="rotate(16 174 56)" fill="#ffffff" opacity={0.35} />
      <rect x={126} y={90} width={68} height={11} rx={4} fill="#ff9b3d" />
      <path d="M133 101 H187 L181 146 H139 Z" fill="#ff7a1a" />
      <path d="M160 101 H187 L181 146 H160 Z" fill="#d94a00" opacity={0.35} />
      <Shape i={0} x={160} y={122} size={20} fill="#ffffff" />
      <g transform="rotate(6 260 53)">
        <rect x={222} y={30} width={76} height={54} rx={12} fill="#1f33b5" opacity={0.5} transform="translate(0 5)" />
        <rect x={222} y={30} width={76} height={54} rx={12} fill="#ffffff" />
        <rect x={232} y={41} width={40} height={8} rx={4} fill="#ff7a1a" />
        <rect x={232} y={53} width={56} height={8} rx={4} fill="#00a99d" />
        <rect x={232} y={65} width={28} height={8} rx={4} fill="#e0388b" />
      </g>
      <g transform="rotate(-8 70 50)">
        <circle cx={70} cy={50} r={20} fill="#ffffff" />
        <path d="M58 64 L52 76 L68 68 Z" fill="#ffffff" />
        <text x={70} y={51} textAnchor="middle" dominantBaseline="central" fontFamily="Kanit, sans-serif" fontWeight={800} fontSize={26} fill="#6c4bf4">
          ?
        </text>
      </g>
      {/* the audience sits high enough to show in the card's crop too */}
      <path d="M80 150 L88 122 M240 150 L234 124" stroke="#2a1f8f" strokeWidth={7} {...round} />
      <circle cx={88.5} cy={119} r={5.5} fill="#2a1f8f" />
      <circle cx={233.5} cy={121} r={5.5} fill="#2a1f8f" />
      {Array.from({ length: 12 }, (_, k) => {
        const x = 12 + k * 27;
        const tone = k % 2 ? '#1f33b5' : '#2a1f8f';
        return (
          <g key={k}>
            <rect x={x - 16} y={160} width={32} height={30} rx={14} fill={tone} />
            <circle cx={x} cy={150} r={11} fill={tone} />
          </g>
        );
      })}
      <Sparkle x={124} y={30} r={6} />
      <Sparkle x={200} y={22} r={4} fill="#ffc83d" />
    </>
  );
}

function onboarding(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#3d5afe', '#8a6dff', '#ff9b3d']} vertical />
      {[[30, 24, 1.8], [96, 52, 1.5], [150, 18, 2], [222, 60, 1.5], [304, 30, 2], [20, 70, 1.5], [272, 108, 1.5]].map(([x, y, r]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.8} />
      ))}
      <ellipse cx={62} cy={48} rx={29} ry={7} transform="rotate(-20 62 48)" stroke="#ff7a1a" strokeWidth={3} fill="none" />
      <circle cx={62} cy={48} r={17} fill="#ffc83d" />
      <circle cx={57} cy={43} r={5} fill="#ffffff" opacity={0.35} />
      {/* the front of the ring passes over the planet */}
      <path d="M34.75 57.92 A29 7 -20 0 0 89.25 38.08" stroke="#ff7a1a" strokeWidth={3} {...round} />
      {[[60, 160, 10], [90, 147, 9], [116, 133, 7.5], [136, 121, 6]].map(([x, y, r]) => (
        <circle key={x} cx={x} cy={y} r={r} fill="#ffffff" opacity={0.9} />
      ))}
      <g transform="translate(176 82) rotate(35)">
        <path d="M-8 24 Q0 60 8 24 Z" fill="#ffc83d" />
        <path d="M-4 24 Q0 44 4 24 Z" fill="#ff7a1a" />
        <path d="M-14 4 L-29 26 L-14 21 Z M14 4 L29 26 L14 21 Z" fill="#ef4155" />
        <path d="M0 -46 C16 -30 18 -6 14 20 H-14 C-18 -6 -16 -30 0 -46 Z" fill="#ffffff" />
        <path d="M0 -46 C16 -30 18 -6 14 20 H0 Z" fill="#c5cfff" opacity={0.6} />
        <path d="M0 -46 C7 -40 11 -33 13 -26 H-13 C-11 -33 -7 -40 0 -46 Z" fill="#ef4155" />
        <circle cx={0} cy={-10} r={8} fill="#3d5afe" stroke="#c5cfff" strokeWidth={4} />
        <circle cx={-2.5} cy={-12.5} r={2.5} fill="#ffffff" opacity={0.7} />
        <rect x={-10} y={19} width={20} height={6} rx={2} fill="#8a94c9" />
      </g>
      <g fill="#ffd3a8" opacity={0.9}>
        <circle cx={148} cy={176} r={24} />
        <circle cx={190} cy={178} r={24} />
      </g>
      <g fill="#ffffff">
        <circle cx={20} cy={166} r={30} />
        <circle cx={62} cy={170} r={26} />
        <circle cx={104} cy={174} r={28} />
        <circle cx={232} cy={174} r={26} />
        <circle cx={272} cy={162} r={30} />
        <circle cx={316} cy={168} r={26} />
      </g>
      <Sparkle x={252} y={30} r={9} />
      <Sparkle x={292} y={72} r={5} />
      <Sparkle x={112} y={24} r={6} fill="#ffc83d" />
      <Sparkle x={30} y={112} r={5} />
    </>
  );
}

/** a temple tower (prang) standing on y = 0, drawn around x = 0 at full size */
const PRANG =
  'M-38 0 L-30 -20 H30 L38 0 Z M-26 -20 L-20 -36 H20 L26 -20 Z M-16 -36 L-12 -50 H12 L16 -36 Z M-10 -50 C-10 -66 -4 -76 0 -88 C4 -76 10 -66 10 -50 Z M-2 -86 L0 -108 L2 -86 Z';

function thailand(id: string) {
  return (
    <>
      <Backdrop id={id} stops={['#ff9b3d', '#ff5fa2', '#8a6dff']} vertical />
      <ellipse cx={70} cy={30} rx={40} ry={8} fill="#ffffff" opacity={0.3} />
      <ellipse cx={260} cy={46} rx={34} ry={7} fill="#ffffff" opacity={0.25} />
      <circle cx={200} cy={96} r={60} fill="#ffd862" opacity={0.25} />
      <circle cx={200} cy={96} r={44} fill="#ffd862" />
      <g fill="#3f20b8">
        <rect x={140} y={132} width={120} height={12} />
        <path d={PRANG} transform="translate(200 132)" />
        <path d={PRANG} transform="translate(146 134) scale(0.55)" />
        <path d={PRANG} transform="translate(254 134) scale(0.55)" />
        <path d="M70 142 Q70 120 90 112 Q110 120 110 142 Z M86 116 L90 82 L94 116 Z M76 142 h28 v-6 h-28 z" />
      </g>
      <rect x={0} y={142} width={320} height={40} fill="#5a37e6" />
      <path d="M166 152 h68 M180 160 h40 M192 168 h16" stroke="#ffd862" strokeWidth={3} opacity={0.6} {...round} />
      <path d="M78 152 h24 M84 158 h12" stroke="#ffffff" strokeWidth={2} opacity={0.3} {...round} />
      <g fill={INK}>
        <path d="M30 150 Q74 162 124 148 L130 143 Q86 153 34 145 Z" />
        <circle cx={92} cy={136} r={4} />
        <path d="M88 141 h8 l-1 9 h-6 z" />
      </g>
      <path d="M118 146 L136 124 M34 146 L14 140" stroke={INK} strokeWidth={2} {...round} />
      <path d="M54 56 q5 -5 10 0 q5 -5 10 0 M92 38 q4 -4 8 0 q4 -4 8 0 M262 74 q4 -4 8 0 q4 -4 8 0" stroke="#3f20b8" strokeWidth={2.5} {...round} />
    </>
  );
}

const ARTS: Record<CoverArt, (id: string) => ReactNode> = { icebreaker, security, party, emoji, numbers, townhall, onboarding, thailand };

export function ArtDrawing({ art, id }: { art: CoverArt; id: string }) {
  return <>{ARTS[art](id)}</>;
}
