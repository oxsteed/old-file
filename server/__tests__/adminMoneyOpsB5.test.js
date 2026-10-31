'use strict';

/**
 * adminMoneyOpsB5.test.js
 *
 * Behavior contract for the B5 admin-audit fix wave (super-admin money ops):
 * - ADM-008/ADM-041: issueManualRefund sends a success response (no hang)
 * - ADM-074: issueManualRefund preserves AppError status codes (not generic 500)
 * - ADM-112: issueManualRefund requires a fresh step-up challenge
 * - ADM-014/ADM-111: deleteJob refuses when a money trail exists
 * - ADM-015/ADM-042: retryPayout removed (dead-end retry)
 * - ADM-229: getPayouts failed tab only matches genuinely failed rows
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/paymentRefundService', () => ({
  processPaymentRefund: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
  logUserAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/stepupChallengeService', () => ({
  issueStepupChallenge: jest.fn(),
  verifyStepupChallenge: jest.fn().mockResolvedValue(undefined),
  amountRequiresStepup: jest.fn().mockReturnValue(false),
}));
jest.mock('../utils/schemaProbe', () => ({
  tableExists: jest.fn().mockResolvedValue(true),
  columnExists: jest.fn().mockResolvedValue(true),
  probeSchema: jest.fn().mockResolvedValue({}),
  userIdEq: jest.fn(),
  ACTIVE_JOB_STATUS_SQL_IN: '',
}));

const AppError = require('../utils/appError');
const { processPaymentRefund } = require('../services/paymentRefundService');
const { verifyStepupChallenge, issueStepupChallenge } = require('../services/stepupChallengeService');
const ctrl = require('../controllers/superAdminController');

const ADMIN_ID = '00000000-0000-4000-8000-000000000999';

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const refundReq = (overrides = {}) => ({
  params: { jobId: 'job-1' },
  body: { reason: 'test refund', stepupChallengeId: 'ch-1', stepupCode: '123456', ...(overrides.body || {}) },
  user: { id: ADMIN_ID },
  ip: '127.0.0.1',
  get: () => null,
  ...overrides,
});

const paymentRow = { id: 'pay-1', amount: '25.00', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_1' };

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  verifyStepupChallenge.mockResolvedValue(undefined);
});

describe('ADM-008/ADM-041: issueManualRefund responds on success', () => {
  test('returns 200 with refund details instead of hanging', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [paymentRow] }); // payment lookup
    processPaymentRefund.mockResolvedValue({
      attempt: { status: 'succeeded', id: 'att-1', stripe_refund_id: 're_123' },
    });
    const res = mockRes();
    await ctrl.issueManualRefund(refundReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      refundId: 're_123',
      refundCents: 2500,
      paymentId: 'pay-1',
    }));
  });

  test('202 path still responds for provider-reconciliation attempts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [paymentRow] });
    processPaymentRefund.mockResolvedValue({
      attempt: { status: 'pending_provider', id: 'att-2', stripe_refund_id: null },
    });
    const res = mockRes();
    await ctrl.issueManualRefund(refundReq(), res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ refundAttemptId: 'att-2' }));
  });
});

describe('ADM-074: issueManualRefund preserves operational error codes', () => {
  test('409 dispute_open surfaces instead of generic 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [paymentRow] });
    processPaymentRefund.mockRejectedValue(new AppError('Cannot refund payment while a dispute is open', 409, 'dispute_open'));
    const res = mockRes();
    await ctrl.issueManualRefund(refundReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'dispute_open' }));
  });

  test('unexpected errors still become generic 500', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [paymentRow] });
    processPaymentRefund.mockRejectedValue(new Error('stripe exploded'));
    const res = mockRes();
    await ctrl.issueManualRefund(refundReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Refund failed.' });
  });
});

describe('ADM-112: issueManualRefund requires fresh step-up', () => {
  test('fails closed when the step-up challenge is invalid', async () => {
    // Auth audit item 6: the handler reads the payment before verifying
    // so the challenge can be bound to the refund amount; queue the row
    // so the flow reaches the (rejecting) verify.
    mockQuery.mockResolvedValueOnce({ rows: [paymentRow] });
    verifyStepupChallenge.mockRejectedValue(new AppError('Invalid or expired challenge', 401, 'stepup_invalid'));
    const res = mockRes();
    await ctrl.issueManualRefund(refundReq(), res);
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actionType: 'manual_refund',
      actorUserId: ADMIN_ID,
    }));
    expect(processPaymentRefund).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('issueRefundStepupChallenge issues a manual_refund challenge', async () => {
    // Auth audit item 6: the issue endpoint binds the challenge to the
    // job's captured amount, so it needs the job id and the payment row.
    mockQuery.mockResolvedValueOnce({ rows: [paymentRow] });
    issueStepupChallenge.mockResolvedValue({
      challenge: { id: 'ch-9', actionType: 'manual_refund', amountCents: 2500, currencyCode: 'USD', expiresAt: 'x' },
      delivery: { channel: 'email' },
    });
    const res = mockRes();
    const next = jest.fn();
    await ctrl.issueRefundStepupChallenge({ user: { id: ADMIN_ID, email: 'a@b.c' }, body: { jobId: 'job-1' } }, res, next);
    expect(issueStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: ADMIN_ID,
      actionType: 'manual_refund',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('ADM-014/ADM-111: deleteJob refuses when a money trail exists', () => {
  const deleteReq = () => ({
    params: { jobId: 'job-9' },
    body: { reason: 'test delete' },
    user: { id: ADMIN_ID },
    ip: '127.0.0.1',
    get: () => null,
  });

  test('409 when a non-failed payment exists', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'job-9', title: 'T', client_id: 'c', status: 'published' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pay-1' }] }); // live payment
    const res = mockRes();
    await ctrl.deleteJob(deleteReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('associated payment'),
    }));
    // The DELETE must never run.
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM jobs/i.test(c[0]))).toBe(false);
  });

  test('409 when cancellation fee audit rows exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'job-9', title: 'T', client_id: 'c', status: 'cancelled' }] })
      .mockResolvedValueOnce({ rows: [] })   // no live payments
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // fee audit row
    const res = mockRes();
    await ctrl.deleteJob(deleteReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM jobs/i.test(c[0]))).toBe(false);
  });

  test('proceeds when only failed payments exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'job-9', title: 'T', client_id: 'c', status: 'published' }] })
      .mockResolvedValueOnce({ rows: [] }) // no non-failed payments
      .mockResolvedValueOnce({ rows: [] }) // no fee audit rows
      .mockResolvedValueOnce({ rows: [{ id: 'job-9' }] }); // DELETE
    const res = mockRes();
    await ctrl.deleteJob(deleteReq(), res);
    expect(mockQuery.mock.calls.some((c) => /DELETE FROM jobs/i.test(c[0]))).toBe(true);
    expect(res.json).toHaveBeenCalledWith({ message: 'Job permanently deleted.' });
  });
});

describe('ADM-015/ADM-042: retryPayout removed', () => {
  test('the dead-end retry handler no longer exists', () => {
    expect(ctrl.retryPayout).toBeUndefined();
  });
});

describe('ADM-229: getPayouts failed tab only matches genuine failures', () => {
  test('failed tab filters on status = failed only', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ pending: 0, processing: 0, completed: 0, failed: 0, totalPaid: 0 }] });
    const res = mockRes();
    await ctrl.getPayouts({ query: { status: 'failed' } }, res);
    const listSql = mockQuery.mock.calls[0][0];
    expect(listSql).toMatch(/p\.status = 'failed'/);
    expect(listSql).not.toMatch(/'refunded'/);
    expect(listSql).not.toMatch(/'disputed'/);
    const statsSql = mockQuery.mock.calls[1][0];
    expect(statsSql).not.toMatch(/'refunded'/);
    expect(statsSql).not.toMatch(/'disputed'/);
  });
});
