import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bannerModel, jobNeedsPaymentCheck, reauthErrorKey, formatCents } from '../src/utils/paymentReauthModel.js';

test('only flagged jobs trigger a state check', () => {
  assert.equal(jobNeedsPaymentCheck({ metadata: {} }), false);
  assert.equal(jobNeedsPaymentCheck(null), false);
  assert.equal(jobNeedsPaymentCheck({ metadata: { paymentAdjustmentRequired: 'reauthorization_required' } }), true);
  assert.equal(jobNeedsPaymentCheck({ metadata: { creditAdjustmentRequired: true } }), true);
});

test('banner model per requirement and viewer', () => {
  assert.equal(bannerModel({ required: false }), null);
  assert.deepEqual(bannerModel({ required: true, can_authorize: false, requirement: { card: 'reauthorization_required' } }), { mode: 'waiting' });
  const card = bannerModel({ required: true, can_authorize: true, requirement: { card: 'reauthorization_required', target_cents: 20500, authorized_cents: 18000 },
    latest_attempt: { status: 'pending', failure_code: 'card_declined', expires_at: '2030-01-01T00:00:00Z' } });
  assert.deepEqual(card, { mode: 'card', targetCents: 20500, authorizedCents: 18000, currency: 'USD', expiresAt: '2030-01-01T00:00:00Z', notice: 'lastDeclined' });
  assert.equal(bannerModel({ required: true, can_authorize: true, requirement: { card: 'intent_reprice_required', target_cents: 1 } }).mode, 'reprice');
  assert.deepEqual(bannerModel({ required: true, can_authorize: true, requirement: { credit: true, credit_amount_cents: 900 }, latest_attempt: { status: 'expired' } }),
    { mode: 'credit', creditCents: 900, currency: 'USD', notice: 'lastExpired' });
  const renew = bannerModel({ required: true, can_authorize: true, requirement: { card: 'hold_expiring', target_cents: 5000, authorized_cents: 5000, currency: 'CAD', hold_expires_at: '2030-01-02T00:00:00Z' } });
  assert.deepEqual(renew, { mode: 'renew', targetCents: 5000, authorizedCents: 5000, holdExpiresAt: '2030-01-02T00:00:00Z', currency: 'CAD', notice: null });
  assert.equal(jobNeedsPaymentCheck({ metadata: { paymentHoldRenewalRequired: true } }), true);
});

test('error codes map to localized keys that exist in every locale and catalog', () => {
  assert.equal(reauthErrorKey('credit_insufficient_funds'), 'creditInsufficient');
  assert.equal(reauthErrorKey('nope'), 'generic');
  for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
    for (const file of [`src/locales/${lang}.json`, `src/i18n/locales/${lang}/common.json`]) {
      const ns = JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url)))['jobPaymentReauth'];
      const en = JSON.parse(fs.readFileSync(new URL('../src/locales/en.json', import.meta.url)))['jobPaymentReauth'];
      assert.deepEqual(Object.keys(ns).sort(), Object.keys(en).sort(), file);
      assert.deepEqual(Object.keys(ns.errors).sort(), Object.keys(en.errors).sort(), file);
      for (const code of ['credit_insufficient_funds', 'impersonation_blocked', 'feature_disabled', 'payment_reauthorization_not_required', 'payment_reauthorization_amount_invalid', 'x']) {
        assert.ok(ns.errors[reauthErrorKey(code)], `${file} ${code}`);
      }
      for (const [key, value] of Object.entries(en)) {
        if (typeof value !== 'string') continue;
        for (const v of value.match(/\{\{\w+\}\}/g) || []) assert.ok(ns[key].includes(v), `${file} ${key} keeps ${v}`);
      }
    }
  }
});

test('money is formatted per locale', () => {
  assert.equal(formatCents(20500, 'en'), '$205.00');
  assert.equal(formatCents('x', 'en'), '');
  assert.equal(formatCents(1500, 'en', 'JPY'), '¥1,500');
  assert.match(formatCents(1234, 'en', 'KWD'), /^KWD\s1\.234$/);
});
