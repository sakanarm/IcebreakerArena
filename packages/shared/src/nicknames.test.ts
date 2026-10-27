import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NICKNAME_MAX, cleanNickname } from './nicknames';

test('nicknames: invisible characters go, so a name can not pass for another or for none', () => {
  assert.equal(cleanNickname('Bob\u200b'), 'Bob');
  assert.equal(cleanNickname('B\u200co\u200db\ufeff'), 'Bob');
  assert.equal(cleanNickname('\u202eboB'), 'boB', 'a right-to-left override would turn every name after it around');
  assert.equal(cleanNickname('a\u2066b\u2069c\u200fd'), 'abcd');
  assert.equal(cleanNickname('so\u00adft'), 'soft');
  assert.equal(cleanNickname('\u3164'), '', 'a Hangul filler looks like no name: the server gives a random one');
  assert.equal(cleanNickname('\u2800 \u115f\u1160 \uffa0'), '');
  assert.equal(cleanNickname('x\u0085y\u009fz'), 'xyz');
});

test('nicknames: emoji made of joined emoji stay whole', () => {
  const joined = ['\u{1f469}\u200d\u{1f4bb}', '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}', '❤\ufe0f\u200d\u{1f525}', '\u{1f9d1}\u{1f3fd}\u200d\u{1f680}', '\u{1f3f3}\ufe0f\u200d\u{1f308}'];
  for (const e of joined) assert.equal(cleanNickname(`${e} Mai`), `${e} Mai`, e);
  assert.equal(cleanNickname('a\u200db'), 'ab', 'a joiner between letters is no emoji');
  assert.equal(cleanNickname('\u200d\u{1f600}'), '\u{1f600}');
});

test('nicknames: Thai keeps its marks, piled-up marks are cut', () => {
  for (const th of ['สั่งได้', 'น้ำใจ', 'กุ้ง', 'ปิ๊ง', 'แมวน้ำสายชิล']) assert.equal(cleanNickname(th), th);
  assert.equal(cleanNickname('q\u0301\u0302\u0303\u0304\u0305\u0306o'), 'q\u0301\u0302\u0303o');
  assert.equal(cleanNickname('ก' + '\u0e48'.repeat(30)), 'ก\u0e48\u0e48\u0e48');
});

test('nicknames: the length cap never splits a letter or an emoji', () => {
  const out = cleanNickname('แมว'.repeat(5) + '\u{1f469}\u200d\u{1f4bb}'.repeat(5));
  assert.ok(out.length <= NICKNAME_MAX, out);
  assert.ok(!/[\ud800-\udbff]$|\u200d$/.test(out), JSON.stringify(out));
  assert.equal(cleanNickname('ก'.repeat(23) + 'กุ้'), 'ก'.repeat(23), 'a letter with its marks goes whole or not at all');
  assert.equal(cleanNickname('  a   b \u3000 c  '), 'a b c');
  assert.equal(cleanNickname('<b>hi</b>'), 'bhi/b');
});
