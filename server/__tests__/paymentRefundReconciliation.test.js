'use strict';

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');
const stripe = require('stripe')();
const {
  processPaymentRefund,
  refundIdempotencyKey,
} = require('../services/paymentRefundService');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('requires caller idempotency and keeps distinct refund intents distinct', () => {
  expect(() => refundIdempotencyKey(7)).toThrow(expect.objectContaining({ code: 'payment_refund_idempotency_required' }));
  expect(refundIdempotencyKey(7, 'refund-one-1')).toBe('payment:7:refund-one-1');
  expect(refundIdempotencyKey(7, 'refund-two-1')).not.toBe(refundIdempotencyKey(7, 'refund-one-1'));
});

test('settles a partial payment refund without marking the payment fully refunded', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 7, job_id: 'job-7', amount: '10.00', refunded_amount: '0.00', currency: 'usd',
      status: 'captured', payment_hold_status: 'held', stripe_payment_intent_id: 'pi_7',
      stripe_account_id: 'acct_7',
    }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{
      id: 11, payment_id: 7, amount_cents: 400, reason: 'Damaged item',
      reverse_application_fee: false, idempotency_key: 'payment:7:refund-one-1', status: 'pending',
      actor_user_id: 'user-7',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 11, payment_id: 7, amount_cents: 400, reason: 'Damaged item',
      reverse_application_fee: false, idempotency_key: 'payment:7:refund-one-1', status: 'pending',
      actor_user_id: 'user-7',
    }] })
    .mockResolvedValueOnce({ rows: [{
      id: 7, job_id: 'job-7', amount: '10.00', refunded_amount: '0.00', currency: 'usd',
      status: 'captured', payment_hold_status: 'held', stripe_payment_intent_id: 'pi_7',
      stripe_account_id: 'acct_7',
    }] })
    .mockResolvedValueOnce({ rows: [{ id: 11, amount_cents: 400, status: 'succeeded', stripe_refund_id: 're_7' }] })
    .mockResolvedValueOnce({ rows: [{ id: 7, amount: '10.00', refunded_amount: '4.00', status: 'captured' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });
  stripe.refunds.create.mockResolvedValueOnce({
    id: 're_7', payment_intent: 'pi_7', amount: 400, currency: 'usd', status: 'succeeded',
  });

  const result = await processPaymentRefund({
    paymentId: 7,
    requestedAmountCents: 400,
    reason: 'Damaged item',
    actorUserId: 'user-7',
    requestId: 'refund-one-1',
  });

  expect(result.attempt.status).toBe('succeeded');
  expect(result.payment.status).toBe('captured');
  expect(result.payment.refunded_amount).toBe('4.00');
  expect(stripe.refunds.create).toHaveBeenCalledWith({
    payment_intent: 'pi_7',
    amount: 400,
  }, expect.objectContaining({
    stripeAccount: 'acct_7',
    idempotencyKey: 'payment:7:refund-one-1',
  }));
});

test('migration creates durable payment refund attempts and cumulative guards', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../migrations/597_payment_refund_reconciliation.sql'), 'utf8');
  expect(migration).toContain('payment_refund_attempts');
  expect(migration).toContain('idempotency_key VARCHAR(255) NOT NULL UNIQUE');
  expect(migration).toContain('payments_refunded_amount_check');
  expect(migration).toContain("status IN ('pending', 'succeeded', 'failed', 'canceled')");
});
