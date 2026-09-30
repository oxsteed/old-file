'use strict';

const { stripeObjectId, invoiceSubscriptionId, subscriptionPeriod } = require('../utils/stripePayload');
const { verifiedChargeRefundTotal, applyChargeRefund } = require('../services/paymentRefundStateService');
const contract = require('../config/stripeWebhookContract');

test('legacy and Clover invoice subscription references normalize identically', () => {
  expect(invoiceSubscriptionId({ subscription: 'sub_1' })).toBe('sub_1');
  expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: { id: 'sub_1' } } } })).toBe('sub_1');
  expect(invoiceSubscriptionId({})).toBeNull();
  expect(stripeObjectId({ id: 'cus_1' })).toBe('cus_1');
});

test('subscription periods support legacy and item-level snapshots', () => {
  expect(subscriptionPeriod({ current_period_start: 100, current_period_end: 200 })).toEqual({ start: 100, end: 200 });
  expect(subscriptionPeriod({ items: { data: [{ current_period_start: 100, current_period_end: 200 }] } }))
    .toEqual({ start: 100, end: 200 });
  expect(subscriptionPeriod({})).toEqual({ start: null, end: null });
});

test('refund evidence rejects mismatched identity, amount, currency and totals', () => {
  const payment = { amount: '10.00', currency: 'usd', stripe_payment_intent_id: 'pi_1' };
  const charge = { id: 'ch_1', payment_intent: 'pi_1', amount: 1000, amount_refunded: 400, currency: 'usd' };
  expect(verifiedChargeRefundTotal(charge, payment)).toBe(400);
  for (const invalid of [{ amount_refunded: 1001 }, { payment_intent: 'pi_other' }, { amount: 900 }, { currency: 'eur' }]) {
    expect(() => verifiedChargeRefundTotal({ ...charge, ...invalid }, payment)).toThrow('could not be verified');
  }
});

test('charge refunds use cumulative monotonic amounts and only close fully refunded payments', async () => {
  const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
  await applyChargeRefund(client, { id: 'ch_1', payment_intent: { id: 'pi_1' }, amount: 1000, amount_refunded: 400, currency: 'usd' });
  const [sql, params] = client.query.mock.calls[0];
  expect(sql).toContain('GREATEST');
  expect(sql).toContain("CASE WHEN $1::numeric >= amount THEN 'refunded' ELSE status END");
  expect(params).toEqual([4, 'ch_1', 'pi_1', 1000, 'usd']);
});

test('webhook destination contracts have distinct secrets and bounded event lists', () => {
  expect(new Set(Object.values(contract).map(item => item.secretEnv)).size).toBe(3);
  expect(contract.platform.events).toContain('invoice.paid');
  expect(contract.platform.events).toContain('checkout.session.expired');
  expect(contract.connect.events).not.toContain('invoice.paid');
  expect(contract.identity.events.every(event => event.startsWith('identity.'))).toBe(true);
  for (const destination of Object.values(contract)) {
    expect(destination.events).not.toContain('*');
    expect(new Set(destination.events).size).toBe(destination.events.length);
  }
});
