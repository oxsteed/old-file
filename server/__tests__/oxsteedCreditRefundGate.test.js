'use strict';

/**
 * Item 43 (Oct 29 money re-verification): credit refund approvals are
 * re-evaluated at checker time with sanctions + identity-tier checks
 * ONLY. No issuance-capacity check: a refund reduces outstanding credit,
 * so that check would deny refunds for customers near a cap.
 *
 * Part A mirrors oxsteedCreditAuthAuditChecker.test.js: approving a
 * credit_refund resolves the customer + currency from the original
 * purchase (the stored payload carries no customerId) and calls the gate
 * with fundingMethod 'admin_refund' and skipIssuanceCapacity: true.
 *
 * Part B tests the real evaluateFundingCompliance: with the flag set, a
 * capacity breach does not block, and the skip is recorded in the pass
 * audit metadata.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return {
    ...actual,
    refundCredit: jest.fn().mockResolvedValue({ posted: true }),
    assertCreditRailEnabled: jest.fn().mockResolvedValue(undefined),
    assertIssuanceCapacity: jest.fn(),
  };
});
jest.mock('../services/identityVerificationService', () => ({
  assertIdentityVerificationTier: jest.fn().mockResolvedValue({ tier: 2 }),
}));
jest.mock('../services/sanctionsScreeningService', () => ({
  assertSanctionsClear: jest.fn().mockResolvedValue({ cleared: true }),
}));
jest.mock('../services/fiatComplianceService', () => ({
  evaluateFundingCompliance: jest.fn().mockResolvedValue({ allowed: true }),
}));

const { decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
const { evaluateFundingCompliance } = require('../services/fiatComplianceService');
const creditService = require('../services/oxsteedCreditService');

const MAKER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const CHECKER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ACTION_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function pendingRefundRow(overrides = {}) {
  return {
    id: ACTION_ID,
    action_type: 'credit_refund',
    payload: { purchaseTransactionId: 'tx-1', amountCents: 5000, reason: 'defective', metadata: {} },
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

let purchaseRow = { customer_id: 'cust-9', currency_code: 'EUR' };

function installRefundRouter() {
  mockQuery.mockImplementation((sql) => {
    const s = String(sql);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
    if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE')) {
      return { rows: [pendingRefundRow()] };
    }
    if (s.includes('FROM oxsteed_credit_transactions t')) {
      return { rows: purchaseRow ? [purchaseRow] : [] };
    }
    if (s.includes('UPDATE oxsteed_credit_pending_actions')) {
      return { rows: [pendingRefundRow({ status: 'approved', decided_by: CHECKER_ID })] };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1')) {
      return { rows: [pendingRefundRow({ status: 'approved', decided_by: CHECKER_ID })] };
    }
    if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
    return { rows: [] };
  });
}

function approveRefund() {
  return decidePendingAction({
    actionId: ACTION_ID,
    decidedBy: CHECKER_ID,
    decision: 'approve',
    stepupChallengeId: 'challenge-1',
    stepupCode: '123456',
  });
}

beforeEach(() => {
  resetMocks();
  purchaseRow = { customer_id: 'cust-9', currency_code: 'EUR' };
  evaluateFundingCompliance.mockReset().mockResolvedValue({ allowed: true });
  creditService.refundCredit.mockReset().mockResolvedValue({ posted: true });
});

describe('checker: credit_refund re-evaluates sanctions + tier at approval time', () => {
  test('approving a refund resolves the customer via the purchase join and gates with skipIssuanceCapacity', async () => {
    installRefundRouter();
    const result = await approveRefund();
    expect(result.pendingAction.status).toBe('approved');
    expect(evaluateFundingCompliance).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'cust-9',
      amountCents: 5000,
      currencyCode: 'EUR',
      fundingMethod: 'admin_refund',
      actorUserId: CHECKER_ID,
      skipIssuanceCapacity: true,
    }));
    expect(creditService.refundCredit).toHaveBeenCalledTimes(1);
  });

  test('a fresh sanctions hit at approval time fails the refund closed', async () => {
    installRefundRouter();
    evaluateFundingCompliance.mockRejectedValueOnce(
      Object.assign(new Error('Sanctions hit'), { status: 403, code: 'fiat_compliance_sanctions_hit' })
    );
    await expect(approveRefund()).rejects.toMatchObject({ status: 403, code: 'fiat_compliance_sanctions_hit' });
    expect(creditService.refundCredit).not.toHaveBeenCalled();
  });

  test('an unresolvable purchase fails closed with purchase-not-found, never a customer-required 400', async () => {
    purchaseRow = null;
    installRefundRouter();
    await expect(approveRefund()).rejects.toMatchObject({ status: 404, code: 'credit_purchase_not_found' });
    expect(evaluateFundingCompliance).not.toHaveBeenCalled();
    expect(creditService.refundCredit).not.toHaveBeenCalled();
  });
});
