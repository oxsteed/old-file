// Domain 7 #22: restaurant analytics must cap the pasted id list at 20 with
// a visible message, and dedupe ids before firing one request per id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(
  path.join(clientRoot, 'src/admin/pages/RestaurantAnalytics.jsx'), 'utf8');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(clientRoot, rel), 'utf8'));

test('the id list is deduped before fetching', () => {
  assert.match(src, /new Set\(/);
  assert.match(src, /\[...new Set\(parsed|uniqueIds\)\]/);
});

test('the id list is capped at 20', () => {
  assert.match(src, /const MAX_COMPARE_IDS = 20;/);
  assert.match(src, /uniqueIds\.slice\(0, MAX_COMPARE_IDS\)/);
});

test('a visible cap message names the limit when ids were dropped', () => {
  assert.match(src, /adminRestaurantAnalytics\.capped/);
  assert.match(src, /capNotice/);
  assert.match(src, /\{capNotice &&/);
});

test('the cap message key exists in all five locales with the count interpolation', () => {
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    const value = readJson(`src/locales/${lang}.json`).adminRestaurantAnalytics?.capped;
    assert.ok(typeof value === 'string' && value.length > 0, `${lang}: missing adminRestaurantAnalytics.capped`);
    assert.match(value, /\{\{count\}\}/, `${lang}: capped message must interpolate {{count}}`);
  }
});

test('per-row errors are still shown inline', () => {
  assert.match(src, /\{row\.error\}/);
});
