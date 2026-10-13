'use strict';
const { mockQuery, resetMocks } = require('./setup');
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/localDeliveryPaymentService', () => ({ handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }) }));
jest.mock('../controllers/verificationController', () => ({ recalculateBadges: jest.fn().mockResolvedValue(true) }));
jest.mock('../services/restaurantInventoryOrderService', () => ({ releaseInventoryForOrder: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/restaurantPosPaymentLedgerService', () => ({ applyStripePaymentIntent: jest.fn().mockResolvedValue({}), applyStripeRefund: jest.fn(), applyStripeChargeRefund: jest.fn() }));
const express = require('express');
const request = require('supertest');
const stripe = require('stripe')();
const { sendNotification } = require('../services/notificationService');
const routes = require('../routes/webhook');
function app() { const a = express(); a.use('/api/webhooks', routes); return a; }
function send(type, object, id = 'evt_lifecycle') {
  stripe.webhooks.constructEvent.mockReturnValueOnce({ id, created: 1700000000, type, data: { object } });
  return request(app()).post('/api/webhooks/stripe').set('stripe-signature', 'synthetic-signature').set('Content-Type', 'application/json').send('{}');
}
beforeEach(() => {
  resetMocks(); jest.clearAllMocks();
  mockQuery.mockImplementation(async (sql) => {
    if (/INSERT INTO webhook_event_(receipts|watermarks)/.test(sql)) return { rows: [{ id: 90 }] };
    if (/FROM subscriptions WHERE stripe_subscription_id/.test(sql)) return { rows: [{ user_id: 'customer', plan_id: null }] };
    if (/UPDATE food_orders/.test(sql)) return { rows: [{ id: 8, customer_id: 'food-customer', restaurant_id: 2 }] };
    return { rows: [] };
  });
  sendNotification.mockResolvedValue({ success: true });
});
test.each([
  ['customer.subscription.updated', { id: 'sub_1', status: 'past_due' }, 'subscription_past_due', 'stripe:subscription_past_due:evt_lifecycle:customer'],
  ['customer.subscription.deleted', { id: 'sub_1' }, 'subscription_cancelled', 'stripe:subscription_cancelled:sub_1:customer'],
  ['invoice.paid', { id: 'in_1', subscription: 'sub_1' }, 'subscription_renewed', 'stripe:subscription_renewed:in_1:customer'],
  ['invoice.payment_failed', { id: 'in_1', subscription: 'sub_1' }, 'subscription_past_due', 'stripe:subscription_past_due:in_1:customer'],
])('%s emits the customer lifecycle notification with a stable delivery key', async (event, object, type, key) => {
  stripe.subscriptions.retrieve.mockResolvedValueOnce({ id: 'sub_1', status: 'active', current_period_start: 1700000000, current_period_end: 1702678400 });
  const result = await send(event, object);
  expect(result.status).toBe(200);
  expect(require('fs').readFileSync(require('path').resolve(__dirname, '../../client/src/App.jsx'), 'utf8')).toMatch(/Route path="\/settings"/);
  expect(sendNotification).toHaveBeenCalledTimes(1);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'customer', type, idempotencyKey: key, action_url: '/settings' }));
});
test('failed food-card payment waits for notification delivery before acknowledging the webhook', async () => {
  let resolve;
  let called;
  const started = new Promise((r) => { called = r; });
  sendNotification.mockImplementation(() => { called(); return new Promise((r) => { resolve = r; }); });
  let completed = false;
  const pending = send('payment_intent.payment_failed', { id: 'pi_food', metadata: { food_order_id: '8' } })
    .then((response) => { completed = true; return response; });
  await Promise.race([started, pending.then(() => { throw new Error('Webhook returned without emitting the notification'); })]);
  expect(completed).toBe(false);
  expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'food-customer', type: 'payment_failed',
    action_url: '/food/orders/8', idempotencyKey: 'stripe:food-order-payment-failed:pi_food:8' }));
  resolve({ success: true });
  expect((await pending).status).toBe(200);
});
test.each([true, false])('processor account.updated verifies or demotes methods when payouts_enabled=%s', async (enabled) => {
  mockQuery.mockImplementation(async (sql) => {
    if (/INSERT INTO webhook_event_(receipts|watermarks)/.test(sql)) return { rows: [{ id: 90 }] };
    if (/SELECT user_id\s+FROM connect_accounts/.test(sql)) return { rows: [{ user_id: 'helper' }] };
    return { rows: [] };
  });
  expect((await send('account.updated', { id: 'acct_owned', charges_enabled: true, payouts_enabled: enabled })).status).toBe(200);
  const update = mockQuery.mock.calls.find(([sql]) => /UPDATE payout_methods/.test(sql));
  expect(update).toBeDefined(); expect(update[1]).toEqual(['acct_owned', enabled, 'helper']);
  expect(update[0]).toContain('helper_id = $3');
  expect(update[0]).toContain("status IN ('pending', 'verified', 'active')");
  expect(update[0]).toContain("THEN 'verified' ELSE 'pending'");
  expect(update[0]).toContain('ELSE NULL END');
});

test('an unlinked processor account cannot verify a payout method', async () => {
  expect((await send('account.updated', { id: 'acct_unknown', payouts_enabled: true })).status).toBe(200);
  expect(mockQuery.mock.calls.some(([sql]) => /UPDATE payout_methods/.test(sql))).toBe(false);
});
