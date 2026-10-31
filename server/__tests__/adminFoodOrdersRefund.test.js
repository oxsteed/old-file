'use strict';

/**
 * adminFoodOrdersRefund.test.js
 *
 * Behavior contract for POST /api/admin/food-orders/:id/refund after the
 * admin-audit fix wave (ADM-002, ADM-003, ADM-029, ADM-030, ADM-031, ADM-044,
 * ADM-190, ADM-191):
 * - amount_cents must be a positive whole number (server-side, ADM-191)
 * - wallet refund failure fails closed: order NOT marked refunded (ADM-002)
 * - partial wallet refunds honor the requested amount (ADM-029)
 * - idempotency key is per (order, amount), not per admin (ADM-030)
 * - order row is locked (FOR UPDATE) inside the transaction (ADM-031)
 * - oxsteed_credit routes to the credit journal, not the wallet ledger (ADM-044)
 * - already-refunded orders replay cleanly
 */

jest.mock('../services/stepupChallengeService', () => ({ verifyStepupChallenge: jest.fn().mockResolvedValue({}) }));
jest.mock('../services/dualApprovalService', () => ({ requestMoneyMovementApproval: jest.fn().mockResolvedValue({ queued: false }) }));
const { mockQuery, resetMocks } = require('./setup');
const { refundFoodOrder } = require('../controllers/adminFoodOrdersController');

jest.mock('../services/foodWalletService', () => ({
  ...jest.requireActual('../services/foodWalletService'),
  refundWalletDebitForReference: jest.fn(),
}));
jest.mock('../services/oxsteedCreditService', () => ({
  ...jest.requireActual('../services/oxsteedCreditService'),
  refundCreditForReferenceInTransaction: jest.fn(),
}));
jest.mock('../services/refundNotification', () => ({
  notifyRefundIssued: jest.fn().mockResolvedValue(undefined),
}));

const { refundWalletDebitForReference } = require('../services/foodWalletService');
const { refundCreditForReferenceInTransaction } = require('../services/oxsteedCreditService');

const ADMIN_ID = '00000000-0000-4000-8000-000000000999';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';

function makeOrder(overrides = {}) {
  return {
    id: 7,
    payment_status: 'paid',
    total_cents: 1000,
    payment_mode: 'wallet_credit',
    customer_id: CUSTOMER_ID,
    restaurant_id: 1,
    currency_code: 'USD',
    queue_number: 3,
    metadata: {},
    tracking_token: null,
    stripe_payment_intent_id: null,
    ...overrides,
  };
}

function mockDbForOrder(order) {
  const seen = { sql: [] };
  mockQuery.mockImplementation(async (sql) => {
    seen.sql.push(sql);
    if (/FOR UPDATE/.test(sql)) return { rows: [order] };
    if (/^UPDATE food_orders/.test(sql)) return { rows: [] };
    if (/INSERT INTO admin_audit_log/.test(sql)) return { rows: [] };
    return { rows: [] }; // BEGIN / COMMIT / ROLLBACK
  });
  return seen;
}

