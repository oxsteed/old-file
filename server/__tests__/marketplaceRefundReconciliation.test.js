'use strict';

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
const stripe = require('stripe')();
const {
  processMarketplaceRefund,
  stableIdempotencyKey,
} = require('../services/marketplaceRefundService');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('uses a stable refund key and rejects malformed caller keys', () => {
  expect(() => stableIdempotencyKey(42, 1250)).toThrow(expect.objectContaining({ code: 'refund_idempotency_required' }));
  expect(stableIdempotencyKey(42, 1250, 'cancel-retry-1')).toBe('marketplace:42:cancel-retry-1');
  expect(stableIdempotencyKey(42, 1250, 'second-refund-1')).not.toBe(stableIdempotencyKey(42, 1250, 'cancel-retry-1'));
  expect(() => stableIdempotencyKey(42, 1250, 'bad key')).toThrow(expect.objectContaining({ code: 'refund_idempotency_invalid' }));
});

test('reserves, settles, and records a partial refund without marking the order fully refunded', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: 42, status: 'paid' }] })
    .mockResolvedValueOnce({ rows: [{ id: 9, order_id: 42, payment_intent_id: 'pi_42', amount_cents: 1000, currency: 'usd', status: 'succeeded', refunded_amount_cents: 0 }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 7, order_id: 42, transaction_id: 9, payment_intent_id: 'pi_42', amount_cents: 400, reason: 'Damaged item', idempotency_key: 'marketplace:42:partial-refund-42', status: 'pending', actor_user_id: 3 }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, order_id: 42, transaction_id: 9, payment_intent_id: 'pi_42', amount_cents: 400, reason: 'Damaged item', idempotency_key: 'marketplace:42:partial-refund-42', status: 'pending', actor_user_id: 3 }] })
    .mockResolvedValueOnce({ rows: [{ id: 9, amount_cents: 1000, refunded_amount_cents: 0, currency: 'usd', status: 'succeeded' }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, amount_cents: 400, status: 'succeeded', provider_refund_id: 're_42' }] })
    .mockResolvedValueOnce({ rows: [{ id: 9, amount_cents: 1000, refunded_amount_cents: 400, status: 'succeeded' }] })
    .mockResolvedValueOnce({ rows: [{ id: 42, status: 'paid' }] })
    .mockResolvedValueOnce({ rows: [] });
  stripe.refunds.create.mockResolvedValueOnce({
    id: 're_42', payment_intent: 'pi_42', amount: 400, currency: 'usd', status: 'succeeded',
  });

  const result = await processMarketplaceRefund({
    orderId: 42,
    requestedAmountCents: 400,
    reason: 'Damaged item',
    actorUserId: 3,
    requestId: 'partial-refund-42',
  });

  expect(result.refund.status).toBe('succeeded');
  expect(result.order.status).toBe('paid');
  expect(result.transaction.refunded_amount_cents).toBe(400);
  expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({
    payment_intent: 'pi_42',
    amount: 400,
    metadata: expect.objectContaining({ orderId: '42' }),
  }), expect.objectContaining({ idempotencyKey: 'marketplace:42:partial-refund-42' }));
});

test('the migration creates durable refund state and cumulative guards', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../migrations/596_marketplace_refund_reconciliation.sql'), 'utf8');
  expect(migration).toContain('marketplace_transaction_refunds');
  expect(migration).toContain('refunded_amount_cents');
  expect(migration).toContain('idempotency_key VARCHAR(255) NOT NULL UNIQUE');
  expect(migration).toContain('refunded_amount_cents <= amount_cents');
});
