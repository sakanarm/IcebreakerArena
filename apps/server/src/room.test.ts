import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shuffled } from './room';

test('a puzzle shuffle is a full reorder that never shows the right order, and every other order turns up', () => {
  for (const n of [3, 4]) {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const order = shuffled(n);
      assert.deepEqual([...order].sort(), Array.from({ length: n }, (_, k) => k));
      assert.ok(order.some((v, k) => v !== k), `left in the right order: ${order}`);
      seen.add(order.join());
    }
    // n! orders less the right one: 5 for three items, 23 for four
    assert.equal(seen.size, n === 3 ? 5 : 23);
  }
  assert.deepEqual(shuffled(1), [0]);
});
