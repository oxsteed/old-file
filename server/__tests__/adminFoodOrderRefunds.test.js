'use strict';

/**
 * P2-1-F14: admin food-order refunds must route oxsteed_credit orders to the
 * OxSteed Credit rail (refundCreditForReferenceInTransaction), not to the
 * food wallet ledger reversal (which would find no debit and silently mark
 * the order refunded without returning the customer's money). Also covers
 * the fail-closed wallet path: a wallet refund that reports
 * refunded:false must NOT mark the order refunded.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { refundFoodOrder } = require('../controllers/adminFoodOrdersController');

jest.mock('../services/foodWalletService', () => {
  const actual = jest.requireActual('../services/foodWalletService');
  return { ...actual, refundWalletDebitForReference: jest.fn() };
});
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return { ...actual, refundCreditForReferenceInTransaction: jest.fn() };
});
jest.mock('../services/refundNotification', () => ({
  notifyRefundIssued: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../controllers/foodController', () => ({
  _clawBackFoodLoyaltyOnRefund: jest.fn().mockResolvedValue(null),
}));

const { refundWalletDebitForReference } = require('../services/foodWalletService');
const {
  refundCreditForReferenceInTransaction,
} = require('../services/oxsteedCreditService');

const ADMIN_ID = '00000000-0000-4000-8000-000000000999';

function orderFixture(overrides = {}) {
  return {
    id: 101,
    restaurant_id: 3,
    customer_id: '00000000-0000-4000-8000-000000000456',
    status: 'completed',
    payment_status: 'paid',
    payment_mode: 'oxsteed_credit',
    stripe_payment_intent_id: null,
    total_cents: 2500,
    currency_code: 'USD',
    queue_number: 12,
    tracking_token: null,
    metadata: {},
    ...overrides,
  };
}

// Route mock pool queries by SQL shape.
function routeQueries({ order }) {
  mockQuery.mockImplementation((sql) => {
    if (/FROM food_orders/.test(sql)) return Promise.resolve({ rows: [order] });
    if (/UPDATE food_orders SET payment_status/.test(sql)) {
      return Promise.resolve({ rows: [{ ...order, payment_status: 'refunded' }] });
    }
    if (/INSERT INTO admin_audit_log/.test(sql)) return Promise.resolve({ rows: [] });
    if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: ADMIN_ID };
    next();
  });
  app.post('/admin/food-orders/:id/refund', refundFoodOrder);
  app.use(errorHandler);
  return app;
}

const statusUpdates = () =>
  mockQuery.mock.calls.filter(([sql]) => /UPDATE food_orders SET payment_status/.test(sql));

beforeEach(() => {
  resetMocks();
  refundWalletDebitForReference.mockReset();
  refundCreditForReferenceInTransaction.mockReset();
});

describe('admin food order refunds (P2-1-F14)', () => {
  test('oxsteed_credit orders refund through the credit rail, not the wallet ledger', async () => {
    routeQueries({ order: orderFixture({ payment_mode: 'oxsteed_credit' }) });
    refundCreditForReferenceInTransaction.mockResolvedValue({
      transaction: { id: 'txn-9' },
      replayed: false,
    });

    const res = await request(buildApp())
      .post('/admin/food-orders/101/refund')
      .send({ amount_cents: 2500, reason: 'Order never prepared' });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('oxsteed_credit');
    // The credit-rail reversal is keyed on the order reference and shares the
    // merchant/agent idempotency key.
    expect(refundCreditForReferenceInTransaction).toHaveBeenCalledTimes(1);
    expect(refundCreditForReferenceInTransaction.mock.calls[0][1]).toMatchObject({
      referenceType: 'food_order',
      referenceId: '101',
      amountCents: 2500,
      idempotencyKey: 'admin-food-refund:101:2500:oxsteed-credit',
      actorType: 'admin',
    });
    // The wallet ledger path must not be touched for rail payments.
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(statusUpdates()).toHaveLength(1);
    expect(statusUpdates()[0][1][0]).toBe('refunded');
  });

  test('oxsteed_credit guest orders (no customer) are refundable through the rail', async () => {
    routeQueries({ order: orderFixture({ payment_mode: 'oxsteed_credit', customer_id: null }) });
    refundCreditForReferenceInTransaction.mockResolvedValue({
      transaction: { id: 'txn-10' },
      replayed: false,
    });

    const res = await request(buildApp())
      .post('/admin/food-orders/101/refund')
      .send({ amount_cents: 2500, reason: 'Guest order never prepared' });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('oxsteed_credit');
    expect(refundCreditForReferenceInTransaction).toHaveBeenCalledTimes(1);
  });

  test('wallet refund reporting refunded:false fails closed: order NOT marked refunded', async () => {
    routeQueries({ order: orderFixture({ payment_mode: 'wallet_credit' }) });
    refundWalletDebitForReference.mockResolvedValue({ refunded: false, reason: 'debit_not_found' });

    const res = await request(buildApp())
      .post('/admin/food-orders/101/refund')
      .send({ amount_cents: 2500, reason: 'Order never prepared' });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('wallet_refund_failed');
    expect(refundWalletDebitForReference).toHaveBeenCalledTimes(1);
    // The order must not be marked refunded when no money moved.
    expect(statusUpdates()).toHaveLength(0);
  });

  test('wallet_credit orders still reverse through the food wallet ledger', async () => {
    routeQueries({ order: orderFixture({ payment_mode: 'wallet_credit' }) });
    refundWalletDebitForReference.mockResolvedValue({
      refunded: true,
      entry: { id: 5001, amount_cents: 2500 },
      account: { id: 55 },
    });

    const res = await request(buildApp())
      .post('/admin/food-orders/101/refund')
      .send({ amount_cents: 2500, reason: 'Order never prepared' });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('wallet');
    expect(refundWalletDebitForReference).toHaveBeenCalledTimes(1);
    expect(refundCreditForReferenceInTransaction).not.toHaveBeenCalled();
    expect(statusUpdates()).toHaveLength(1);
  });
});
