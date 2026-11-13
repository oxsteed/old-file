// Mobile/PWA M17: the kiosk 60s idle reset has no exemption for the
// credit-review step. Verified at build time: creditAttempt is set only
// inside payWithCredit at submit time, NOT during card/PIN entry or
// quote review, so a guest who pauses 60s to read the quoted total loses
// the cart and the quote. The review step with a live quote gets a longer
// window; the post-order 60s reset is correct by design and untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

test('M17: review with a quote gets the extended window; everything else keeps 60s', async () => {
  const { kioskIdleResetMs, KIOSK_IDLE_RESET_MS, KIOSK_PAYMENT_REVIEW_RESET_MS } = await import('../src/utils/kioskIdle.js');
  assert.equal(KIOSK_IDLE_RESET_MS, 60000);
  assert.equal(KIOSK_PAYMENT_REVIEW_RESET_MS, 180000);
  assert.equal(kioskIdleResetMs({ step: 'review', quoted: { totalCents: 1299 } }), 180000);
  assert.equal(kioskIdleResetMs({ step: 'review', quoted: null }), 60000, 'review before the quote lands keeps 60s');
  assert.equal(kioskIdleResetMs({ step: 'menu', quoted: null }), 60000);
  assert.equal(kioskIdleResetMs({ step: 'mode', quoted: null }), 60000);
});

test('M17: no timer while placing or mid credit attempt; start screen stays exempt', async () => {
  const { kioskIdleResetMs } = await import('../src/utils/kioskIdle.js');
  assert.equal(kioskIdleResetMs({ step: 'review', quoted: { totalCents: 1 }, placing: true }), null);
  assert.equal(kioskIdleResetMs({ step: 'review', quoted: { totalCents: 1 }, creditAttempt: 'abc' }), null);
  assert.equal(kioskIdleResetMs({ step: 'start', quoted: null }), null);
});

test('M17: FoodKioskPage wires the extended window and keeps the post-order 60s reset', () => {
  const src = fs.readFileSync(path.join(root, '../src/pages/food/FoodKioskPage.jsx'), 'utf8');
  assert.match(src, /kioskIdleResetMs/, 'page must use the idle-window helper');
  assert.match(src, /setTimeout\(resetAll, timeoutMs\)/, 'reset effect must use the helper window');
  // creditAttempt is set only at credit submit time, never during entry/review.
  const setters = [...src.matchAll(/setCreditAttempt\(/g)].length;
  assert.equal(setters, 2, 'setCreditAttempt must appear only in clearCreditAttempt and payWithCredit');
  assert.match(src, /resetTimer\.current = setTimeout\(resetAll, 60000\)/, 'post-order reset must stay 60s');
  assert.doesNotMatch(src, /setTimeout\(resetAll, RESET_AFTER_MS\)/, 'effect must not use the flat 60s constant');
});
