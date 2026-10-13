'use strict';

// Review P2-572 / P2-574.
const { toLocalSubscriptionStatus } = require('../utils/subscriptionStatus');

test.each([
  ['active', 'active'], ['trialing', 'trialing'], ['past_due', 'past_due'],
  ['unpaid', 'past_due'], ['canceled', 'cancelled'], ['incomplete', 'none'],
  ['incomplete_expired', 'cancelled'], ['paused', 'paused'], [undefined, 'none'], ['weird', 'none'],
])('%s -> %s', (stripe, local) => {
  expect(toLocalSubscriptionStatus(stripe)).toBe(local);
});

test('every mapped value is a member of the subscription_status enum', () => {
  const enumValues = new Set(['none', 'trialing', 'active', 'past_due', 'cancelled', 'paused']);
  for (const s of ['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused']) {
    expect(enumValues.has(toLocalSubscriptionStatus(s))).toBe(true);
  }
});

test('webhook never writes a raw Stripe status and never looks up users.stripe_customer_id', () => {
  const src = require('fs').readFileSync(require.resolve('../controllers/webhookController.js'), 'utf8');
  expect(src).not.toMatch(/FROM users WHERE stripe_customer_id/);
  expect(src).not.toMatch(/\[sub\.status,/);
  expect(src).not.toMatch(/stripeObjectId\((session|sub)\.customer\), sub\.status/);
});
