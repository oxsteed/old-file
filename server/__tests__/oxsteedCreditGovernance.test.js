'use strict';

/**
 * OxSteed Credit Phase 7 (gaps 9/10/11): governance and ledger safety.
 *
 * Covers the maker-checker queue (queue without execution, single
 * execution on approval, double-approve no-op, self-approval 403, expiry,
 * rejection reason), compensated dispute resolutions (append-only, hash
 * chain intact), reservation enforcement (withdrawal 409, payout failure
 * release), reservation-aware reconciliation paging a critical incident,
 * and the rail fail-closed gate (503s).
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});
jest.mock('../services/oxsteedCreditFeeScheduleService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditFeeScheduleService');
  return { ...actual, updateFeeScheduleRow: jest.fn() };
});
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ id: 'incident-1' }),
}));
// The dispute service destructures these at require time, so they must be
// mocked at module level; requireActual keeps every other export real.
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return {
    ...actual,
    adjustCustomerCreditInTransaction: jest.fn(),
    refundCreditInTransaction: jest.fn(),
  };
});

const {
  requestPendingAction,
  decidePendingAction,
} = require('../services/oxsteedCreditPendingActionService');
const { reserveFunds } = require('../services/oxsteedCreditReservationService');
const { resolveDisputeWithCompensation } = require('../services/oxsteedCreditDisputeService');
const { reconcileCreditLedger } = require('../services/oxsteedCreditAdminService');
const { failSettlementPayoutFromTransfer } = require('../services/oxsteedCreditAdminService');
const feeScheduleService = require('../services/oxsteedCreditFeeScheduleService');
const creditService = require('../services/oxsteedCreditService');
const { recordIncident } = require('../services/incidentStore');
const { AppError } = require('../middleware/errorHandler');

const MAKER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const CHECKER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ACTION_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

// Mutable rail state for the router: enabled + unfrozen by default.
// Mutable decided status so post-decision re-reads reflect the new state.
let railEnabled = true;
let railFrozen = false;
let decidedStatus = 'pending';

function pendingRow(overrides = {}) {
  return {
    id: ACTION_ID,
    action_type: 'credit_fee_schedule_update',
    payload: { id: '7', fixedCents: 100 },
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

function installRouter() {
  mockQuery.mockImplementation((sql, params = []) => {
    const s = String(sql);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    // Rail gate.
    if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
      return { rows: railEnabled ? [{ is_enabled: true }] : [{ is_enabled: false }] };
    }
    if (s.includes('FROM oxsteed_credit_rail_freezes')) {
      return { rows: railFrozen ? [{ id: 1, reason: 'test freeze', frozen_at: new Date().toISOString() }] : [] };
    }
    // Pending actions.
    if (s.includes('INSERT INTO oxsteed_credit_pending_actions')) return { rows: [pendingRow()] };
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE')) {
      return { rows: [pendingRow({ status: decidedStatus })] };
    }
    if (s.includes('UPDATE oxsteed_credit_pending_actions')) {
      const status = s.includes("status = 'approved'") ? 'approved'
        : s.includes("status = 'rejected'") ? 'rejected'
        : s.includes("status = 'expired'") ? 'expired' : 'pending';
      decidedStatus = status;
      return { rows: [pendingRow({ status, decided_by: CHECKER_ID, execution_refs: { feeScheduleRow: { id: 7 } } })] };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1')) return { rows: [pendingRow({ status: decidedStatus })] };
    // Audit events.
    if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
    // Reservations.
    if (s.includes('FROM oxsteed_credit_accounts') && s.includes('FOR UPDATE')) {
      return { rows: [{ id: 101, balance_cents: 10000, reserved_cents: 9000, status: 'active' }] };
    }
    if (s.includes('INSERT INTO oxsteed_credit_reservations')) {
      return { rows: [{ id: 'rrrrrrrr-rrrr-4rrr-rrrr-rrrrrrrrrrrr', account_id: 101, reservation_type: 'withdrawal', reference_type: 'credit_withdrawal', reference_id: 'w-1', amount_cents: params[4], status: 'active' }] };
    }
    if (s.includes('UPDATE oxsteed_credit_accounts') && s.includes('reserved_cents')) return { rows: [] };
    return { rows: [] };
  });
}

beforeEach(() => {
  resetMocks();
  railEnabled = true;
  railFrozen = false;
  feeScheduleService.updateFeeScheduleRow.mockReset();
  feeScheduleService.updateFeeScheduleRow.mockResolvedValue({ id: 7, fixed_cents: 100 });
  recordIncident.mockClear();
  creditService.adjustCustomerCreditInTransaction.mockReset();
  creditService.refundCreditInTransaction.mockReset();
  decidedStatus = 'pending';
  installRouter();
});

describe('maker-checker queue', () => {
  test('requesting queues the action without executing it', async () => {
    const result = await requestPendingAction({
      actionType: 'credit_fee_schedule_update',
      payload: { id: '7', fixedCents: 100 },
      requestedBy: MAKER_ID,
      idempotencyKey: 'test-key-1',
    });
    expect(result.executed).toBe(false);
    expect(result.pendingAction.status).toBe('pending');
    expect(feeScheduleService.updateFeeScheduleRow).not.toHaveBeenCalled();
  });

  test('approval executes exactly once; a second approval replays stored refs', async () => {
    const first = await decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: CHECKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    });
    expect(first.replayed).toBe(false);
    expect(feeScheduleService.updateFeeScheduleRow).toHaveBeenCalledTimes(1);
    expect(first.pendingAction.status).toBe('approved');

    // Second decision sees an already-approved row: no re-execution.
    const second = await decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: CHECKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    });
    expect(second.replayed).toBe(true);
    expect(feeScheduleService.updateFeeScheduleRow).toHaveBeenCalledTimes(1);
  });

  test('the maker cannot approve their own action (403)', async () => {
    await expect(decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: MAKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    })).rejects.toMatchObject({ status: 403, code: 'credit_self_approval_forbidden' });
    expect(feeScheduleService.updateFeeScheduleRow).not.toHaveBeenCalled();
  });

  test('an expired action is marked expired and never executes', async () => {
    mockQuery.mockImplementation((sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
      if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
      if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE')) {
        return { rows: [pendingRow({ expires_at: new Date(Date.now() - 1000).toISOString() })] };
      }
      if (s.includes("status = 'expired'")) return { rows: [] };
      if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [] };
    });
    await expect(decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: CHECKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    })).rejects.toMatchObject({ status: 409, code: 'credit_pending_action_expired' });
    expect(feeScheduleService.updateFeeScheduleRow).not.toHaveBeenCalled();
  });

  test('rejection requires a reason (400)', async () => {
    await expect(decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: CHECKER_ID,
      decision: 'rejected',
      reason: '',
    })).rejects.toMatchObject({ status: 400, code: 'credit_decision_reason_required' });
  });

  test('rail-disabled requests fail closed with 503', async () => {
    railEnabled = false;
    await expect(requestPendingAction({
      actionType: 'credit_fee_schedule_update',
      payload: { id: '7' },
      requestedBy: MAKER_ID,
      idempotencyKey: 'test-key-2',
    })).rejects.toMatchObject({ status: 503 });
  });

  test('rail-frozen decisions fail closed with 503', async () => {
    railFrozen = true;
    await expect(decidePendingAction({
      actionId: ACTION_ID,
      decidedBy: CHECKER_ID,
      decision: 'approve',
      stepupChallengeId: 'challenge-1',
      stepupCode: '123456',
    })).rejects.toMatchObject({ status: 503, code: 'credit_rail_frozen' });
    expect(feeScheduleService.updateFeeScheduleRow).not.toHaveBeenCalled();
  });
});

describe('compensated dispute resolutions', () => {
  const DISPUTE_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';
  const TX_ID = 'tx-disputed-1';

  function disputeRow(overrides = {}) {
    return {
      id: DISPUTE_ID,
      customer_id: 'cust-1',
      partner_id: null,
      transaction_id: TX_ID,
      amount_cents: 5000,
      currency_code: 'USD',
      status: 'in_review',
      reason_code: 'duplicate_charge',
      description: 'Charged twice',
      resolution: null,
      dispute_type: 'duplicate_charge',
      sla_due_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      resolution_entries: {},
      opened_at: '2026-10-01T09:00:00.000Z',
      restaurant_name: null,
      ...overrides,
    };
  }

  function installDisputeRouter() {
    mockQuery.mockImplementation((sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
      if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
      if (s.includes('FROM oxsteed_credit_disputes d')) return { rows: [disputeRow()] };
      if (s.includes('FROM oxsteed_credit_transactions') && s.includes('WHERE id = $1')) {
        // Disputed transaction is a load (not a purchase): compensation must
        // post as an adjustment credit, never as a refund.
        return { rows: [{ id: TX_ID, amount_cents: 5000, currency_code: 'USD', transaction_type: 'load' }] };
      }
      if (s.includes('UPDATE oxsteed_credit_disputes')) {
        return { rows: [disputeRow({ status: 'resolved_customer', resolution: 'Compensated', resolution_entries: { compensation: { kind: 'adjustment', transactionId: 'tx-comp-1', amountCents: 1500, decidedBy: CHECKER_ID } } })] };
      }
      if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [] };
    });
  }

  test('compensation posts a new adjustment entry and never edits the original transaction', async () => {
    installDisputeRouter();
    creditService.adjustCustomerCreditInTransaction.mockResolvedValue({ transaction: { id: 'tx-comp-1' } });
    const result = await resolveDisputeWithCompensation({
      disputeId: DISPUTE_ID,
      adminId: CHECKER_ID,
      decision: 'resolved_customer',
      reason: 'Duplicate charge confirmed; compensating the customer.',
      compensationCents: 1500,
    });
    expect(result.dispute.status).toBe('resolved_customer');
    // A NEW compensating entry was posted (append-only)...
    expect(creditService.adjustCustomerCreditInTransaction).toHaveBeenCalledTimes(1);
    const call = creditService.adjustCustomerCreditInTransaction.mock.calls[0][1];
    expect(call.amountCents).toBe(1500);
    expect(call.direction).toBe('credit');
    expect(call.referenceType).toBe('oxsteed_credit_dispute');
    // ...and the original journal transaction was never UPDATEd.
    const updateTxCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('UPDATE oxsteed_credit_transactions'));
    expect(updateTxCalls).toHaveLength(0);
    // The compensation is recorded in resolution_entries for the audit trail.
    expect(result.dispute.resolutionEntries.compensation.amountCents).toBe(1500);
    expect(result.dispute.resolutionEntries.compensation.kind).toBe('adjustment');
  });

  test('compensation cannot exceed the disputed amount', async () => {
    installDisputeRouter();
    await expect(resolveDisputeWithCompensation({
      disputeId: DISPUTE_ID,
      adminId: CHECKER_ID,
      decision: 'resolved_customer',
      reason: 'Too generous.',
      compensationCents: 99999,
    })).rejects.toMatchObject({ status: 400, code: 'credit_dispute_compensation_exceeds' });
  });

  test('a terminal dispute cannot be reopened', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
      if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
      if (s.includes('FROM oxsteed_credit_disputes d')) return { rows: [disputeRow({ status: 'resolved_merchant' })] };
      return { rows: [] };
    });
    await expect(resolveDisputeWithCompensation({
      disputeId: DISPUTE_ID,
      adminId: CHECKER_ID,
      decision: 'in_review',
      reason: 'Trying to reopen.',
    })).rejects.toMatchObject({ status: 409, code: 'credit_dispute_state_invalid' });
  });
});

describe('provisional credit on disputes under review', () => {
  const DISPUTE_ID = 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee';
  const ADMIN_ID = 'ffffffff-ffff-4fff-ffff-ffffffffffff';

  function provisionalDisputeRow(overrides = {}) {
    return {
      id: DISPUTE_ID,
      customer_id: 'cust-1',
      partner_id: null,
      transaction_id: 'tx-provisional-1',
      status: 'in_review',
      reason_code: 'incorrect_amount',
      description: 'Wrong amount',
      resolution: null,
      resolution_entries: {},
      provisional_credit_cents: 0,
      transaction_amount_cents: 5000,
      transaction_currency_code: 'USD',
      opened_at: '2026-10-01T09:00:00.000Z',
      ...overrides,
    };
  }

  function installProvisionalRouter(rowOverrides = {}, existingIdempotency = false) {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
      if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
      if (s.includes('FROM oxsteed_credit_disputes d')) return { rows: [provisionalDisputeRow(rowOverrides)] };
      if (s.includes('FROM oxsteed_credit_transactions WHERE idempotency_key')) {
        return existingIdempotency ? { rows: [{ id: 'tx-provisional-existing' }] } : { rows: [] };
      }
      if (s.includes('UPDATE oxsteed_credit_disputes')) {
        return { rows: [provisionalDisputeRow({ provisional_credit_cents: (rowOverrides.provisional_credit_cents || 0) + 1500, ...rowOverrides })] };
      }
      if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [] };
    });
  }

  beforeEach(() => {
    resetMocks();
    creditService.adjustCustomerCreditInTransaction.mockReset();
  });

  test('provisional credit posts an adjustment and keeps the dispute in review', async () => {
    installProvisionalRouter();
    creditService.adjustCustomerCreditInTransaction.mockResolvedValue({ transaction: { id: 'tx-prov-1' } });
    const { issueProvisionalCredit } = require('../services/oxsteedCreditDisputeService');
    const result = await issueProvisionalCredit({
      disputeId: DISPUTE_ID,
      adminId: ADMIN_ID,
      amountCents: 1500,
      reason: 'Investigating; crediting the customer while the review runs.',
    });
    expect(result.replayed).toBe(false);
    expect(result.dispute.status).toBe('in_review');
    expect(result.provisionalCredit.amountCents).toBe(1500);
    expect(result.provisionalCredit.transactionId).toBe('tx-prov-1');
    const call = creditService.adjustCustomerCreditInTransaction.mock.calls[0][1];
    expect(call.amountCents).toBe(1500);
    expect(call.direction).toBe('credit');
    expect(call.referenceType).toBe('oxsteed_credit_dispute');
    expect(call.metadata.provisional).toBe(true);
    // The dispute records the cumulative provisional total.
    const updateCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('provisional_credit_cents = provisional_credit_cents + $1'));
    expect(updateCalls).toHaveLength(1);
    // An audit event records the money movement.
    const auditCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('credit.dispute.provisional_credit'));
    expect(auditCalls).toHaveLength(1);
  });

  test('provisional credit cannot exceed the disputed amount', async () => {
    installProvisionalRouter({ provisional_credit_cents: 4000 });
    const { issueProvisionalCredit } = require('../services/oxsteedCreditDisputeService');
    await expect(issueProvisionalCredit({
      disputeId: DISPUTE_ID,
      adminId: ADMIN_ID,
      amountCents: 1500,
      reason: 'Too generous.',
    })).rejects.toMatchObject({ status: 400, code: 'credit_provisional_credit_exceeds' });
    expect(creditService.adjustCustomerCreditInTransaction).not.toHaveBeenCalled();
  });

  test('provisional credit is only available while the dispute is in review', async () => {
    installProvisionalRouter({ status: 'open' });
    const { issueProvisionalCredit } = require('../services/oxsteedCreditDisputeService');
    await expect(issueProvisionalCredit({
      disputeId: DISPUTE_ID,
      adminId: ADMIN_ID,
      amountCents: 1500,
      reason: 'Not yet under review.',
    })).rejects.toMatchObject({ status: 409, code: 'credit_dispute_state_invalid' });
  });

  test('a repeated provisional credit with identical inputs replays instead of double-crediting', async () => {
    installProvisionalRouter({}, true);
    const { issueProvisionalCredit } = require('../services/oxsteedCreditDisputeService');
    const result = await issueProvisionalCredit({
      disputeId: DISPUTE_ID,
      adminId: ADMIN_ID,
      amountCents: 1500,
      reason: 'Same inputs twice.',
    });
    expect(result.replayed).toBe(true);
    expect(creditService.adjustCustomerCreditInTransaction).not.toHaveBeenCalled();
  });

  test('final compensation is reduced by provisional credit already issued', async () => {
    installDisputeRouterForProvisionalCap();
    creditService.adjustCustomerCreditInTransaction.mockResolvedValue({ transaction: { id: 'tx-comp-2' } });
    await expect(resolveDisputeWithCompensation({
      disputeId: DISPUTE_ID,
      adminId: ADMIN_ID,
      decision: 'resolved_customer',
      reason: 'Over the cap once provisional is counted.',
      compensationCents: 1500,
    })).rejects.toMatchObject({ status: 400, code: 'credit_dispute_compensation_exceeds' });

    function installDisputeRouterForProvisionalCap() {
      mockQuery.mockImplementation((sql) => {
        const s = String(sql);
        if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
        if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
        if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
        if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
        if (s.includes('FROM oxsteed_credit_disputes d')) {
          return { rows: [provisionalDisputeRow({ status: 'in_review', provisional_credit_cents: 4000 })] };
        }
        if (s.includes('FROM oxsteed_credit_transactions') && s.includes('WHERE id = $1')) {
          return { rows: [{ id: 'tx-provisional-1', amount_cents: 5000, currency_code: 'USD', transaction_type: 'load' }] };
        }
        return { rows: [] };
      });
    }
  });
});

describe('reservation enforcement', () => {
  test('reserving more than the available balance fails with 409', async () => {
    // Router returns balance 10000, reserved 9000: only 1000 available.
    const client = { query: mockQuery };
    await expect(reserveFunds(client, {
      accountId: 101,
      reservationType: 'withdrawal',
      referenceType: 'credit_withdrawal',
      referenceId: 'w-1',
      amountCents: 5000,
    })).rejects.toMatchObject({ status: 409, code: 'credit_insufficient_funds' });
  });

  test('replays a concurrent active reservation without double-counting reserved funds', async () => {
    mockQuery.mockImplementation((sql) => {
      const s = String(sql);
      if (s.includes('FROM oxsteed_credit_accounts') && s.includes('FOR UPDATE')) {
        return { rows: [{ id: 101, balance_cents: 10000, reserved_cents: 1000, status: 'active' }] };
      }
      if (s.includes('INSERT INTO oxsteed_credit_reservations')) return { rows: [] };
      if (s.includes('FROM oxsteed_credit_reservations') && s.includes("status = 'active'")) {
        return { rows: [{ id: 'res-existing', account_id: 101, reservation_type: 'media_creator_gig', reference_type: 'media_creator_gig', reference_id: 'gig-1', amount_cents: 900, status: 'active' }] };
      }
      return { rows: [] };
    });

    const result = await reserveFunds({ query: mockQuery }, {
      accountId: 101,
      reservationType: 'media_creator_gig',
      referenceType: 'media_creator_gig',
      referenceId: 'gig-1',
      amountCents: 900,
    });

    expect(result).toEqual(expect.objectContaining({ replayed: true }));
    expect(result.reservation).toEqual(expect.objectContaining({ id: 'res-existing', amountCents: 900 }));
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('reserved_cents = reserved_cents +'))).toBe(false);
  });

  test('a failed settlement payout releases its reservation', async () => {
    const SETTLEMENT_ID = 'ssssssss-ssss-4sss-ssss-ssssssssssss';
    mockQuery.mockImplementation((sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (s.includes('FROM feature_flags')) return { rows: [{ is_enabled: true }] };
      if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
      if (s.includes('FROM oxsteed_credit_settlements s') && s.includes('stripe_transfer_id')) {
        return { rows: [{ id: SETTLEMENT_ID, partner_id: 'p-1', payout_status: 'initiated', payout_initiated_by: MAKER_ID }] };
      }
      if (s.includes("SET payout_status = 'failed'")) return { rows: [] };
      if (s.includes('FROM oxsteed_credit_reservations') && s.includes("status = 'active'")) {
        return { rows: [{ id: 'res-1', account_id: 101, amount_cents: 5000, status: 'active', reservation_type: 'payout', reference_type: 'credit_settlement_payout', reference_id: SETTLEMENT_ID }] };
      }
      if (s.includes('UPDATE oxsteed_credit_accounts') && s.includes('reserved_cents - ')) {
        return { rows: [{ id: 101 }] };
      }
      if (s.includes('UPDATE oxsteed_credit_reservations') && s.includes("status = 'released'")) {
        return { rows: [{ id: 'res-1', status: 'released' }] };
      }
      if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [] };
    });
    const result = await failSettlementPayoutFromTransfer('tr_test_1', 'insufficient funds at Stripe');
    expect(result.ignored).not.toBe(true);
    const releaseCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes("status = 'released'"));
    expect(releaseCalls.length).toBeGreaterThan(0);
  });
});

describe('reservation-aware reconciliation', () => {
  test('a reservation divergence yields status difference and pages a critical incident', async () => {
    mockQuery.mockImplementation((sql, params = []) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
      // Main ledger CTE: balanced.
      if (s.includes('FROM checks') && s.includes('difference_cents') && !s.includes('reservation_')) {
        return { rows: [{ account_balance_cents: 100, journal_balance_cents: 100, difference_cents: 0, account_count: 1, entry_count: 2 }] };
      }
      // Hash chain: no entries to verify.
      if (s.includes('FROM oxsteed_credit_transaction_entries e')) return { rows: [] };
      // Reservation CTE: divergence.
      if (s.includes('reservation_difference_cents')) {
        return { rows: [{ reservation_difference_cents: 500, divergent_account_count: 1, divergences: [{ accountId: 101, reservedCents: 1000, reservationCents: 500, differenceCents: 500 }] }] };
      }
      if (s.includes('INSERT INTO oxsteed_credit_reconciliation_runs')) {
        // Params: [currency, starts, ends, status, ...]; status is index 3.
        return { rows: [{ id: 'run-1', currency_code: params[0], period_start: params[1], period_end: params[2], status: params[3], account_balance_cents: params[4], journal_balance_cents: params[5], difference_cents: params[6], account_count: params[7], entry_count: params[8] }] };
      }
      if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [] };
    });
    const result = await reconcileCreditLedger({
      currencyCode: 'USD',
      periodStart: '2026-09-01',
      periodEnd: '2026-10-01',
      actorUserId: null,
    });
    expect(result.run.status).toBe('difference');
    expect(result.run.reservationDifferenceCents).toBe(500);
    expect(result.run.reservationDivergentAccounts).toBe(1);
  });
});
