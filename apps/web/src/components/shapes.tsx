/**
 * Our own answer symbols: color + shape, so the answers stay readable for
 * color-blind players and on washed-out projectors.
 */
const PATHS = [
  // star
  'M12 2.5 L14.47 9.1 L21.51 9.41 L15.99 13.8 L17.88 20.59 L12 16.7 L6.12 20.59 L8.01 13.8 L2.49 9.41 L9.53 9.1 Z',
  // hexagon
  'M12 2 L21 7 V17 L12 22 L3 17 V7 Z',
  // heart
  'M12 21 C12 21 3 14.5 3 8.8 C3 5.9 5.2 4 7.7 4 C9.6 4 11.1 5.1 12 6.6 C12.9 5.1 14.4 4 16.3 4 C18.8 4 21 5.9 21 8.8 C21 14.5 12 21 12 21 Z',
  // bolt
  'M13 2 L4 14 H11 L10 22 L20 9 H13 Z',
];

export const ANSWER_NAMES = ['ดาว', 'หกเหลี่ยม', 'หัวใจ', 'สายฟ้า'];
export const ANSWER_BG = ['bg-ans-0', 'bg-ans-1', 'bg-ans-2', 'bg-ans-3'];
export const ANSWER_TEXT = ['text-ans-0', 'text-ans-1', 'text-ans-2', 'text-ans-3'];

export function AnswerShape({ index, className }: { index: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path d={PATHS[index % 4]} fill="currentColor" stroke="currentColor" strokeWidth={1.2} strokeLinejoin="round" />
    </svg>
  );
}

const FLOATERS = [
  { i: 0, top: '6%', left: '4%', size: 110, delay: 0, dur: 19 },
  { i: 1, top: '68%', left: '7%', size: 150, delay: -6, dur: 23 },
  { i: 2, top: '12%', left: '84%', size: 120, delay: -11, dur: 21 },
  { i: 3, top: '72%', left: '82%', size: 100, delay: -3, dur: 17 },
  { i: 2, top: '40%', left: '46%', size: 70, delay: -8, dur: 25 },
  { i: 1, top: '4%', left: '52%', size: 60, delay: -14, dur: 18 },
  { i: 3, top: '86%', left: '44%', size: 80, delay: -5, dur: 20 },
];

/** Slowly drifting shapes behind every screen; frozen when the OS asks for less motion. */
export function FloatingShapes({ opacity = 0.1 }: { opacity?: number }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden" style={{ opacity }}>
      {FLOATERS.map((f, k) => (
        <div
          key={k}
          className="animate-float absolute will-change-transform"
          style={{ top: f.top, left: f.left, width: f.size, height: f.size, animationDelay: `${f.delay}s`, animationDuration: `${f.dur}s` }}
        >
          <AnswerShape index={f.i} className={`h-full w-full ${ANSWER_TEXT[f.i]}`} />
        </div>
      ))}
    </div>
  );
}

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`grid -rotate-6 grid-cols-2 gap-1 rounded-2xl bg-white/10 p-1.5 ${small ? 'size-10' : 'size-14'}`}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`grid place-items-center rounded-md ${ANSWER_BG[i]}`}>
            <AnswerShape index={i} className="size-[70%] text-white" />
          </div>
        ))}
      </div>
      <div className="leading-none">
        <div className={`font-display font-extrabold tracking-tight ${small ? 'text-xl' : 'text-3xl'}`}>
          IceBreaker <span className="text-brand-2">Arena</span>
        </div>
        <div className="mt-1 text-[10px] font-semibold tracking-[0.35em] text-white/55">MFEC</div>
      </div>
    </div>
  );
}
