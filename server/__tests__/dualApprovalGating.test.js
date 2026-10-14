'use strict';

/**
 * dualApprovalGating.test.js — ADM-016 (rail integration)
 *
 * - issueManualRefund queues above-threshold job refunds for dual approval
 *   (202, money_movement_pending_approval) instead of moving money.
 * - Below-threshold refunds keep the existing single-approval behavior.
 * - The dualApproval context is passed through to processPaymentRefund.
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

const { processPaymentRefund } = require('../services/paymentRefundService');
const ctrl = require('../controllers/superAdminController');

const ADMIN_ID = '00000000-0000-4000-8000-000000000999';
// $25.00 captured — below the $500 default threshold.
const smallPaymentRow = { id: 'pay-1', amount: '25.00', stripe_payment_intent_id: 'pi_1', stripe_account_id: 'acct_1' };
// $600.00 captured — above the $500 default threshold.
const largePaymentRow = { id: 'pay-2', amount: '600.00', stripe_payment_intent_id: 'pi_2', stripe_account_id: 'acct_2' };

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const refundReq = (body = {}) => ({
  params: { jobId: 'job-1' },
  body: { reason: 'test refund', stepupChallengeId: 'ch-1', stepupCode: '123456', fullRefund: true, ...body },
  user: { id: ADMIN_ID },
  ip: '127.0.0.1',
  get: () => null,
});

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  const { verifyStepupChallenge } = require('../services/stepupChallengeService');
  verifyStepupChallenge.mockResolvedValue(undefined);
});

describe('ADM-016: issueManualRefund dual-approval gating', () => {
  test('above-threshold refund is queued (202) and processPaymentRefund receives the dualApproval context', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [largePaymentRow] });
    const gate = {
      approval: {
        id: 7,
        movement_type: 'job_refund',
        reference_key: 'job:job-1',
        amount_cents: 60000,
        currency_code: 'USD',
        status: 'pending',
        requested_by: ADMIN_ID,
        requested_at: new Date().toISOString(),
        decided_by: null,
        decided_at: null,
        executed_at: null,
      },
      replay: false,
    };
    processPaymentRefund.mockResolvedValue({ dualApproval: gate });

    const res = mockRes();
    await ctrl.issueManualRefund(refundReq(), res);

    expect(processPaymentRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay-2',
        dualApproval: expect.objectContaining({
          movementType: 'job_refund',
          requestedBy: ADMIN_ID,
        }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'money_movement_pending_approval' })
    );
  });

  test('below-threshold refund keeps single-approval behavior (200)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [smallPaymentRow] });
    processPaymentRefund.mockResolvedValue({
      attempt: { status: 'succeeded', id: 'att-1', stripe_refund_id: 're_123', amount_cents: 2500 },
    });
    const res = mockRes();
    await ctrl.issueManualRefund(refundReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ refundId: 're_123' }));
  });

  test('missing amount without fullRefund passes the explicit contract through (service 400s)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [smallPaymentRow] });
    const res = mockRes();
    await ctrl.issueManualRefund(refundReq({ fullRefund: false, amount_cents: undefined }), res);
    // processPaymentRefund (mocked) would 400 via the service contract; the
    // controller passes the explicit contract through instead of assuming.
    expect(processPaymentRefund).toHaveBeenCalledWith(
      expect.objectContaining({ requestedAmountCents: null, fullRefund: false })
    );
  });
});
