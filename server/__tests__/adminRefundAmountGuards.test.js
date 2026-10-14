'use strict';

/**
 * adminRefundAmountGuards.test.js — ADM-009
 *
 * A cleared refund-amount input serializes as NaN -> null over JSON. The
 * services used to interpret null as "refund the full remaining balance",
 * so clearing the field silently issued a FULL refund. Fail-closed contract:
 *  - null/undefined/NaN/'' amount without fullRefund: true -> 400
 *  - fullRefund: true with no amount -> full remaining balance
 *  - explicit positive whole-cent amount -> honored (capped at remaining)
 *  - both amount AND fullRefund: true -> 400 (ambiguous)
 */

const { mockQuery, resetMocks } = require('./setup');

const marketplace = require('../services/marketplaceRefundService');
const paymentRefunds = require('../services/paymentRefundService');

function seq(handlers) {
  let i = 0;
  mockQuery.mockImplementation(async () => {
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    const out = typeof handler === 'function' ? handler() : handler;
    return Array.isArray(out) ? { rows: out } : out;
  });
}

const ORDER = { id: 7, customer_id: 'cust-1', status: 'paid', refund_reason: null };
const TRANSACTION = {
  id: 11,
  status: 'succeeded',
  payment_intent_id: 'pi_123',
  amount_cents: 5000,
  refunded_amount_cents: 0,
  currency: 'usd',
};
const REFUND_ROW = { id: 21, amount_cents: 5000, status: 'pending', transaction_id: 11 };

function marketplaceHappyPath({ refundAmountCents = 5000 } = {}) {
  seq([
    [ORDER],
    [TRANSACTION],
    [], // no existing refund reservation
    [{ ...REFUND_ROW, amount_cents: refundAmountCents }],
  ]);
}

const PAYMENT = {
  id: 'pay-1',
  job_id: 'job-1',
  status: 'captured',
  stripe_payment_intent_id: 'pi_123',
  amount: '50.00',
  refunded_amount: null,
  currency: 'usd',
};
const ATTEMPT_ROW = { id: 31, payment_id: 'pay-1', amount_cents: 5000, status: 'pending', kind: 'refund' };

function paymentHappyPath({ amountCents = 5000 } = {}) {
  seq([
    [], // no existing attempt
    [PAYMENT],
    [], // no open dispute
    [{ ...ATTEMPT_ROW, amount_cents: amountCents }],
  ]);
}

beforeEach(() => {
  resetMocks();
});

describe('marketplace reserveRefund (ADM-009)', () => {
  const base = {
    orderId: 7,
    reason: 'test',
    actorUserId: 'admin-1',
    requestId: 'test-key-12345678',
  };

  test('null amount without fullRefund is rejected (400), not a silent full refund', async () => {
    marketplaceHappyPath();
    await expect(marketplace.reserveRefund({ ...base, requestedAmountCents: null }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO marketplace_transaction_refunds'))).toBe(false);
  });

  test('undefined amount without fullRefund is rejected (400)', async () => {
    marketplaceHappyPath();
    await expect(marketplace.reserveRefund({ ...base, requestedAmountCents: undefined }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
  });

  test('NaN amount (cleared input) is rejected (400)', async () => {
    marketplaceHappyPath();
    await expect(marketplace.reserveRefund({ ...base, requestedAmountCents: NaN }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
  });

  test('empty-string amount is rejected (400)', async () => {
    marketplaceHappyPath();
    await expect(marketplace.reserveRefund({ ...base, requestedAmountCents: '' }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
  });

  test('fullRefund: true with no amount refunds the full remaining balance', async () => {
    marketplaceHappyPath({ refundAmountCents: 5000 });
    const { refund } = await marketplace.reserveRefund({ ...base, requestedAmountCents: null, fullRefund: true });
    expect(Number(refund.amount_cents)).toBe(5000);
  });

  test('explicit amount is honored', async () => {
    marketplaceHappyPath({ refundAmountCents: 1500 });
    const { refund } = await marketplace.reserveRefund({ ...base, requestedAmountCents: 1500 });
    expect(Number(refund.amount_cents)).toBe(1500);
  });

  test('amount AND fullRefund together is ambiguous -> 400', async () => {
    marketplaceHappyPath();
    await expect(marketplace.reserveRefund({ ...base, requestedAmountCents: 1500, fullRefund: true }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
  });

  test('amount above remaining is rejected (400)', async () => {
    marketplaceHappyPath();
    await expect(marketplace.reserveRefund({ ...base, requestedAmountCents: 6000 }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
  });
});

describe('payment reservePaymentRefund (ADM-009)', () => {
  const base = {
    paymentId: 'pay-1',
    reason: 'test',
    actorUserId: 'admin-1',
    requestId: 'test-key-12345678',
  };

  test('null amount without fullRefund is rejected (400), not a silent full refund', async () => {
    paymentHappyPath();
    await expect(paymentRefunds.reservePaymentRefund({ ...base, requestedAmountCents: null }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO payment_refund_attempts'))).toBe(false);
  });

  test('NaN amount (cleared input) is rejected (400)', async () => {
    paymentHappyPath();
    await expect(paymentRefunds.reservePaymentRefund({ ...base, requestedAmountCents: NaN }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
  });

  test('fullRefund: true with no amount refunds the full remaining balance', async () => {
    paymentHappyPath({ amountCents: 5000 });
    const { attempt } = await paymentRefunds.reservePaymentRefund({ ...base, requestedAmountCents: null, fullRefund: true });
    expect(Number(attempt.amount_cents)).toBe(5000);
  });

  test('explicit amount is honored', async () => {
    paymentHappyPath({ amountCents: 2000 });
    const { attempt } = await paymentRefunds.reservePaymentRefund({ ...base, requestedAmountCents: 2000 });
    expect(Number(attempt.amount_cents)).toBe(2000);
  });

  test('amount AND fullRefund together is ambiguous -> 400', async () => {
    paymentHappyPath();
    await expect(paymentRefunds.reservePaymentRefund({ ...base, requestedAmountCents: 2000, fullRefund: true }))
      .rejects.toMatchObject({ status: 400, code: 'invalid_refund_amount' });
  });
});
