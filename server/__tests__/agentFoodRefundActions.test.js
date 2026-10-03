'use strict';

/**
 * agentFoodRefundActions.test.js
 *
 * Behavior contract for POST /agent/food-orders/:id/refund:
 * - grant gating (issue_refunds)
 * - reason required
 * - restaurant_credit re-credit succeeds and is transactional with the status update
 * - oxsteed_credit path posts through the credit refund service
 * - direct_payment / pay_at_restaurant mark refunded with NO money movement
 * - double-refund is idempotent (clean non-error, no double credit)
 * - wallet failure fails closed (order NOT marked refunded)
 * - oxsteed_credit purchase-not-found fails closed
 *
 * Money services are mocked at the boundary: their own suites cover the
 * ledger/journal internals. These tests prove the controller's contract:
 * fail-closed ordering, idempotency, audit, and per-method routing.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/adminAuth');
const { refundFoodOrder } = require('../controllers/agentFoodRefundActions');

jest.mock('../services/foodWalletService', () => ({
  ...jest.requireActual('../services/foodWalletService'),
  refundWalletDebitForReference: jest.fn(),
}));
jest.mock('../services/oxsteedCreditService', () => ({
  ...jest.requireActual('../services/oxsteedCreditService'),
  refundCreditForReferenceInTransaction: jest.fn(),
}));
jest.mock('../services/restaurantPosPaymentLedgerService', () => ({
  ...jest.requireActual('../services/restaurantPosPaymentLedgerService'),
  recordWalletCreditRefundForOrder: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  ...jest.requireActual('../services/auditService'),
  logAdminAction: jest.fn(),
}));

const {
  refundWalletDebitForReference,
} = require('../services/foodWalletService');
const {
  refundCreditForReferenceInTransaction,
} = require('../services/oxsteedCreditService');
const {
  recordWalletCreditRefundForOrder,
} = require('../services/restaurantPosPaymentLedgerService');
const { logAdminAction } = require('../services/auditService');

const ADMIN_ID = '00000000-0000-4000-8000-000000000999';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const GRANT_ROW = { id: 'grant-1', region_id: null, grant_source: 'direct' };

function orderFixture(overrides = {}) {
  return {
    id: 101,
    restaurant_id: 3,
    business_id: 42,
    customer_id: CUSTOMER_ID,
    guest_name: null,
    status: 'completed',
    payment_status: 'paid',
    subtotal_cents: 1800,
    tax_cents: 144,
    tip_cents: 0,
    discount_cents: 0,
    total_cents: 1944,
    currency_code: 'USD',
    queue_number: 7,
    stripe_payment_intent_id: null,
    metadata: { paymentMode: 'restaurant_credit' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: ADMIN_ID, email: 'agent@oxsteed.com' };
    req.isSuper = false;
    next();
  });
  app.post(
    '/agent/food-orders/:id/refund',
    requirePermission('issue_refunds'),
    refundFoodOrder
  );
  app.use(errorHandler);
  return app;
}

/**
 * Routes mockQuery by SQL content: grant check, order lock read, order
 * update, and a default empty result for BEGIN/COMMIT/etc.
 */
function routeQueries({ order, grantRows = [GRANT_ROW] }) {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('admin_permission_grants')) return { rows: grantRows, rowCount: grantRows.length };
    if (text.includes('FROM food_orders') && text.includes('FOR UPDATE')) {
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (text.startsWith('UPDATE food_orders')) {
      const updated = {
        ...order,
        status: params[0],
        payment_status: params[1],
        metadata: JSON.parse(params[2]),
      };
      return { rows: [updated], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function updateCalls() {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).startsWith('UPDATE food_orders'));
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  logAdminAction.mockResolvedValue(undefined);
  recordWalletCreditRefundForOrder.mockResolvedValue({ payment: { id: 1 } });
});

describe('agent food refund route wiring', () => {
  test('the refund route carries grant middleware (requirePermission + controller)', () => {
    const router = require('../routes/agentFoodRefundActions');
    const routes = router.stack
      .filter((l) => l.route)
      .map((l) => ({
        path: l.route.path,
        method: Object.keys(l.route.methods)[0],
        chainLength: l.route.stack.length,
      }));
    const refund = routes.find((l) => l.path === '/food-orders/:id/refund' && l.method === 'post');
    expect(refund).toBeDefined();
    // requirePermission('issue_refunds') + controller
    expect(refund.chainLength).toBe(2);
  });
});

