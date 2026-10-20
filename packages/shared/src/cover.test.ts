import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COVER_ARTS, COVER_COLORS, cleanCover, coverColor, coverSeed, isCoverEmoji } from './cover';
import { SAMPLE_GAMES } from './sample-games';
import { validateGame } from './validate';

test('a cover emoji is one emoji, whatever it is made of', () => {
  for (const ok of ['😀', '👍🏽', '👨‍👩‍👧‍👦', '🇹🇭', '1️⃣', '#️⃣', '❤️', '☕', '☕\u{FE0E}', '©️', '🏴󠁧󠁢󠁥󠁮󠁧󠁿', '🧑🏿‍🚀', '🏳️‍🌈', '👩🏽‍❤️‍💋‍👨🏻']) {
    assert.equal(isCoverEmoji(ok), true, `${ok} ${JSON.stringify(ok)}`);
  }
  const no = [
    '', '😀😀', 'a', '1', '#', 'ก', '😀a', 'ab', '🇹', '🇹🇭🇹🇭', ' 😀', '😀'.repeat(13),
    // broken pieces: lone surrogates, a NUL, an accent, a loose style, skin tone, joiner, keycap or tag
    '\u{D83D}', '\u{DE00}', '😀\u{0}', '😀\u{301}', '\u{FE0F}', '\u{1F3FD}', '🙂\u{1F3FD}\u{1F3FD}',
    '🙂\u{200D}', '\u{200D}🙂', '🙂\u{200D}\u{200D}🙂', '1\u{20E3}\u{20E3}', '🏴\u{E0067}',
  ];
  for (const bad of no) assert.equal(isCoverEmoji(bad), false, JSON.stringify(bad));
});

test('a cover keeps known colors, pictures and one emoji, and drops anything else without an error', () => {
  assert.deepEqual(cleanCover({ color: 'teal', emoji: ' 🎉 ', art: 'party', extra: 'x' }), { color: 'teal', emoji: '🎉', art: 'party' });
  assert.deepEqual(cleanCover({ color: 'chartreuse', emoji: '🎉🎉', art: 'mona-lisa' }), undefined);
  assert.deepEqual(cleanCover({ color: 'gold', emoji: 'ใจ' }), { color: 'gold' });
  assert.deepEqual(cleanCover({ emoji: '🐘', color: 7 }), { emoji: '🐘' });
  assert.deepEqual(cleanCover({ art: 'TOWNHALL' }), undefined, 'names are exact');
  for (const junk of [null, undefined, 'teal', 42, ['teal'], {}, { color: null }]) assert.equal(cleanCover(junk), undefined, JSON.stringify(junk));
});

test('the cover color comes from the title unless one was picked, the same everywhere every time', () => {
  assert.equal(coverSeed('Quiz night'), coverSeed('Quiz night'));
  assert.equal(coverSeed('  Quiz night '), coverSeed('Quiz night'), 'spaces around the title do not change it');
  assert.notEqual(coverSeed('Quiz night'), coverSeed('Quiz night 2'));
  assert.equal(coverColor({ title: 'อะไรก็ได้', cover: { color: 'pink' } }), 'pink');
  const auto = coverColor({ title: 'Townhall ประจำเดือน' });
  assert.ok(COVER_COLORS.includes(auto));
  assert.equal(coverColor({ title: 'Townhall ประจำเดือน', cover: { emoji: '🎤' } }), auto, 'an emoji alone keeps the title color');
  // titles spread over every color
  const seen = new Set(Array.from({ length: 200 }, (_, i) => coverColor({ title: `เกมที่ ${i + 1}` })));
  assert.equal(seen.size, COVER_COLORS.length);
});

test('a played or shared game keeps a clean cover, and a game without one gets none', () => {
  const base = { title: 'T', rounds: [{ title: 'R', questions: [{ type: 'poll', prompt: 'Q', options: ['a', 'b'], correct: [], timeLimitS: 20 }] }] };
  const kept = validateGame({ ...base, cover: { color: 'sky', emoji: '🚀', art: 'nope' } });
  assert.ok(kept.ok);
  assert.deepEqual(kept.game.cover, { color: 'sky', emoji: '🚀' });
  const junk = validateGame({ ...base, cover: 'please draw a cat' });
  assert.ok(junk.ok, 'a bad cover never stops a game from being played');
  assert.equal('cover' in junk.game, false);
  const none = validateGame(base);
  assert.ok(none.ok);
  assert.equal('cover' in none.game, false);
});

test('every sample game has a drawn cover of its own', () => {
  const arts = SAMPLE_GAMES.map((g) => g.cover?.art);
  for (const [i, art] of arts.entries()) assert.ok(art && COVER_ARTS.includes(art), `${SAMPLE_GAMES[i].id} has no drawn cover`);
  assert.equal(new Set(arts).size, arts.length, 'no two samples share a cover');
  for (const g of SAMPLE_GAMES) {
    const res = validateGame(g);
    assert.ok(res.ok);
    assert.deepEqual(res.game.cover, g.cover);
  }
});
