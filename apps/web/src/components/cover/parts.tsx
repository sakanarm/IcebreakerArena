import { ANSWER_PATHS } from '../shapes';

/** The drawing is 320 × 180 (16:9). Cards crop it to 16:7, so what matters stays between y 20 and 160. */
export const W = 320;
export const H = 180;
export const INK = '#16133f';

/** one decimal is plenty, and keeps the server and every browser writing the same numbers */
export const r1 = (v: number) => Math.round(v * 10) / 10;

/** an answer shape (drawn in a 24 box) centered on x, y */
export function Shape({ i, x, y, size, rotate = 0, fill, opacity }: { i: number; x: number; y: number; size: number; rotate?: number; fill: string; opacity?: number }) {
  return (
    <path
      d={ANSWER_PATHS[i % 4]}
      transform={`translate(${x} ${y}) rotate(${rotate}) scale(${r1(size / 24 * 100) / 100}) translate(-12 -12)`}
      fill={fill}
      opacity={opacity}
    />
  );
}

/** a four-pointed twinkle */
export function Sparkle({ x, y, r, fill = '#ffffff', opacity }: { x: number; y: number; r: number; fill?: string; opacity?: number }) {
  return <path d={`M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z`} fill={fill} opacity={opacity} />;
}

/** the background: a gradient from the top left (or the top) down */
export function Backdrop({ id, stops, vertical = false }: { id: string; stops: string[]; vertical?: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2={vertical ? 0 : 1} y2="1">
          {stops.map((c, i) => (
            <stop key={i} offset={r1(i / (stops.length - 1))} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#${id})`} />
    </>
  );
}