describe('POST /agent/food-orders/:id/refund grant gating', () => {
  test('returns 403 without the issue_refunds grant', async () => {
    routeQueries({ order: orderFixture(), grantRows: [] });
    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Customer never received the food' });
    expect(res.status).toBe(403);
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(refundCreditForReferenceInTransaction).not.toHaveBeenCalled();
    expect(updateCalls()).toHaveLength(0);
  });

  test('passes the grant gate for a super-admin', async () => {
    routeQueries({ order: orderFixture(), grantRows: [] });
    refundWalletDebitForReference.mockResolvedValue({
      refunded: true,
      entry: {
        id: 5001, amount_cents: 1944, currency_code: 'USD',
        balance_after_cents: 5000, account_id: 55, metadata: {},
      },
      account: { id: 55 },
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: ADMIN_ID, email: 'super@oxsteed.com' };
      req.isSuper = true;
      next();
    });
    app.post('/agent/food-orders/:id/refund', requirePermission('issue_refunds'), refundFoodOrder);
    app.use(errorHandler);
    const res = await request(app)
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Super admin refund' });
    expect(res.status).toBe(200);
    expect(res.body.data.refunded).toBe(true);
  });
});

describe('reason validation', () => {
  test('rejects a missing reason with 400', async () => {
    routeQueries({ order: orderFixture() });
    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('refund_reason_required');
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(updateCalls()).toHaveLength(0);
  });

  test('rejects a blank reason with 400', async () => {
    routeQueries({ order: orderFixture() });
    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('refund_reason_required');
  });
});

