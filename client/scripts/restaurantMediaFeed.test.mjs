// Tests for the restaurant Media feed pure helpers
// (client/src/utils/restaurantMedia.js) and i18n key parity.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  dishLinkState,
  applyLikeToggle,
  MEDIA_FLAG_REASONS,
} from '../src/utils/restaurantMedia.js';

const root = path.resolve(import.meta.dirname, '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(root, `src/locales/${lang}.json`), 'utf8'));
const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];

test('dishLinkState: live dishes are tappable, rotated dishes are snapshot-only', () => {
  assert.equal(dishLinkState({ available: true }), 'tappable');
  assert.equal(dishLinkState({ available: false }), 'snapshot');
  // Missing/ambiguous availability fails closed to snapshot text.
  assert.equal(dishLinkState({}), 'snapshot');
  assert.equal(dishLinkState(null), 'snapshot');
  assert.equal(dishLinkState({ available: 'yes' }), 'snapshot');
});

test('applyLikeToggle flips liked_by_me and adjusts the count', () => {
  const liked = applyLikeToggle({ id: 1, liked_by_me: false, like_count: 4 });
  assert.equal(liked.liked_by_me, true);
  assert.equal(liked.like_count, 5);

  const unliked = applyLikeToggle({ id: 1, liked_by_me: true, like_count: 5 });
  assert.equal(unliked.liked_by_me, false);
  assert.equal(unliked.like_count, 4);

  // Count never goes negative on a stale row.
  const zero = applyLikeToggle({ id: 1, liked_by_me: true, like_count: 0 });
  assert.equal(zero.like_count, 0);

  // Other fields survive the optimistic update.
  const kept = applyLikeToggle({ id: 7, caption: 'hi', liked_by_me: false, like_count: 0 });
  assert.equal(kept.id, 7);
  assert.equal(kept.caption, 'hi');
});

test('flag reasons match the server contract', () => {
  assert.deepEqual([...MEDIA_FLAG_REASONS].sort(), ['broken', 'inappropriate', 'spam', 'unrelated']);
});

const leaves = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    (v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

test('media i18n keys have full parity across all five locales', () => {
  const enLeaves = leaves(catalog('en').food.restaurant.media).sort();
  assert.ok(enLeaves.length > 40, `expected many media keys, got ${enLeaves.length}`);
  for (const lang of LANGUAGES) {
    const got = leaves(catalog(lang).food.restaurant.media).sort();
    assert.deepEqual(got, enLeaves, `${lang}: media key parity mismatch`);
    assert.equal(catalog(lang).food.restaurant.tabs.media.trim().length > 0, true, `${lang}: tabs.media empty`);
  }
});

test('captionCount placeholders match across locales', () => {
  const placeholders = (value) => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
  const en = placeholders(catalog('en').food.restaurant.media.postModal.captionCount);
  assert.equal(en, 'count,max');
  for (const lang of LANGUAGES) {
    assert.equal(
      placeholders(catalog(lang).food.restaurant.media.postModal.captionCount),
      en,
      `${lang}: captionCount placeholders`,
    );
  }
});

test('no em dashes in media copy', () => {
  const strings = (obj) => Object.values(obj).flatMap((v) => (v && typeof v === 'object' ? strings(v) : [String(v)]));
  for (const lang of LANGUAGES) {
    for (const s of strings(catalog(lang).food.restaurant.media)) {
      assert.ok(!s.includes('—'), `${lang}: em dash found in ${JSON.stringify(s)}`);
    }
    assert.ok(!catalog(lang).food.restaurant.tabs.media.includes('—'), `${lang}: em dash in tabs.media`);
  }
});
