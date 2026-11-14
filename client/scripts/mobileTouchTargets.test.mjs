// Mobile/PWA M16: primary mobile money CTAs are 40px tall (py-2.5), below
// Apple's 44pt minimum. The sticky Book/message buttons and the support FAB
// must be at least 44px tall (py-3 plus an explicit min-h-[44px]).
//
// Run: node --test scripts/mobileTouchTargets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');
const count = (s, re) => [...s.matchAll(re)].length;

test('sticky Book/message buttons are at least 44px tall', async () => {
  for (const [rel, buttons] of [
    ['src/pages/BusinessProfilePage.jsx', 3],
    ['src/pages/HelperBusinessProfilePage.tsx', 2],
  ]) {
    const page = await src(rel);
    // No 40px (py-2.5) sticky-bar button left.
    assert.doesNotMatch(page, /flex-1 py-2\.5/, rel);
    // Every sticky-bar button carries py-3 and an explicit 44px floor.
    assert.equal(count(page, /flex-1 py-3 min-h-\[44px\] rounded-xl/g), buttons, rel);
  }
});

test('the support FAB is at least 44px tall', async () => {
  const widget = await src('src/components/SupportWidget.jsx');
  assert.doesNotMatch(widget, /px-3\.5 py-2\.5/, 'main FAB still py-2.5');
  assert.match(widget, /px-3\.5 py-3 min-h-\[44px\]/, 'main FAB');
  assert.match(widget, /px-4 py-3 min-h-\[44px\]/, 'fallback FAB');
});
