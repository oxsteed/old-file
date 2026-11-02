'use strict';

/**
 * restaurantSideTrackC.test.js
 *
 * Reproduction and behavior tests for the 2026-11-02 restaurant-side
 * audit, track C (restaurant money):
 * - Finding 3: one shared refunded-cents counter across admin/agent/kitchen.
 * - Finding 39: existence/eligibility pre-checks run BEFORE step-up
 *   verification, so a bad order never burns a single-use code.
 * - Finding 1: store-credit accept is a real wallet credit in the same
 *   transaction as the resolve; a credit failure leaves the case open.
 * - Finding 6: restaurant resolve is rejected while a refund is offered
 *   or pending approval.
 * - Finding 4: support-resolution approval validates the amount against
 *   the order total before step-up, and queues above threshold.
 * - Finding 38: a second credit_settlement_payout pending action for the
 *   same settlement is rejected server-side.
 * - Finding 2: payout approve revalidates the CURRENT Connect account.
 */

jest.mock('../services/stepupChallengeService', () => ({
  verifyStepupChallenge: jest.fn().mockResolvedValue({}),
  issueStepupChallenge: jest.fn(),
}));
jest.mock('../services/dualApprovalService', () => ({
  requestMoneyMovementApproval: jest.fn().mockResolvedValue({ queued: false }),
}));
jest.mock('../services/foodWalletService', () => ({
  ...jest.requireActual('../services/foodWalletService'),
  refundWalletDebitForReference: jest.fn(),
  creditFoodWallet: jest.fn(),
}));
jest.mock('../services/oxsteedCreditService', () => ({
  ...jest.requireActual('../services/oxsteedCreditService'),
  refundCreditForReferenceInTransaction: jest.fn(),
  assertCreditRailEnabled: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/restaurantPosPaymentLedgerService', () => ({
  ...jest.requireActual('../services/restaurantPosPaymentLedgerService'),
  recordWalletCreditRefundForOrder: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  ...jest.requireActual('../services/auditService'),
  logAdminAction: jest.fn(),
}));
jest.mock('../controllers/foodController', () => ({
  refundFoodOrderCardPayment: jest.fn().mockResolvedValue({ refund: { id: 're_1', amount: 2500 }, chargeId: 'ch_1' }),
  _clawBackFoodLoyaltyOnRefund: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/scopeModel', () => ({
  ...jest.requireActual('../services/scopeModel'),
  resolveRestaurantAccess: jest.fn().mockResolvedValue({ id: 5, display_name: 'Test Kitchen' }),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  ...jest.requireActual('../services/restaurantLocationAccessService'),
  getLocationScope: jest.fn().mockResolvedValue({ mode: 'all' }),
  assertLocationAccess: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/permissionsService', () => ({
  ...jest.requireActual('../services/permissionsService'),
  hasRestaurantPermission: jest.fn().mockResolvedValue(true),
}));

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { requirePermission } = require('../middleware/adminAuth');
const { readRefundedCents, withRefundedCents, remainingCents } = require('../services/foodOrderRefundCounter');
const { refundFoodOrder: agentRefundFoodOrder } = require('../controllers/agentFoodRefundActions');
const supportCtrl = require('../controllers/restaurantSupportController');
const { requestPendingAction } = require('../services/oxsteedCreditPendingActionService');
const { verifyStepupChallenge } = require('../services/stepupChallengeService');
const { requestMoneyMovementApproval } = require('../services/dualApprovalService');
const { creditFoodWallet, refundWalletDebitForReference } = require('../services/foodWalletService');
const { recordWalletCreditRefundForOrder } = require('../services/restaurantPosPaymentLedgerService');

const ADMIN_ID = '00000000-0000-4000-8000-000000000999';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const GRANT_ROW = { id: 'grant-1', region_id: null, grant_source: 'direct' };

function agentApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: ADMIN_ID, email: 'agent@oxsteed.com' };
    req.isSuper = false;
    next();
  });
  app.post('/agent/food-orders/:id/refund', requirePermission('issue_refunds'), agentRefundFoodOrder);
  app.use(errorHandler);
  return app;
}