describe('restaurant_credit refunds', () => {
  test('re-credits the customer wallet and marks the order refunded in one transaction', async () => {
    routeQueries({ order: orderFixture() });
    refundWalletDebitForReference.mockResolvedValue({
      refunded: true,
      entry: {
        id: 5001,
        amount_cents: 1944,
        currency_code: 'USD',
        balance_after_cents: 5000,
        account_id: 55,
        metadata: { originalDebitEntryId: '4001' },
      },
      account: { id: 55 },
    });

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Kitchen fire, order never made' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      orderId: 101,
      refunded: true,
      alreadyRefunded: false,
      orderStatus: 'refunded',
      paymentStatus: 'refunded',
      paymentMethod: 'restaurant_credit',
      amountCents: 1944,
      currencyCode: 'USD',
      manualSettlementRequired: false,
      walletLedgerEntryId: '5001',
    });

    // Wallet re-credit invoked with the order's debit reference and admin actor.
    expect(refundWalletDebitForReference).toHaveBeenCalledTimes(1);
    expect(refundWalletDebitForReference.mock.calls[0][1]).toMatchObject({
      restaurantId: 3,
      customerId: CUSTOMER_ID,
      currencyCode: 'USD',
      orderReferenceId: '101',
      actorType: 'admin',
    });

    // POS payment ledger mirrors the refund (same idempotency key as the
    // kitchen refund path, so the two paths dedupe).
    expect(recordWalletCreditRefundForOrder).toHaveBeenCalledTimes(1);
    expect(recordWalletCreditRefundForOrder.mock.calls[0][1]).toMatchObject({
      orderId: 101,
      amountCents: 1944,
      idempotencyKey: 'food-order:101:wallet-credit-refund',
    });

    // Order row updated exactly once, transactionally.
    expect(updateCalls()).toHaveLength(1);
    const updateParams = updateCalls()[0][1];
    expect(updateParams[0]).toBe('refunded');
    expect(updateParams[1]).toBe('refunded');
    const stamped = JSON.parse(updateParams[2]);
    expect(stamped.agentRefund).toMatchObject({
      by: ADMIN_ID,
      reason: 'Kitchen fire, order never made',
      paymentMethod: 'restaurant_credit',
      amountCents: 1944,
      manualSettlementRequired: false,
    });

    // Fail-closed audit: called with the transaction client, before/after
    // states, and wallet balances.
    expect(logAdminAction).toHaveBeenCalledTimes(1);
    const audit = logAdminAction.mock.calls[0][0];
    expect(audit.action).toBe('agent_food_order_refund');
    expect(audit.targetType).toBe('food_order');
    expect(audit.targetId).toBe('101');
    expect(audit.client).toBeDefined();
    expect(audit.before).toMatchObject({ status: 'completed', payment_status: 'paid', total_cents: 1944 });
    expect(audit.after).toMatchObject({
      status: 'refunded',
      payment_status: 'refunded',
      wallet_balance_before_cents: 3056,
      wallet_balance_after_cents: 5000,
    });
  });

  test('fails closed when the wallet re-credit cannot complete: order NOT marked refunded', async () => {
    routeQueries({ order: orderFixture() });
    refundWalletDebitForReference.mockResolvedValue({ refunded: false, reason: 'debit_not_found' });

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Customer says they were charged twice' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('refund_wallet_failed');
    // Fail closed: no order update, no audit row, no POS mirror.
    expect(updateCalls()).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
    expect(recordWalletCreditRefundForOrder).not.toHaveBeenCalled();
  });

  test('fails closed when the wallet service throws', async () => {
    routeQueries({ order: orderFixture() });
    refundWalletDebitForReference.mockRejectedValue(new Error('ledger locked'));

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Service blew up' });

    expect(res.status).toBe(500);
    expect(updateCalls()).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('oxsteed_credit refunds', () => {
  test('re-credits through the credit posting path with the shared idempotency key', async () => {
    routeQueries({
      order: orderFixture({ metadata: { paymentMode: 'oxsteed_credit' } }),
    });
    refundCreditForReferenceInTransaction.mockResolvedValue({
      transaction: { id: 9001 },
      replayed: false,
    });

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Duplicate charge on credit wallet' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      refunded: true,
      paymentMethod: 'oxsteed_credit',
      amountCents: 1944,
      creditTransactionId: '9001',
      manualSettlementRequired: false,
    });

    expect(refundCreditForReferenceInTransaction).toHaveBeenCalledTimes(1);
    const args = refundCreditForReferenceInTransaction.mock.calls[0][1];
    expect(args).toMatchObject({
      referenceType: 'food_order',
      referenceId: '101',
      amountCents: 1944,
      // Shared with the kitchen refund path so the two can never double-credit.
      idempotencyKey: 'food-order:101:oxsteed-credit-refund',
      actorType: 'admin',
      actorUserId: ADMIN_ID,
      reason: 'Duplicate charge on credit wallet',
    });
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(updateCalls()).toHaveLength(1);
    expect(logAdminAction).toHaveBeenCalledTimes(1);
  });

  test('fails closed when no posted credit purchase exists for the order', async () => {
    routeQueries({
      order: orderFixture({ metadata: { paymentMode: 'oxsteed_credit' } }),
    });
    const { AppError } = require('../middleware/errorHandler');
    refundCreditForReferenceInTransaction.mockRejectedValue(
      new AppError('Original credit purchase not found for this reference', 404, 'credit_purchase_not_found')
    );

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Nothing to refund against' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('credit_purchase_not_found');
    expect(updateCalls()).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('manual-settlement payment methods', () => {
  test.each(['direct_payment', 'pay_at_restaurant'])(
    '%s marks the order refunded with NO money movement',
    async (paymentMethod) => {
      routeQueries({ order: orderFixture({ metadata: { paymentMode: paymentMethod } }) });

      const res = await request(buildApp())
        .post('/agent/food-orders/101/refund')
        .send({ reason: 'Goodwill refund, handled offline' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        refunded: true,
        paymentMethod,
        manualSettlementRequired: true,
      });
      expect(res.body.data.operatorNote).toContain('Manual settlement required');
      expect(res.body.data.operatorNote).toContain('no money moved automatically');

      // No money movement: neither credit path invoked.
      expect(refundWalletDebitForReference).not.toHaveBeenCalled();
      expect(refundCreditForReferenceInTransaction).not.toHaveBeenCalled();
      expect(recordWalletCreditRefundForOrder).not.toHaveBeenCalled();

      // But the order IS marked refunded, with the operator note stamped.
      expect(updateCalls()).toHaveLength(1);
      const updateParams = updateCalls()[0][1];
      expect(updateParams[1]).toBe('refunded');
      const stamped = JSON.parse(updateParams[2]);
      expect(stamped.agentRefund.manualSettlementRequired).toBe(true);
      expect(stamped.agentRefund.operatorNote).toContain('Manual settlement required');

      expect(logAdminAction).toHaveBeenCalledTimes(1);
    }
  );

  test('pay_now is rejected: card refunds stay on the restaurant card-refund flow', async () => {
    routeQueries({ order: orderFixture({ metadata: { paymentMode: 'pay_now' } }) });

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Card refund from console' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('refund_pay_now_unsupported');
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(refundCreditForReferenceInTransaction).not.toHaveBeenCalled();
    expect(updateCalls()).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });
});

describe('idempotency', () => {
  test('refunding an already-refunded order is a clean non-error with no money movement', async () => {
    routeQueries({
      order: orderFixture({ status: 'refunded', payment_status: 'refunded' }),
    });

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Double-clicked the refund button' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      refunded: true,
      alreadyRefunded: true,
      orderStatus: 'refunded',
      paymentStatus: 'refunded',
    });
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(refundCreditForReferenceInTransaction).not.toHaveBeenCalled();
    expect(updateCalls()).toHaveLength(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  test('orders cancelled by the kitchen resolve to the refunded terminal state', async () => {
    routeQueries({
      order: orderFixture({ status: 'cancelled', payment_status: 'paid' }),
    });
    refundWalletDebitForReference.mockResolvedValue({
      refunded: true,
      entry: { id: 5002, amount_cents: 1944, currency_code: 'USD', balance_after_cents: 6000, account_id: 55, metadata: {} },
      account: { id: 55 },
    });

    const res = await request(buildApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Cancelled order was still charged' });

    expect(res.status).toBe(200);
    expect(res.body.data.orderStatus).toBe('refunded');
    expect(refundWalletDebitForReference).toHaveBeenCalledTimes(1);
  });
});
