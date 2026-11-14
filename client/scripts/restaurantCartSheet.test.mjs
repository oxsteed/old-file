// Mobile/PWA M18: the restaurant float cart uses nowrap with no max-width
// and can clip at 320px; the cart sheet uses max-height 92vh, which jumps on
// iOS as the URL bar moves. The float cart is capped to the viewport and the
// sheet uses the dvh-based --pwa-viewport-height variable already published
// by PwaExperience.css / mobileViewport.js.
//
// Run: node --test scripts/restaurantCartSheet.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFile(join(root, rel), 'utf8');
const block = (css, selector) => {
  const m = css.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`, 's'));
  assert.ok(m, `${selector} rule missing`);
  return m[1];
};

test('the float cart cannot overflow a 320px viewport', async () => {
  const css = await src('src/styles/FoodRestaurantPage.css');
  const cart = block(css, '.rp-float-cart');
  assert.match(cart, /max-width:\s*calc\(100vw - 1rem\)/);
});

test('the cart sheet heights from the dvh-based viewport variable, not vh', async () => {
  const css = await src('src/styles/FoodRestaurantPage.css');
  const sheet = block(css, '.rp-sheet');
  assert.match(sheet, /max-height:\s*calc\(var\(--pwa-viewport-height\) \* 0\.92\)/);
  // No raw vh unit in the max-height declaration itself (the comment may
  // still name the old 92vh value it replaced).
  assert.doesNotMatch(sheet, /max-height:[^;]*\d+vh/);
});
