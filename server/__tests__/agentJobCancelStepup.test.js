'use strict';

/**
 * Agent job-cancel step-up (auth-audit finding 24).
 *
 * POST /api/admin/jobs/:jobId/cancel cancels as the support agent.
 * Pre-acceptance cancels never charge a fee (session gate only);
 * post-acceptance cancels can collect a cancellation fee, so they need a
 * fresh email-OTP step-up challenge.
 */

const { mockQuery, resetMocks } = require('./setup');
const AppError = require('../utils/appError');

jest.mock('../services/jobCancellationService', () => {
  const actual = jest.requireActual('../services/jobCancellationService');
  return {
    ...actual,
    cancelJobTransaction: jest.fn(),
    finalizeJobCancellation: jest.fn(),
  };
});
jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return {
    ...actual,
    verifyStepupChallenge: jest.fn(),
    issueStepupChallenge: jest.fn(),
  };
});

const { cancelJobTransaction } = require('../services/jobCancellationService');
const { verifyStepupChallenge, issueStepupChallenge } = require('../services/stepupChallengeService');
const agentJobActions = require('../controllers/agentJobActions');

function fakeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('finding 24: cancelJobAsAgent step-up', () => {
  test('pre-acceptance cancel needs no challenge', async () => {
    mockQuery.mockResolvedValue({ rows: [{ status: 'published' }] });
    cancelJobTransaction.mockResolvedValue({
      type: 'pre_acceptance', job: { id: 'j1' }, before_status: 'published', rejectedBids: [],
    });
    const req = { params: { jobId: 'j1' }, body: { reason: 'customer asked' }, user: { id: 'admin-1' } };
    const res = fakeRes();
    const next = jest.fn();
    await agentJobActions.cancelJobAsAgent(req, res, next);
    expect(verifyStepupChallenge).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test('post-acceptance cancel without a challenge is rejected', async () => {
    mockQuery.mockResolvedValue({ rows: [{ status: 'in_progress' }] });
    verifyStepupChallenge.mockRejectedValue(new AppError('challenge required', 400, 'credit_stepup_challenge_required'));
    const req = { params: { jobId: 'j2' }, body: { reason: 'no-show' }, user: { id: 'admin-1' } };
    const res = fakeRes();
    const next = jest.fn();
    await agentJobActions.cancelJobAsAgent(req, res, next);
    expect(verifyStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      actionType: 'agent_job_cancel',
    }));
    expect(cancelJobTransaction).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'credit_stepup_challenge_required' }));
  });

  test('post-acceptance cancel with a valid challenge proceeds', async () => {
    mockQuery.mockResolvedValue({ rows: [{ status: 'in_progress' }] });
    verifyStepupChallenge.mockResolvedValue({ verified: true });
    cancelJobTransaction.mockResolvedValue({
      type: 'post_acceptance', job_id: 'j3', before_status: 'in_progress',
      cancelled_at: new Date().toISOString(), fee_charged_cents: 500,
      fee_to_helper_cents: 0, fee_to_platform_cents: 500, payment_method: 'card',
    });
    const req = {
      params: { jobId: 'j3' },
      body: { reason: 'fraud', stepupChallengeId: 'ch-1', stepupCode: '123456' },
      user: { id: 'admin-1' },
    };
    const res = fakeRes();
    const next = jest.fn();
    await agentJobActions.cancelJobAsAgent(req, res, next);
    expect(verifyStepupChallenge).toHaveBeenCalledWith({
      challengeId: 'ch-1',
      actorUserId: 'admin-1',
      actionType: 'agent_job_cancel',
      code: '123456',
    });
    expect(cancelJobTransaction).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('finding 24: issueAgentJobCancelStepupChallenge', () => {
  test('issues a challenge for the agent_job_cancel action type', async () => {
    issueStepupChallenge.mockResolvedValue({
      challenge: {
        id: 'ch-9', actionType: 'agent_job_cancel', amountCents: 1,
        currencyCode: 'USD', expiresAt: '2030-01-01T00:00:00.000Z',
      },
      delivery: { channel: 'email' },
    });
    const req = { user: { id: 'admin-1', email: 'agent@example.com' }, body: {} };
    const res = fakeRes();
    const next = jest.fn();
    await agentJobActions.issueAgentJobCancelStepupChallenge(req, res, next);
    expect(issueStepupChallenge).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: 'admin-1',
      actionType: 'agent_job_cancel',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body.challenge.id).toBe('ch-9');
    expect(next).not.toHaveBeenCalled();
  });
});
