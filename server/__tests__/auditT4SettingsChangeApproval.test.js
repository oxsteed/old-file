'use strict';

/**
 * Audit T4 (item 13) — platform settings change-request approval.
 *
 * The approval path controls platform_fee_*, escrow_release_delay_hrs,
 * money_dual_approval_threshold_cents and credit-rail enablement. It now:
 *   1. rejects impersonated sessions on the approve/reject/schedule/cancel
 *      routes (rejectImpersonated in server/routes/settingsChanges.js), and
 *   2. requires the approver to prove a fresh step-up challenge
 *      (verifyStepupChallenge, actionType 'settings_change_approve') before
 *      the decision is recorded.
 */

const crypto = require('crypto');
const fs = require('fs');
const { mockQuery, resetMocks } = require('./setup');

const settingsChangeController = require('../controllers/settingsChangeController');
const { rejectImpersonated } = require('../middleware/rejectImpersonated');

const APPROVER_ID = '00000000-0000-4000-8000-000000000102';
const PROPOSER_ID = '00000000-0000-4000-8000-000000000101';
const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function stepupHash(code) {
  const pepper = process.env.OXSTEED_CREDIT_STEPUP_PEPPER || process.env.JWT_SECRET;
  return crypto.createHmac('sha256', pepper).update(`stepup:${String(code)}`).digest('hex');
}

function proposedRequest() {
  return {
    id: REQUEST_ID,
    kind: 'setting',
    key: 'escrow_release_delay_hrs',
    proposed_value: '72',
    reason: 'test',
    status: 'proposed',
    proposed_by: PROPOSER_ID,
    reviewed_by: null,
    decided_at: null,
    // future effective_at so the non-due branch is taken (no apply)
    effective_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    rollout_percent: null,
    rollout_segment: null,
  };
}

beforeEach(() => {
  resetMocks();
});

describe('item 13: route guards', () => {
  const src = fs.readFileSync(require.resolve('../routes/settingsChanges.js'), 'utf8');

  test.each(['approve', 'reject', 'schedule', 'cancel'])(
    'POST /:id/%s mounts rejectImpersonated',
    (action) => {
      expect(src).toMatch(new RegExp(`'/:id/${action}',\\s*rejectImpersonated`));
    }
  );

  test('rejectImpersonated blocks an impersonated session', () => {
    const res = mockRes();
    const next = jest.fn();
    rejectImpersonated({ isImpersonated: true, headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'impersonation_blocked' })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe('item 13: approveChange requires a fresh step-up', () => {
  const approveReq = (body) => ({
    params: { id: REQUEST_ID },
    body,
    user: { id: APPROVER_ID, role: 'admin' },
    ip: '127.0.0.1',
    headers: { 'user-agent': 'admin-test' },
  });

  test('403s with credit_stepup_challenge_required when no challenge is presented', async () => {
    mockQuery.mockResolvedValue({ rows: [{}] });
    const res = mockRes();
    await settingsChangeController.approveChange(approveReq({}), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'credit_stepup_challenge_required' })
    );
    // no decision recorded
    expect(
      mockQuery.mock.calls.some(([sql]) => /UPDATE settings_change_requests/i.test(String(sql)))
    ).toBe(false);
  });

  test('403s when the presented code is wrong', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM oxsteed_credit_stepup_challenges/i.test(sql)) {
        return Promise.resolve({
          rows: [{
            id: 'challenge-1',
            actor_user_id: APPROVER_ID,
            action_type: 'settings_change_approve',
            code_hash: stepupHash('123456'),
            attempts: 0,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 600000).toISOString(),
            consumed_at: null,
          }],
        });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await settingsChangeController.approveChange(
      approveReq({ stepupChallengeId: 'challenge-1', stepupCode: '000000' }),
      res
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'credit_stepup_challenge_invalid' })
    );
    expect(
      mockQuery.mock.calls.some(([sql]) => /UPDATE settings_change_requests/i.test(String(sql)))
    ).toBe(false);
  });

  test('a verified challenge lets the approval proceed', async () => {
    mockQuery.mockImplementation((sql) => {
      if (/FROM oxsteed_credit_stepup_challenges/i.test(sql)) {
        return Promise.resolve({
          rows: [{
            id: 'challenge-1',
            actor_user_id: APPROVER_ID,
            action_type: 'settings_change_approve',
            code_hash: stepupHash('123456'),
            attempts: 0,
            max_attempts: 5,
            expires_at: new Date(Date.now() + 600000).toISOString(),
            consumed_at: null,
          }],
        });
      }
      if (/SELECT \* FROM settings_change_requests/i.test(sql)) {
        return Promise.resolve({ rows: [proposedRequest()] });
      }
      if (/UPDATE settings_change_requests SET status = 'approved'.*RETURNING/i.test(sql)) {
        return Promise.resolve({ rows: [{ ...proposedRequest(), status: 'approved' }] });
      }
      return Promise.resolve({ rows: [{}] });
    });
    const res = mockRes();
    await settingsChangeController.approveChange(
      approveReq({ stepupChallengeId: 'challenge-1', stepupCode: '123456' }),
      res
    );
    // challenge consumed (single-use)
    expect(
      mockQuery.mock.calls.some(([sql]) =>
        /UPDATE oxsteed_credit_stepup_challenges SET consumed_at/i.test(String(sql)))
    ).toBe(true);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ status: 'approved' }),
        applied: false,
      })
    );
  });
});