function makeReqRes(orderId, body) {
  const req = { params: { id: String(orderId) }, body, user: { id: ADMIN_ID }, ip: '127.0.0.1' };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

beforeEach(() => {
  resetMocks();
  refundWalletDebitForReference.mockReset();
  refundCreditForReferenceInTransaction.mockReset();
});

describe('admin refundFoodOrder (audit fixes)', () => {
  test('ADM-191: fractional amount_cents is rejected server-side', async () => {
    const { req, res } = makeReqRes(7, { amount_cents: 10.5, reason: 'test' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/whole number/);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('ADM-191: negative amount_cents is rejected', async () => {
    const { req, res } = makeReqRes(7, { amount_cents: -50, reason: 'test' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('ADM-002: wallet refund reporting failure fails closed (no status update)', async () => {
    const seen = mockDbForOrder(makeOrder());
    refundWalletDebitForReference.mockResolvedValue({ refunded: false, reason: 'debit_not_found' });
    const { req, res } = makeReqRes(7, { reason: 'test' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('wallet_refund_failed');
    expect(seen.sql.some((s) => /^UPDATE food_orders/.test(s))).toBe(false);
    expect(seen.sql.some((s) => /INSERT INTO admin_audit_log/.test(s))).toBe(false);
  });

  test('ADM-029/030: partial wallet refund honors the amount; key has no admin id; row locked', async () => {
    const seen = mockDbForOrder(makeOrder());
    refundWalletDebitForReference.mockResolvedValue({
      refunded: true, entry: { id: 99 }, account: { id: 5 }, amountCents: 400,
      cumulativeRefundedCents: 400,
    });
    const { req, res } = makeReqRes(7, { amount_cents: 400, reason: 'partial test' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.new_status).toBe('partially_refunded');
    // ADM-029: the requested partial amount reaches the wallet service.
    expect(refundWalletDebitForReference).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amountCents: 400 })
    );
    // ADM-030: idempotency key is per (order, amount), not per admin.
    const correlationId = refundWalletDebitForReference.mock.calls[0][1].correlationId;
    expect(correlationId).toBe('admin-food-refund:7:400');
    expect(correlationId).not.toContain(ADMIN_ID);
    // ADM-031: the order row is locked inside the transaction.
    expect(seen.sql.some((s) => /FOR UPDATE/.test(s))).toBe(true);
    // Cumulative tracking is stamped into metadata.
    const updateCall = mockQuery.mock.calls.find(([s]) => /^UPDATE food_orders/.test(s));
    expect(updateCall[1][0]).toBe('partially_refunded');
    expect(JSON.parse(updateCall[1][1]).admin_refunded_cents).toBe(400);
  });

  test('ADM-044: oxsteed_credit routes to the credit journal, not the wallet', async () => {
    mockDbForOrder(makeOrder({ payment_mode: 'oxsteed_credit' }));
    refundCreditForReferenceInTransaction.mockResolvedValue({ transaction: { id: 123 } });
    const { req, res } = makeReqRes(7, { reason: 'credit test' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.provider).toBe('oxsteed_credit');
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(refundCreditForReferenceInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ referenceType: 'food_order', referenceId: '7', amountCents: 1000 })
    );
  });

  test('already-refunded order replays cleanly without touching money', async () => {
    mockDbForOrder(makeOrder({ payment_status: 'refunded' }));
    const { req, res } = makeReqRes(7, { reason: 'again' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.already_refunded).toBe(true);
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
  });

  test('cumulative cap: partial exceeding the remaining total is rejected', async () => {
    mockDbForOrder(makeOrder({ metadata: { admin_refunded_cents: 800 } }));
    const { req, res } = makeReqRes(7, { amount_cents: 300, reason: 'too much' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/remaining order total/);
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
  });
});

describe('food refund authorization controls', () => {
  beforeEach(() => {
    require('../services/stepupChallengeService').verifyStepupChallenge.mockResolvedValue({});
    require('../services/dualApprovalService').requestMoneyMovementApproval.mockResolvedValue({ queued: false });
  });
  test('a failed step-up stops before acquiring the money transaction', async () => {
    const error = Object.assign(new Error('Fresh step-up required'), { statusCode: 403 });
    require('../services/stepupChallengeService').verifyStepupChallenge.mockRejectedValueOnce(error);
    const { req, res } = makeReqRes(7, { reason: 'test' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(403);
    // Auth audit item 6: the handler pre-reads the order row to bind the
    // challenge to the refund amount, so one read-only SELECT is
    // expected; the money transaction itself must never be acquired.
    expect(mockQuery.mock.calls.every(([sql]) => /^SELECT total_cents, metadata FROM food_orders/i.test(sql))).toBe(true);
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
  });
  test.each(['wallet_credit','oxsteed_credit'])('above-threshold %s refund queues without moving funds', async mode => {
    mockDbForOrder(makeOrder({ total_cents: 60000, payment_mode: mode }));
    const gate = require('../services/dualApprovalService').requestMoneyMovementApproval;
    gate.mockResolvedValueOnce({ queued: true, approval: { id: 1, status: 'pending', amount_cents: 60000 } });
    const { req, res } = makeReqRes(7, { reason: 'test' });
    await refundFoodOrder(req, res);
    expect(res.statusCode).toBe(202);
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({ movementType: 'food_refund', amountCents: 60000 }));
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
    expect(refundCreditForReferenceInTransaction).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_orders/.test(sql))).toBe(false);
  });
  test('approval executor refuses a changed refund balance', async () => {
    mockDbForOrder(makeOrder({ metadata: { admin_refunded_cents: 100 } }));
    const { executeFoodOrderRefund } = require('../controllers/adminFoodOrdersController');
    await expect(executeFoodOrderRefund({ query: mockQuery }, { req: { user: { id: ADMIN_ID } }, orderId: 7,
      requestedAmount: 200, reason: 'test', skipDualApproval: true, expectedRefundedCents: 0 })).rejects.toMatchObject({ statusCode: 409 });
    expect(refundWalletDebitForReference).not.toHaveBeenCalled();
  });
});