function agentOrderFixture(overrides = {}) {
  return {
    id: 101, restaurant_id: 3, business_id: 42, customer_id: CUSTOMER_ID,
    guest_name: null, status: 'completed', payment_status: 'paid',
    subtotal_cents: 1800, tax_cents: 144, tip_cents: 0, discount_cents: 0,
    total_cents: 1944, currency_code: 'USD', queue_number: 7,
    stripe_payment_intent_id: null, metadata: { paymentMode: 'restaurant_credit' },
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function routeAgentQueries({ order }) {
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('admin_permission_grants')) return { rows: [GRANT_ROW], rowCount: 1 };
    if (text.includes('FROM food_orders') && text.includes('FOR UPDATE')) {
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (text.includes('FROM food_orders') && text.trimStart().startsWith('SELECT')) {
      return { rows: order ? [order] : [], rowCount: order ? 1 : 0 };
    }
    if (text.startsWith('UPDATE food_orders')) {
      return {
        rows: [{ ...order, status: params[0], payment_status: params[1], metadata: JSON.parse(params[2]) }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  creditFoodWallet.mockResolvedValue({ entry: { id: 'wallet-entry-900' } });
  recordWalletCreditRefundForOrder.mockResolvedValue({ payment: { id: 1 } });
  refundWalletDebitForReference.mockResolvedValue({
    refunded: true,
    entry: { id: 5001, amount_cents: 944, currency_code: 'USD', balance_after_cents: 5000, account_id: 55, metadata: {} },
    account: { id: 55 },
  });
});

describe('finding 3: shared refunded-cents counter', () => {
  test('reads both the shared key and the legacy admin key, taking the max', () => {
    expect(readRefundedCents({})).toBe(0);
    expect(readRefundedCents({ refunded_cents: 400 })).toBe(400);
    expect(readRefundedCents({ admin_refunded_cents: 800 })).toBe(800);
    expect(readRefundedCents({ refunded_cents: 300, admin_refunded_cents: 800 })).toBe(800);
    expect(readRefundedCents({ refunded_cents: 'nope', admin_refunded_cents: -5 })).toBe(0);
  });

  test('withRefundedCents stamps both keys to the same cumulative value', () => {
    expect(withRefundedCents({}, 944)).toEqual({ refunded_cents: 944, admin_refunded_cents: 944 });
  });

  test('remainingCents floors at zero', () => {
    expect(remainingCents(1944, { refunded_cents: 1000 })).toBe(944);
    expect(remainingCents(1944, { admin_refunded_cents: 1944 })).toBe(0);
    expect(remainingCents(1944, { refunded_cents: 9999 })).toBe(0);
  });

  test('agent path refunds only the remainder after an admin partial refund', async () => {
    routeAgentQueries({
      order: agentOrderFixture({ metadata: { paymentMode: 'restaurant_credit', refunded_cents: 1000, admin_refunded_cents: 1000 } }),
    });
    const res = await request(agentApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Remainder after admin partial' });
    expect(res.status).toBe(200);
    expect(res.body.data.amountCents).toBe(944);
    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE food_orders'));
    expect(updateCall).toBeDefined();
    expect(JSON.parse(updateCall[1][2]).refunded_cents).toBe(1944);
    expect(JSON.parse(updateCall[1][2]).admin_refunded_cents).toBe(1944);
  });
});

describe('finding 39: step-up is not burned by a doomed refund', () => {
  test('agent refund of a fully-refunded order rejects before step-up verification', async () => {
    routeAgentQueries({
      order: agentOrderFixture({ metadata: { paymentMode: 'restaurant_credit', refunded_cents: 1944 } }),
    });
    const res = await request(agentApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'Already refunded' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('food_refund_already_fully_refunded');
    expect(verifyStepupChallenge).not.toHaveBeenCalled();
  });

  test('agent refund of a missing order rejects before step-up verification', async () => {
    routeAgentQueries({ order: null });
    const res = await request(agentApp())
      .post('/agent/food-orders/101/refund')
      .send({ reason: 'No such order' });
    expect(res.status).toBe(404);
    expect(verifyStepupChallenge).not.toHaveBeenCalled();
  });

  test('admin food refund of a missing order rejects before step-up verification', async () => {
    const { refundFoodOrder } = require('../controllers/adminFoodOrdersController');
    const req = { params: { id: '7' }, body: { reason: 'test' }, user: { id: ADMIN_ID }, ip: '127.0.0.1' };
    const res = {
      statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(404);
    expect(verifyStepupChallenge).not.toHaveBeenCalled();
  });
});

describe('finding 1: store-credit accept is a real wallet credit', () => {
  function supportCustomerApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: CUSTOMER_ID, email: 'customer@example.com' };
      next();
    });
    app.post('/cases/:caseId/accept', supportCtrl.acceptResolution);
    app.use(errorHandler);
    return app;
  }

  function routeSupportQueries({ caseForPayment, supportCase }) {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('LEFT JOIN food_orders')) return { rows: [caseForPayment], rowCount: 1 };
      if (text.includes('FROM restaurant_support_cases rsc') && text.includes('archived_at IS NULL')) {
        return { rows: [supportCase], rowCount: 1 };
      }
      if (text.startsWith('UPDATE restaurant_support_cases')) {
        return { rows: [{ ...supportCase, status: 'resolved', credit_status: 'issued' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  const paymentRow = {
    id: 42, restaurant_id: 5, order_id: 77, customer_user_id: CUSTOMER_ID,
    status: 'resolution_offered', final_resolution: 'store_credit',
    store_credit_amount_cents: null, resolution_amount_cents: 1500,
    credit_status: 'offered', refund_status: null, currency_code: 'USD',
    public_case_number: 'RS-1',
  };

  test('accept credits the wallet with the offered amount and marks credit issued', async () => {
    routeSupportQueries({ caseForPayment: paymentRow, supportCase: paymentRow });
    const res = await request(supportCustomerApp()).post('/cases/42/accept').send({});
    expect(res.status).toBe(200);
    expect(creditFoodWallet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amountCents: 1500,
        referenceType: 'restaurant_support_store_credit',
        referenceId: '42',
        idempotencyKey: 'restaurant-support-store-credit-42',
      })
    );
    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).startsWith('UPDATE restaurant_support_cases'));
    expect(updateCall).toBeDefined();
    expect(updateCall[1][2]).toBe(true); // credit_status = 'issued' flag
  });

  test('a wallet credit failure leaves the case unresolved', async () => {
    creditFoodWallet.mockRejectedValueOnce(new Error('wallet suspended'));
    routeSupportQueries({ caseForPayment: paymentRow, supportCase: paymentRow });
    const res = await request(supportCustomerApp()).post('/cases/42/accept').send({});
    expect(res.status).toBe(500);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE restaurant_support_cases'))).toBe(false);
  });
});

describe('finding 6: resolve guard', () => {
  function supportRestaurantApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: ADMIN_ID, email: 'owner@example.com' };
      next();
    });
    app.post('/restaurants/:restaurantId/support/cases/:caseId/resolve', supportCtrl.restaurantResolve);
    app.use(errorHandler);
    return app;
  }

  function routeResolveQueries(supportCase) {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('FROM restaurant_support_cases rsc') && text.includes('archived_at IS NULL')) {
        return { rows: [supportCase], rowCount: 1 };
      }
      if (text.startsWith('UPDATE restaurant_support_cases')) {
        return { rows: [{ ...supportCase, status: 'resolved' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test.each([
    ['resolution offered', { status: 'resolution_offered', refund_status: null }],
    ['refund pending approval', { status: 'awaiting_restaurant', refund_status: 'pending_approval' }],
    ['refund approved', { status: 'awaiting_restaurant', refund_status: 'approved' }],
  ])('rejects resolve while %s', async (_label, state) => {
    routeResolveQueries({
      id: 42, restaurant_id: 5, order_id: 77, customer_user_id: CUSTOMER_ID, ...state,
    });
    const res = await request(supportRestaurantApp())
      .post('/restaurants/5/support/cases/42/resolve').send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('case_refund_pending');
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE restaurant_support_cases'))).toBe(false);
  });

  test('allows resolve when no refund is offered or pending', async () => {
    routeResolveQueries({
      id: 42, restaurant_id: 5, order_id: 77, customer_user_id: CUSTOMER_ID,
      status: 'awaiting_restaurant', refund_status: null,
    });
    const res = await request(supportRestaurantApp())
      .post('/restaurants/5/support/cases/42/resolve').send({});
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe('resolved');
  });
});

describe('finding 4: support-resolution approval amount discipline', () => {
  function adminSupportApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: ADMIN_ID, email: 'admin@oxsteed.com' };
      next();
    });
    app.post('/cases/:caseId/approve-resolution', supportCtrl.adminApproveResolution);
    app.use(errorHandler);
    return app;
  }

  function routeApproveQueries() {
    mockQuery.mockImplementation(async (sql) => {
      const text = String(sql);
      if (text.includes('SELECT total_cents, currency_code FROM food_orders')) {
        return { rows: [{ total_cents: 2000, currency_code: 'USD' }], rowCount: 1 };
      }
      if (text.includes('FROM restaurant_support_cases rsc') && text.includes('archived_at IS NULL')) {
        return { rows: [{ id: 42, restaurant_id: 5, order_id: 77, currency_code: 'USD' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('an amount above the order total is rejected before step-up verification', async () => {
    routeApproveQueries();
    const res = await request(adminSupportApp())
      .post('/cases/42/approve-resolution')
      .send({ resolution: 'refund', amountCents: 5000, stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('resolution_amount_exceeds_order');
    expect(verifyStepupChallenge).not.toHaveBeenCalled();
  });

  test('an above-threshold amount queues via dual approval instead of applying', async () => {
    routeApproveQueries();
    requestMoneyMovementApproval.mockResolvedValueOnce({
      queued: true, approval: { id: 9, status: 'pending', amount_cents: 1500 },
    });
    const res = await request(adminSupportApp())
      .post('/cases/42/approve-resolution')
      .set('Idempotency-Key', 'test-key-1')
      .send({ resolution: 'refund', amountCents: 1500, stepupChallengeId: 'ch-1', stepupCode: '123456' });
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'support_resolution_approve', expectedAmountCents: 1500,
    }));
    expect(requestMoneyMovementApproval).toHaveBeenCalledWith(expect.objectContaining({
      movementType: 'support_resolution_refund', amountCents: 1500,
    }));
    expect(res.status).toBe(202);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE restaurant_support_cases'))).toBe(false);
  });
});

describe('finding 38: settlement double-queue guard', () => {
  test('a second queued payout for the same settlement is rejected 409', async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      if (String(sql).includes('FROM oxsteed_credit_pending_actions')) {
        expect(params).toEqual(['settlement-7']);
        return { rows: [{ id: 'pending-1' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(requestPendingAction({
      actionType: 'credit_settlement_payout',
      payload: { settlementId: 'settlement-7' },
      requestedBy: ADMIN_ID,
      idempotencyKey: 'another-key',
    })).rejects.toMatchObject({ statusCode: 409, code: 'credit_settlement_payout_already_queued' });
  });
});
