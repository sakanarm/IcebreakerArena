/**
 * Font sizes that keep a slider's numbers whole in the room they have, as CSS lengths in cqw of the column they are
 * in (a container), so the browser settles them once it knows the width: nothing is measured on the page, and
 * nothing jumps when a tablet turns. The widths are in em, measured in Edge at 100 px in the faces the reveal sets
 * numbers in.
 */

/**
 * Kanit at 800: the answer, and the counts over the bars (their bold is not loaded, so they come out at 800 too).
 * Its figures are each their own width, "1" not much more than half a "0", and it has no tabular ones:
 * tabular-nums changes nothing in it.
 */
const KANIT: Record<string, number> = { 0: 0.67, 1: 0.38, 2: 0.53, 3: 0.54, 4: 0.55, 5: 0.53, 6: 0.6, 7: 0.5, 8: 0.62, 9: 0.6, ',': 0.25, '.': 0.21, '-': 0.44, ' ': 0.21 };
/** IBM Plex Sans Thai at 400: the scale's ends and the average. Its figures are all 0.6. */
const PLEX: Record<string, number> = { ',': 0.27, '.': 0.27, '-': 0.4, ' ': 0.24 };

export type Face = 'display' | 'sans';

/** how wide `text` is in em, a little over (kerning never takes up the 0.1); anything but a figure is taken as wide */
export function ems(text: string, face: Face) {
  let sum = 0.1;
  for (const c of text) sum += (face === 'display' ? KANIT[c] : /\d/.test(c) ? 0.6 : PLEX[c]) ?? 0.7;
  return sum;
}

/** "▲ เฉลี่ย " before the average, in the app's sans stack (the ▲ comes from a system face) */
export const AVERAGE_EMS = 3.5;

/** the font size that sets `em` of text in `room`, a CSS length */
export const sizeFor = (room: string, em: number) => `calc((${room}) / ${Math.ceil(em * 1000) / 1000})`;

/** em between two counts over the bars */
export const COUNT_GAP = 0.3;
/** em of padding each side of a count, which shows on the bead */
export const BEAD_PAD = 0.35;
/** px of the bead's ring, outside its padding */
const RING = 2;

/** a place along the chart: so many em of the counts' font size, plus a share of the chart's width, plus px */
type At = { em: number; w: number; px: number };
const at = (em: number, w = 0, px = 0): At => ({ em, w, px });
const plus = (a: At, b: At): At => ({ em: a.em + b.em, w: a.w + b.w, px: a.px + b.px });

/**
 * The biggest the counts over the bars can be, all at one size, each clear of the next and all inside the chart: a
 * CSS min() of lengths in cqw, for a chart as wide as its container; null with no counts. `bars` have their left
 * edge and width as shares of the chart, and the count each shows ('' for none). A count sits centred over its
 * bar, but over an end bar one wider than the bar starts at the bar's outer edge instead (in by the ring) and runs
 * inwards. The one the needle stopped on, `hit`, is a bead: its padding shows, with a ring round it.
 *
 * Counts are kept apart side to side even where their bars' heights would keep them apart anyway, so no count has
 * to leave its bar's top.
 */
export function countsFit(bars: { left: number; width: number; text: string }[], hit: number) {
  const last = bars.length - 1;
  const counts = bars.flatMap((b, i) => {
    if (!b.text) return [];
    const box = ems(b.text, 'display') + 2 * BEAD_PAD;
    const mid = b.left + b.width / 2;
    // the pill's edges: over an end bar each is the further in of two places, which both have to work
    let l: At[];
    let r: At[];
    if (i === 0) {
      l = [at(0, b.left, RING), at(-box / 2, mid)];
      r = l.map((a) => plus(a, at(box)));
    } else if (i === last) {
      r = [at(0, b.left + b.width, -RING), at(box / 2, mid)];
      l = r.map((a) => plus(a, at(-box)));
    } else [l, r] = [[at(-box / 2, mid)], [at(box / 2, mid)]];
    // what shows of it: the bead out to its ring, any other count just its figures
    const [dl, dr] = i === hit ? [at(0, 0, -RING), at(0, 0, RING)] : [at(BEAD_PAD), at(-BEAD_PAD)];
    return [{ i, l: l.map((a) => plus(a, dl)), r: r.map((a) => plus(a, dr)) }];
  });

  const terms: { cqw: number; px: number }[] = [];
  // a ≤ b, as the biggest font size that keeps it so
  const keep = (a: At, b: At) => {
    const em = a.em - b.em;
    if (em > 0) terms.push({ cqw: ((b.w - a.w) * 100) / em, px: (b.px - a.px) / em });
  };
  counts.forEach((c, k) => {
    const next = counts[k + 1];
    if (next) for (const a of c.r) for (const b of next.l) keep(plus(a, at(COUNT_GAP)), b);
    // inside the chart, where an end bar's count could go out past it; over its own end it never does
    if (c.i !== 0) for (const b of c.l) keep(at(0), b);
    if (c.i !== last) for (const a of c.r) keep(a, at(0, 1));
  });
  // a length no smaller than another one at every width adds nothing
  const tight = terms.filter((t, k) => !terms.some((u, m) => u.cqw <= t.cqw && u.px <= t.px && (m < k || u.cqw < t.cqw || u.px < t.px)));
  if (!tight.length) return null;
  const length = ({ cqw, px }: { cqw: number; px: number }) => {
    const p = Math.floor(px * 100) / 100;
    const w = `${Math.floor(cqw * 1000) / 1000}cqw`;
    return p ? `calc(${w} ${p < 0 ? '-' : '+'} ${Math.abs(p)}px)` : w;
  };
  return `min(${tight.map(length).join(', ')})`;
}
