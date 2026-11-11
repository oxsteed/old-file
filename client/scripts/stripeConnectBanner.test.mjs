import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isStripeConnectReady,
  needsStripeConnectContinue,
} from '../src/utils/stripeConnectStatus.js';

const source = fs.readFileSync(
  path.resolve('src/components/invoices/HelperStripeConnectBanner.jsx'),
  'utf8',
);

test('Stripe Connect readiness requires both charges and payouts', () => {
  assert.equal(isStripeConnectReady({ connected: true, charges_enabled: true, payouts_enabled: true }), true);
  assert.equal(isStripeConnectReady({ connected: true, charges_enabled: true, payouts_enabled: false }), false);
  assert.equal(isStripeConnectReady({ connected: true, charges_enabled: false, payouts_enabled: true }), false);
  assert.equal(needsStripeConnectContinue({ connected: true, charges_enabled: true, payouts_enabled: false }), true);
  assert.equal(needsStripeConnectContinue({ connected: false, charges_enabled: true, payouts_enabled: true }), false);
});

test('banner refreshes status and only shows success after readiness is confirmed', () => {
  assert.match(source, /return nextStatus;/);
  assert.match(source, /const refreshedStatus = await load\(\);/);
  assert.match(source, /if \(isStripeConnectReady\(refreshedStatus\)\)/);
  assert.match(source, /toast\.error\(t\('businessHub\.integrations\.stripeChargesDisabled'/);
});
