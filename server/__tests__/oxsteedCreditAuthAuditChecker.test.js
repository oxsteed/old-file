'use strict';

/**
 * Auth audit 2026-10-22 (credit-core track): item 2, checker half.
 *
 * The checker's fail-closed compliance re-evaluation in decidePendingAction
 * must cover credit_adjustment exactly like credit_load: an admin adjustment
 * approved up to 24h after the maker-time pass is re-screened (identity tier
 * + sanctions) at the moment money moves, tagged with fundingMethod
 * 'admin_adjustment'. A fresh hit fails the approval closed before the
 * executor runs.
 *
 * Mirrors the credit_load re-eval tests in oxsteedCreditGovernance.test.js.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return { ...actual, adjustCustomerCredit: jest.fn().mockResolvedValue({ posted: true }) };
});
jest.mock('../services/fiatComplianceService', () => ({
  evaluateFundingCompliance: jest.fn().mockResolvedValue({ allowed: true }),
}));

const { decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const creditService = require('../services/oxsteedCreditService');

const MAKER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const CHECKER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ACTION_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function pendingRow(overrides = {}) {
  return {
    id: ACTION_ID,
    action_type: 'credit_adjustment',
    payload: { customerId: 'cust-1', amountCents: 2500, currencyCode: 'USD', direction: 'credit', reason: 'grant', referenceId: 'ref-9' },
    requested_by: MAKER_ID,
    requested_at: '2026-10-01T10:00:00.000Z',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
    idempotency_key: 'test-key-1',
    execution_refs: {},
    ...overrides,
  };
}

function installAdjustmentRouter() {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
    if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE')) {
      return { rows: [pendingRow()] };
    }
    if (s.includes('UPDATE oxsteed_credit_pending_actions')) {
      return { rows: [pendingRow({ status: 'approved', decided_by: CHECKER_ID })] };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1')) {
      return { rows: [pendingRow({ status: 'approved', decided_by: CHECKER_ID })] };
    }
    if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  resetMocks();
  evaluateFundingCompliance.mockReset().mockResolvedValue({ allowed: true });
  creditService.adjustCustomerCredit.mockReset().mockResolvedValue({ posted: true });
});

describe('item 2 (checker): credit_adjustment re-evaluates compliance at approval time', () => {
  test('approving a credit adjustment re-evaluates compliance as admin_adjustment', async () => {
    installAdjustmentRouter();
    const result = await decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: CHECKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    });
    expect(result.pendingAction.status).toBe('approved');
    expect(evaluateFundingCompliance).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cust-1',
      amountCents: 2500,
      currencyCode: 'USD',
      fundingMethod: 'admin_adjustment',
      actorUserId: CHECKER_ID,
    }));
    expect(creditService.adjustCustomerCredit).toHaveBeenCalledTimes(1);
  });

  test('a fresh sanctions hit at approval time fails the adjustment closed', async () => {
    installAdjustmentRouter();
    evaluateFundingCompliance.mockRejectedValueOnce(
      Object.assign(new Error('Sanctions hit'), { status: 403, code: 'fiat_compliance_sanctions_hit' })
    );
    await expect(decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: CHECKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    })).rejects.toMatchObject({ status: 403, code: 'fiat_compliance_sanctions_hit' });
    expect(creditService.adjustCustomerCredit).not.toHaveBeenCalled();
  });
});
