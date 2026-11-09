import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sliderBin } from '@pika-arena/shared';
import { AVERAGE_EMS, BEAD_PAD, COUNT_GAP, countsFit, ems, sizeFor } from './fit';

test('fit: a number is never wider than worked out, nor much narrower', () => {
  // measured in Edge at 100 px
  const measured = {
    display: { '1,000': 2.66, '888': 1.86, '999,800,000': 6.21, '1,000,000,000': 7.07, '-1,000,000,000': 7.51 },
    sans: { '1,000': 2.67, '999,800,000': 5.94, '1,000,000,000': 6.82, '-1,000,000,000': 7.22 },
  } as const;
  for (const face of ['display', 'sans'] as const)
    for (const [text, em] of Object.entries(measured[face])) {
      assert.ok(ems(text, face) >= em, `${text} in ${face}: ${ems(text, face)} for ${em}`);
      assert.ok(ems(text, face) <= em * 1.06 + 0.1, `${text} in ${face}: ${ems(text, face)} for ${em}`);
    }
  // the widest average, measured in the app's own stack, where the ▲ comes from a system face
  assert.ok(AVERAGE_EMS + ems('-999,999,999.9', 'sans') >= 10.64);
  assert.equal(sizeFor('100cqw - 2.5rem', 2.7401), 'calc((100cqw - 2.5rem) / 2.741)');
});

/** the bars as SliderReveal lays them out, as shares of the chart */
const barsOf = (s: { min: number; max: number; step: number }, counts: number[]) => {
  const cells = Math.round((s.max - s.min) / s.step) + 1;
  const lo: number[] = [];
  const hi: number[] = [];
  for (let k = 0; k < cells; k++) {
    const b = sliderBin(s, s.min + k * s.step);
    lo[b] ??= k;
    hi[b] = k;
  }
  return counts.map((n, b) => ({ left: lo[b]! / cells, width: (hi[b]! - lo[b]! + 1) / cells, text: n ? n.toLocaleString('th-TH') : '' }));
};

/** the px countsFit's min() comes to on a chart `w` px wide */
const resolve = (css: string, w: number) => {
  assert.match(css, /^min\(.+\)$/);
  return Math.min(
    ...css
      .slice(4, -1)
      .split(', ')
      .map((t) => {
        const m = /^(?:calc\()?([\d.]+)cqw(?: ([-+]) ([\d.]+)px\))?$/.exec(t);
        assert.ok(m, t);
        return (Number(m[1]) * w) / 100 + (m[2] === '-' ? -1 : 1) * Number(m[3] ?? 0);
      }),
  );
};

/**
 * Where each count shows on a chart `w` px wide at font size `f`, the way the page puts it: centred over its bar,
 * or over an end bar from 2 px in when it is wider than the bar less 4 px. The bead with its ring, any other count
 * just its figures, which are `narrower` em under what ems() works out.
 */
const shown = (bars: ReturnType<typeof barsOf>, hit: number, w: number, f: number, narrower = 0) =>
  bars.flatMap((b, i) => {
    if (!b.text) return [];
    const box = (ems(b.text, 'display') - narrower + 2 * BEAD_PAD) * f;
    const [start, end, mid] = [b.left * w, (b.left + b.width) * w, (b.left + b.width / 2) * w];
    const l = i === 0 ? Math.max(start + 2, mid - box / 2) : i === bars.length - 1 ? Math.min(end - 2 - box, mid - box / 2) : mid - box / 2;
    return [i === hit ? { l: l - 2, r: l + box + 2 } : { l: l + BEAD_PAD * f, r: l + box - BEAD_PAD * f }];
  });

const fits = (spans: { l: number; r: number }[], w: number, f: number) =>
  spans.every((s, k) => s.l >= -1e-6 && s.r <= w + 1e-6 && (k === 0 || spans[k - 1]!.r + COUNT_GAP * f <= s.l + 1e-6));

test('fit: no counts, nothing to fit', () => {
  assert.equal(countsFit(barsOf({ min: 0, max: 100, step: 1 }, Array(10).fill(0)), 3), null);
});

test('fit: the counts as big as they go, each clear of the next and inside the chart, at every width', () => {
  const ten = [
    [3, 22, 81, 170, 230, 230, 170, 70, 21, 3],
    [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1000],
    [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    [999, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 999],
    [200, 0, 200, 0, 200, 0, 200, 0, 200, 0],
    [0, 0, 0, 0, 444, 555, 1, 0, 0, 0],
  ];
  const scales = [
    { s: { min: 0, max: 4000, step: 5 }, counts: ten },
    { s: { min: -1_000_000_000, max: 1_000_000_000, step: 200_000 }, counts: ten },
    { s: { min: 0, max: 100, step: 1 }, counts: ten },
    { s: { min: 1, max: 5, step: 1 }, counts: [[200, 200, 200, 200, 200], [1000, 0, 0, 0, 0], [0, 0, 0, 1, 999]] },
    { s: { min: 0, max: 1, step: 1 }, counts: [[500, 500], [1000, 0], [0, 1000]] },
  ];
  let layouts = 0;
  for (const { s, counts } of scales)
    for (const c of counts) {
      const bars = barsOf(s, c);
      for (const hit of [0, Math.floor(bars.length / 2), bars.length - 1]) {
        const css = countsFit(bars, hit)!;
        for (let w = 200; w <= 1600; w += 50) {
          const f = resolve(css, w);
          const at = `${JSON.stringify(c)} on ${s.min}..${s.max}, the needle in bar ${hit}, ${w} px: ${f.toFixed(2)} px`;
          assert.ok(f > 0, at);
          assert.ok(fits(shown(bars, hit, w, f), w, f), `${at} fits`);
          assert.ok(fits(shown(bars, hit, w, f, 0.1), w, f), `${at} fits with figures narrower than worked out`);
          assert.ok(!fits(shown(bars, hit, w, f * 1.01), w, f * 1.01), `${at} is as big as it goes`);
          layouts++;
        }
      }
    }
  assert.equal(layouts, (8 * 3 + 3 + 3) * 3 * 29);
});

test('fit: ten counts of 100 side by side on a phone come out a readable size', () => {
  const bars = barsOf({ min: 0, max: 100, step: 1 }, Array(10).fill(100));
  // a 360 px phone's chart, with the needle on one of them
  const f = resolve(countsFit(bars, 5)!, 328);
  assert.ok(f >= 12 && f < 16, `${f}`);
});
