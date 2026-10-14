'use strict';

/**
 * moneyApprovalController.test.js — ADM-016 (checker endpoints)
 *
 * - Approve requires a fresh step-up challenge before money moves.
 * - Self-approval is blocked (403) even if step-up passed.
 * - Reject requires a reason and flips the approval terminal.
 * - The approval list is sanitized (no payload internals leak).
 */

const { resetMocks } = require('./setup');

jest.mock('../services/dualApprovalService', () => ({
  listPendingMoneyMovementApprovals: jest.fn(),
  getMoneyMovementApproval: jest.fn(),
  decideMoneyMovementApproval: jest.fn(),
}));
jest.mock('../services/stepupChallengeService', () => ({
  issueStepupChallenge: jest.fn(),
  verifyStepupChallenge: jest.fn(),
}));
jest.mock('../services/auditService', () => ({
  logAdminAction: jest.fn().mockResolvedValue(undefined),
}));

const dualApproval = require('../services/dualApprovalService');
const stepup = require('../services/stepupChallengeService');
const ctrl = require('../controllers/moneyApprovalController');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const PENDING = {
  id: 5,
  movement_type: 'job_refund',
  reference_key: 'job:job-1',
  amount_cents: 60000,
  currency_code: 'USD',
  status: 'pending',
  requested_by: 'maker-admin',
  requested_at: new Date().toISOString(),
  decided_by: null,
  decided_at: null,
  executed_at: null,
  payload: { secret: 'must-not-leak' },
};

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('list', () => {
  test('returns sanitized pending approvals', async () => {
    dualApproval.listPendingMoneyMovementApprovals.mockResolvedValue([PENDING]);
    const res = mockRes();
    await ctrl.list({ query: {} }, res, (e) => { throw e; });
    expect(res.json).toHaveBeenCalledWith({
      approvals: [expect.objectContaining({ id: 5, movementType: 'job_refund', amountCents: 60000 })],
    });
    expect(res.json.mock.calls[0][0].approvals[0]).not.toHaveProperty('payload');
  });
});

describe('approve', () => {
  const approveReq = () => ({
    params: { id: '5' },
    body: { stepupChallengeId: 'ch-1', stepupCode: '123456' },
    user: { id: 'checker-admin' },
  });

  test('verifies step-up before deciding, then executes', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue(undefined);
    dualApproval.decideMoneyMovementApproval.mockResolvedValue({
      approval: { ...PENDING, status: 'executed' },
      result: { refundId: 're_1' },
    });
    const res = mockRes();
    await ctrl.approve(approveReq(), res, (e) => { throw e; });
    expect(stepup.verifyStepupChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'money_movement_approve', actorUserId: 'checker-admin' })
    );
    expect(dualApproval.decideMoneyMovementApproval).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: '5', approverId: 'checker-admin', decision: 'approve' })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        approval: expect.objectContaining({ id: 5, status: 'executed' }),
        result: { refundId: 're_1' },
      })
    );
  });

  test('a failed step-up never reaches the decision', async () => {
    const err = new Error('Invalid or expired challenge');
    err.status = 401;
    err.code = 'stepup_invalid';
    stepup.verifyStepupChallenge.mockRejectedValue(err);
    const res = mockRes();
    const next = jest.fn();
    await ctrl.approve(approveReq(), res, next);
    expect(dualApproval.decideMoneyMovementApproval).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(err);
  });

  test('self-approval surfaces the 403 from the service', async () => {
    stepup.verifyStepupChallenge.mockResolvedValue(undefined);
    const err = new Error('The requesting admin cannot approve their own money movement.');
    err.status = 403;
    err.code = 'money_movement_self_approval';
    dualApproval.decideMoneyMovementApproval.mockRejectedValue(err);
    const res = mockRes();
    const next = jest.fn();
    await ctrl.approve({ ...approveReq(), user: { id: 'maker-admin' } }, res, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('reject', () => {
  test('reject requires a reason', async () => {
    const res = mockRes();
    await ctrl.reject({ params: { id: '5' }, body: {}, user: { id: 'checker-admin' } }, res, (e) => { throw e; });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(dualApproval.decideMoneyMovementApproval).not.toHaveBeenCalled();
  });

  test('reject with a reason flips the approval terminal', async () => {
    dualApproval.decideMoneyMovementApproval.mockResolvedValue({
      approval: { ...PENDING, status: 'rejected' },
    });
    const res = mockRes();
    await ctrl.reject(
      { params: { id: '5' }, body: { reason: 'Duplicate request' }, user: { id: 'checker-admin' } },
      res,
      (e) => { throw e; }
    );
    expect(dualApproval.decideMoneyMovementApproval).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'reject', reason: 'Duplicate request' })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ approval: expect.objectContaining({ status: 'rejected' }) })
    );
  });
});
