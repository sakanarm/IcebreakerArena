import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isOrder,
  isRightOrder,
  matchTyped,
  normalizeTyped,
  onScale,
  sliderBin,
  sliderBinRanges,
  sliderBins,
  sliderCloseness,
  sliderStart,
} from './answers';

test('typed answers ignore case, spaces, punctuation, zero-width and full-width characters', () => {
  for (const s of ['Tom-Yum', 'tom yum', 'TOMYUM', ' t.o.m y_u_m!! ', 'ＴＯＭ　ＹＵＭ', 'tom​yum', '"tom" (yum)']) {
    assert.equal(normalizeTyped(s), 'tomyum', s);
  }
  assert.equal(normalizeTyped('?! .,'), '');
});

test('Thai typed the way it looks matches, whatever order its marks went in', () => {
  const same = (a: string, b: string) => assert.equal(normalizeTyped(a), normalizeTyped(b), `${a} vs ${b}`);
  same('ต้ม ยำ กุ้ง', 'ต้มยำกุ้ง');
  same('น้ำ', 'นำ้'); // น้ำ, with ำ typed before the tone mark
  same('น้ำ', 'น้ํา'); // ำ typed as ํ + า
  same('กิ้ง', 'ก้ิง'); // กิ้ง, with the tone mark typed first
  same('กุ้ง', 'กุ้ง'); // กุ้ง, the same with a vowel below
  same('เเมว', 'แมว'); // เเ typed for แ
  same('กรุงเทพฯ', 'กรุงเทพ');
  same('๗๗ จังหวัด', '77จังหวัด');
  assert.notEqual(normalizeTyped('ข้าว'), normalizeTyped('ขาว'), 'tone marks still count');
  assert.notEqual(normalizeTyped('งูๆ ปลาๆ'), normalizeTyped('งู ปลา'), 'repetition marks still count');
  assert.notEqual(normalizeTyped('C++'), normalizeTyped('C'), 'symbols that carry meaning stay');
});

test('a typed text matches the accepted answer it equals, or none', () => {
  const accepted = ['ต้มยำกุ้ง', 'Tom Yum'];
  assert.equal(matchTyped(accepted, 'ต้มยำกุ้ง'), 0);
  assert.equal(matchTyped(accepted, 'tom-yum!'), 1);
  assert.equal(matchTyped(accepted, 'tom yum goong'), -1);
  assert.equal(matchTyped(accepted, '   '), -1);
  assert.equal(matchTyped(['!!'], '??'), -1, 'nothing left to compare is never a match');
});

test('a puzzle answer places every shown item exactly once', () => {
  assert.ok(isOrder([2, 0, 1], 3));
  for (const bad of [[0, 1], [0, 1, 1], [0, 1, 3], [0, 1, -1], [0, 1, 1.5], ['0', 1, 2], null, '012', { 0: 0, length: 3 }]) {
    assert.equal(isOrder(bad, 3), false, JSON.stringify(bad));
  }
});

test('a puzzle is right only when the picks follow the authored order', () => {
  // players see authored items #2, #0, #1: the right picks are the 2nd shown, the 3rd, then the 1st
  const shown = [2, 0, 1];
  assert.ok(isRightOrder(shown, [1, 2, 0]));
  assert.equal(isRightOrder(shown, [0, 1, 2]), false);
  assert.equal(isRightOrder(shown, [1, 0, 2]), false);
  assert.equal(isRightOrder(shown, [1, 2]), false);
});

test('slider values are whole numbers on a step of the scale', () => {
  const s = { min: -10, max: 10, step: 5 };
  for (const v of [-10, -5, 0, 5, 10]) assert.ok(onScale(s, v), String(v));
  for (const v of [-15, 15, -7, 2.5, NaN, Infinity, '5', null, undefined]) assert.equal(onScale(s, v), false, String(v));
});

test('slider closeness: full at the answer, half at the edge of the margin, nothing past it', () => {
  const s = { answer: 50, margin: 10 };
  assert.equal(sliderCloseness(s, 50), 1);
  assert.equal(sliderCloseness(s, 55), 0.75);
  assert.equal(sliderCloseness(s, 45), 0.75);
  assert.equal(sliderCloseness(s, 40), 0.5);
  assert.equal(sliderCloseness(s, 60), 0.5);
  assert.equal(sliderCloseness(s, 61), 0);
  assert.equal(sliderCloseness({ answer: 50, margin: 0 }, 50), 1);
  assert.equal(sliderCloseness({ answer: 50, margin: 0 }, 51), 0);
});

test('the phone slider starts on the middle step of the scale', () => {
  assert.equal(sliderStart({ min: 0, max: 100, step: 1 }), 50);
  assert.equal(sliderStart({ min: 0, max: 4000, step: 5 }), 2000);
  assert.equal(sliderStart({ min: 0, max: 255, step: 1 }), 128);
  assert.equal(sliderStart({ min: 0, max: 30, step: 10 }), 20);
  assert.equal(sliderStart({ min: -7, max: 7, step: 1 }), 0);
});

test('the guesses chart: up to 10 stretches covering the scale with no gap and no overlap', () => {
  const specs = [
    { min: 0, max: 100, step: 1 },
    { min: 0, max: 4, step: 1 },
    { min: 0, max: 10, step: 5 },
    { min: 0, max: 255, step: 1 },
    { min: -7, max: 7, step: 1 },
    { min: 0, max: 4000, step: 5 },
    { min: 1980, max: 2020, step: 1 },
    { min: 0, max: 18, step: 2 },
  ];
  for (const s of specs) {
    const name = JSON.stringify(s);
    const ranges = sliderBinRanges(s);
    assert.equal(ranges.length, sliderBins(s), name);
    assert.ok(ranges.length <= 10, name);
    assert.equal(ranges[0]?.lo, s.min, name);
    assert.equal(ranges.at(-1)?.hi, s.max, name);
    for (let b = 0; b < ranges.length; b++) {
      const r = ranges[b];
      assert.ok(r, `${name}: stretch ${b} is empty`);
      assert.equal(sliderBin(s, r.lo), b, name);
      assert.equal(sliderBin(s, r.hi), b, name);
      if (b > 0) assert.equal(r.lo, ranges[b - 1]!.hi + s.step, `${name}: stretch ${b} does not follow on`);
    }
  }
  assert.deepEqual(
    sliderBinRanges({ min: 0, max: 4, step: 1 }).map((r) => [r.lo, r.hi]),
    [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]],
  );
  assert.deepEqual(sliderBinRanges({ min: 0, max: 100, step: 0 }), [], 'a broken step does not loop forever');
  assert.deepEqual(sliderBinRanges({ min: 5, max: 5, step: 1 }), []);
});
