// Mobile/PWA M10: Cancel stays live during card confirm and Pay has a
// double-submit window (the state update is async, so a rapid double-tap
// can submit twice before re-render). Fix: a synchronous submit guard ref
// in pay(), Cancel disabled while paying, Cancel hidden once
// confirmCardPayment resolves.
// Note: the server confirm is idempotent (cartCheckoutController.js:274
// idempotencyKey, :461), so the risk is UX confusion/retry friction, not
// a double charge.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

test('M10: submit guard admits one flight and re-arms after release', async () => {
  const { createSubmitGuard } = await import('../src/utils/submitGuard.js');
  const guard = createSubmitGuard();
  assert.equal(guard.isHeld, false);
  assert.equal(guard.tryAcquire(), true, 'first submit acquires');
  assert.equal(guard.isHeld, true);
  assert.equal(guard.tryAcquire(), false, 'second submit while in flight is refused');
  guard.release();
  assert.equal(guard.isHeld, false);
  assert.equal(guard.tryAcquire(), true, 'a failed attempt can be retried after release');
});

test('M10: pay() is guarded synchronously and Cancel is tamed while paying', () => {
  const src = fs.readFileSync(path.join(root, '../src/pages/CheckoutPage.jsx'), 'utf8');
  assert.match(src, /createSubmitGuard/, 'CardPaymentForm must use the submit guard');
  const pay = src.match(/const pay = async \(event\) => \{[\s\S]*?\n  \};/);
  assert.ok(pay, 'pay() handler must exist');
  assert.match(pay[0], /tryAcquire\(\)/, 'pay() must acquire the guard before doing work');
  assert.ok(
    pay[0].indexOf('tryAcquire()') < pay[0].indexOf('confirmCardPayment'),
    'the guard must be acquired before confirmCardPayment runs',
  );
  assert.match(pay[0], /release\(\)/, 'pay() must release the guard so failures can retry');
  assert.match(pay[0], /onCardConfirmed\?\.?\(\)/, 'pay() must report once confirmCardPayment resolves');
  assert.match(src, /cardPaying/, 'parent must track the paying state for Cancel');
  assert.match(src, /cardConfirmed/, 'parent must track card-confirmed state for Cancel');
  assert.match(src, /disabled=\{cardPaying\}/, 'Cancel must be disabled while paying');
  assert.match(src, /\{!cardConfirmed && \(/, 'Cancel must hide once the card is confirmed');
});
