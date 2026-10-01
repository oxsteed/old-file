'use strict';

/**
 * OxSteed Credit Phase 8 (hardening & cleanup) tests.
 *
 * (a) Top-up expiry sweeper: expires only past-due pending rows, never
 *     touches completed/requires_attention rows (the batch SELECT filters
 *     them), idempotent reruns, fails closed when the rail is suspended,
 *     and records a critical incident when Stripe already succeeded for an
 *     expired row (the row still expires; the incident gives ops the trail).
 * (b) Webhook expires_at guard: a late payment_intent.succeeded event for an
 *     expired pending top-up fails the row and never posts the journal.
 * (c) Reserve policy admin editing: route-level validation rejects bad
 *     ratio/floor/currency/partner input with 400 before queueing; the
 *     change queues via maker-checker (no execution on request), the maker
 *     cannot self-approve (403), and the checker executes exactly once.
 * (d) Stripe chargeback ingestion: charge.dispute.created opens a linked
 *     system dispute (idempotency key on the Stripe dispute id, so
 *     redelivery is a no-op); closed+lost resolves in the customer's favor
 *     with compensating entries that never edit the original journal rows;
 *     closed+won resolves in the merchant's favor with no money movement;
 *     non-credit disputes are ignored even when the rail is frozen.
 * (e) Journal status regression: migration 641 narrows the journal status
 *     CHECK to ('posted') and the admin read-model filter keeps only the
 *     states that can ever be written.
 */

const fs = require('fs');
const path = require('path');
const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/stepupChallengeService', () => {
  const actual = jest.requireActual('../services/stepupChallengeService');
  return { ...actual, verifyStepupChallenge: jest.fn().mockResolvedValue({ verified: true }) };
});
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn().mockResolvedValue({ id: 'incident-1' }),
}));
jest.mock('../services/oxsteedCreditReserveService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditReserveService');
  return { ...actual, upsertReservePolicy: jest.fn() };
});
// The dispute service destructures these at require time, so they must be
// mocked at module level; requireActual keeps every other export (including
// openSystemCreditDispute and assertCreditRailEnabled) real.
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return {
    ...actual,
    adjustCustomerCreditInTransaction: jest.fn(),
    refundCreditInTransaction: jest.fn(),
  };
});

const topupService = require('../services/oxsteedCreditTopupService');
const { validateReservePolicyInput } = require('../services/oxsteedCreditReserveService');
const reserveService = require('../services/oxsteedCreditReserveService');
const { requestPendingAction, decidePendingAction } = require('../services/oxsteedCreditPendingActionService');
const { ingestStripeChargeback } = require('../services/oxsteedCreditChargebackService');
const creditService = require('../services/oxsteedCreditService');
const { recordIncident } = require('../services/incidentStore');
const { CREDIT_TRANSACTION_STATUSES } = require('../services/oxsteedCreditAdminService');

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const MAKER_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const CHECKER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const ACTION_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

// ── Mutable router state ────────────────────────────────────────────────
let railEnabled;
let sweepRows;
let topupByIntentRow;
let linkedTopupRow;
let disputeIdempotencyRow;
let disputeOpenRow;
let disputeByIdStatus;
let journalTxRow;
let pendingActionRow;
let pendingActionDecidedStatus;
const insertedDisputes = [];

function expiredTopupRow(id, intentId, overrides = {}) {
  return {
    id,
    customer_id: CUSTOMER_ID,
    account_id: null,
    amount_cents: 5000,
    currency_code: 'USD',
    status: 'pending',
    stripe_payment_intent_id: intentId,
    idempotency_key: `idem-${id}`,
    journal_transaction_id: null,
    expires_at: '2026-09-30T12:00:00.000Z',
    created_at: '2026-09-30T11:30:00.000Z',
    updated_at: '2026-09-30T11:30:00.000Z',
    ...overrides,
  };
}

function disputeRow(overrides = {}) {
  return {
    id: 'd-cb-1',
    transaction_id: 'tx-cb-1',
    customer_id: CUSTOMER_ID,
    partner_id: null,
    restaurant_name: null,
    status: 'open',
    reason_code: 'chargeback',
    description: 'Stripe chargeback dp_1 (fraudulent) for 5000 cents',
    dispute_type: 'chargeback',
    resolution: null,
    resolution_entries: {},
    opened_by: null,
    resolved_by: null,
    idempotency_key: 'credit-dispute-chargeback:dp_1',
    sla_due_at: '2026-10-03T12:00:00.000Z',
    ...overrides,
  };
}

function installRouter() {
  mockQuery.mockImplementation((sql, params = []) => {
    const s = String(sql);
    if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [] };
    if (s.startsWith('SAVEPOINT') || s.startsWith('RELEASE SAVEPOINT') || s.startsWith('ROLLBACK TO SAVEPOINT')) {
      return { rows: [] };
    }
    // Rail gate.
    if (s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
      return { rows: railEnabled ? [{ is_enabled: true }] : [{ is_enabled: false }] };
    }
    if (s.includes('FROM oxsteed_credit_rail_freezes')) return { rows: [] };
    // (a) Sweeper batch: only past-due pending rows are ever selected.
    if (s.includes('FROM oxsteed_credit_topups') && s.includes('expires_at <= NOW()')) {
      return { rows: sweepRows };
    }
    // (b) Webhook completion lookup.
    if (s.includes('FROM oxsteed_credit_topups WHERE stripe_payment_intent_id = $1 FOR UPDATE')) {
      return { rows: topupByIntentRow ? [topupByIntentRow] : [] };
    }
    // (d) Chargeback top-up lookup by PaymentIntent.
    if (s.includes('FROM oxsteed_credit_topups') && s.includes('stripe_payment_intent_id = $1')) {
      return { rows: linkedTopupRow ? [linkedTopupRow] : [] };
    }
    // Expire/update a top-up row.
    if (s.includes('UPDATE oxsteed_credit_topups')) {
      const row = (sweepRows.find((r) => String(r.id) === String(params[0])))
        || (topupByIntentRow && String(topupByIntentRow.id) === String(params[0]) ? topupByIntentRow : null);
      if (!row) return { rows: [] };
      row.status = 'failed';
      return { rows: [{ ...row }] };
    }
    // Audit events.
    if (s.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
    // (d) Dispute lookups.
    if (s.includes('WHERE d.idempotency_key = $1') && s.includes('FOR UPDATE')) {
      return { rows: disputeIdempotencyRow ? [disputeIdempotencyRow] : [] };
    }
    if (s.includes("d.status IN ('open', 'in_review')") && s.includes('WHERE d.transaction_id = $1')) {
      return { rows: disputeOpenRow ? [disputeOpenRow] : [] };
    }
    if (s.includes('INSERT INTO oxsteed_credit_disputes')) {
      const row = disputeRow({
        id: 'd-cb-1',
        transaction_id: params[0],
        customer_id: params[1],
        partner_id: params[2],
        reason_code: params[3],
        description: params[4],
        idempotency_key: params[5],
        dispute_type: params[6],
        status: 'open',
      });
      insertedDisputes.push(row);
      disputeIdempotencyRow = row;
      disputeByIdStatus = 'open';
      return { rows: [row] };
    }
    if (s.includes('WHERE d.id = $1') && s.includes('FOR UPDATE')) {
      return { rows: [disputeRow({ status: disputeByIdStatus })] };
    }
    if (s.includes('UPDATE oxsteed_credit_disputes')) {
      disputeByIdStatus = params[0];
      return { rows: [disputeRow({ status: params[0] })] };
    }
    // Journal transaction lookups.
    if (s.includes('FROM oxsteed_credit_transactions') && s.includes("status = 'posted'") && s.includes('FOR SHARE')) {
      return { rows: journalTxRow ? [journalTxRow] : [] };
    }
    if (s.includes('FROM oxsteed_credit_transactions') && s.includes('idempotency_key = $1')) {
      return { rows: [] };
    }
    if (s.includes('FROM oxsteed_credit_transactions') && s.includes('WHERE id = $1')) {
      return { rows: journalTxRow ? [journalTxRow] : [] };
    }
    // (c) Pending actions.
    if (s.includes('INSERT INTO oxsteed_credit_pending_actions')) {
      return { rows: [pendingActionRow] };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1 FOR UPDATE')) {
      return { rows: [{ ...pendingActionRow, status: pendingActionDecidedStatus }] };
    }
    if (s.includes('UPDATE oxsteed_credit_pending_actions')) {
      const status = s.includes("status = 'approved'") ? 'approved'
        : s.includes("status = 'rejected'") ? 'rejected'
        : s.includes("status = 'expired'") ? 'expired' : 'pending';
      pendingActionDecidedStatus = status;
      return { rows: [{ ...pendingActionRow, status, decided_by: CHECKER_ID, execution_refs: { reservePolicy: { id: '9' } } }] };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions WHERE id = $1')) {
      return { rows: [{ ...pendingActionRow, status: pendingActionDecidedStatus }] };
    }
    return { rows: [] };
  });
}

function makeSweepStripe(retrieveStatus = 'requires_payment_method') {
  return {
    paymentIntents: {
      retrieve: jest.fn().mockResolvedValue({ id: 'pi_x', status: retrieveStatus }),
      cancel: jest.fn().mockResolvedValue({ id: 'pi_x', status: 'canceled' }),
    },
  };
}

function resetPhase8State() {
  railEnabled = true;
  sweepRows = [];
  topupByIntentRow = null;
  linkedTopupRow = null;
  disputeIdempotencyRow = null;
  disputeOpenRow = null;
  disputeByIdStatus = 'open';
  journalTxRow = null;
  pendingActionRow = null;
  pendingActionDecidedStatus = 'pending';
  insertedDisputes.length = 0;
  recordIncident.mockClear();
  creditService.adjustCustomerCreditInTransaction.mockReset();
  creditService.refundCreditInTransaction.mockReset();
  reserveService.upsertReservePolicy.mockReset();
  reserveService.upsertReservePolicy.mockResolvedValue({
    id: '9', partnerId: null, currencyCode: 'USD', ratioBps: 1500, floorCents: 60000, isDefault: true,
  });
  installRouter();
}

beforeEach(() => {
  resetMocks();
  resetPhase8State();
});

function updateTopupCalls() {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).includes('UPDATE oxsteed_credit_topups'));
}

function auditActionTypes() {
  return mockQuery.mock.calls
    .filter(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_audit_events'))
    .map(([sql]) => {
      const match = String(sql).match(/VALUES\s*\(\s*'([^']+)'/);
      return match ? match[1] : null;
    });
}
// ── (a) Top-up expiry sweeper ────────────────────────────────────────────
describe('expireCreditTopups', () => {
  test('expires only past-due pending top-ups and cancels their Stripe intents', async () => {
    // The batch SELECT filters to status=pending AND expires_at <= NOW():
    // a completed row and a requires_attention row can never be in the batch.
    sweepRows = [expiredTopupRow('t-1', 'pi_1'), expiredTopupRow('t-2', 'pi_2')];
    const fakeStripe = makeSweepStripe('requires_payment_method');

    const result = await topupService.expireCreditTopups({ limit: 50, getStripe: () => fakeStripe, actorUserId: ADMIN_ID });

    expect(result.count).toBe(2);
    expect(result.failedCount).toBe(0);
    expect(result.expired.map((e) => e.id).sort()).toEqual(['t-1', 't-2']);
    expect(result.expired.every((e) => e.stripeCancelOutcome === 'canceled')).toBe(true);
    expect(fakeStripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_1');
    expect(fakeStripe.paymentIntents.cancel).toHaveBeenCalledWith('pi_2');
    expect(updateTopupCalls()).toHaveLength(2);
    expect(auditActionTypes().filter((a) => a === 'credit.topup.expired')).toHaveLength(2);
    // The SELECT is the only row source: completed/requires_attention rows
    // are never selected, so they are never updated.
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('requires_attention'), expect.anything());
  });

  test('a rerun after expiry finds nothing (idempotent)', async () => {
    sweepRows = [expiredTopupRow('t-1', 'pi_1')];
    const fakeStripe = makeSweepStripe();
    const first = await topupService.expireCreditTopups({ getStripe: () => fakeStripe });
    expect(first.count).toBe(1);
    expect(updateTopupCalls()).toHaveLength(1);

    sweepRows = [];
    const second = await topupService.expireCreditTopups({ getStripe: () => fakeStripe });
    expect(second.count).toBe(0);
    expect(updateTopupCalls()).toHaveLength(1);
  });

  test('a Stripe intent that already succeeded still expires the row and pages a critical incident', async () => {
    sweepRows = [expiredTopupRow('t-3', 'pi_3')];
    const fakeStripe = makeSweepStripe('succeeded');

    const result = await topupService.expireCreditTopups({ getStripe: () => fakeStripe });

    expect(result.count).toBe(1);
    expect(result.expired[0].stripeCancelOutcome).toBe('already_succeeded');
    // Never silently expired: the row fails and ops gets a critical incident.
    expect(updateTopupCalls()).toHaveLength(1);
    expect(recordIncident).toHaveBeenCalledTimes(1);
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'oxsteed_credit_topup_paid_but_expired',
      severity: 'critical',
      dedupeKey: 'credit-topup-paid-expired:t-3',
    }));
  });

  test('a Stripe failure is best-effort: the row still expires', async () => {
    sweepRows = [expiredTopupRow('t-4', 'pi_4')];
    const fakeStripe = {
      paymentIntents: {
        retrieve: jest.fn().mockRejectedValue(new Error('stripe down')),
        cancel: jest.fn(),
      },
    };

    const result = await topupService.expireCreditTopups({ getStripe: () => fakeStripe });

    expect(result.count).toBe(1);
    expect(result.expired[0].stripeCancelOutcome).toBe('failed');
    expect(updateTopupCalls()).toHaveLength(1);
  });

  test('fails closed when the credit rail is suspended', async () => {
    railEnabled = false;
    await expect(topupService.expireCreditTopups({ getStripe: makeSweepStripe }))
      .rejects.toMatchObject({ code: 'credit_rail_suspended', statusCode: 503 });
    expect(updateTopupCalls()).toHaveLength(0);
  });
});

// ── (b) Webhook expires_at guard ─────────────────────────────────────────
describe('completeCreditTopupFromWebhook expiry guard', () => {
  test('an expired pending top-up fails instead of completing', async () => {
    topupByIntentRow = expiredTopupRow('t-9', 'pi_expired');

    const result = await topupService.completeCreditTopupFromWebhook({ paymentIntentId: 'pi_expired' });

    expect(result).toMatchObject({ outcome: 'expired', topupId: 't-9' });
    expect(updateTopupCalls()).toHaveLength(1);
    expect(auditActionTypes()).toContain('credit.topup.expired_at_webhook');
    // The late completion never posts a journal entry.
    const journalInserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO oxsteed_credit_transactions'));
    expect(journalInserts).toHaveLength(0);
  });
});

// ── (c) Reserve policy admin editing ─────────────────────────────────────
describe('reserve policy validation', () => {
  test.each([
    ['ratio above 10000 bps', { currencyCode: 'USD', ratioBps: 10001, floorCents: 0 }, 'credit_reserve_ratio_invalid'],
    ['negative ratio', { currencyCode: 'USD', ratioBps: -1, floorCents: 0 }, 'credit_reserve_ratio_invalid'],
    ['negative floor', { currencyCode: 'USD', ratioBps: 1000, floorCents: -50 }, 'credit_reserve_floor_invalid'],
    ['bad currency', { currencyCode: 'XX', ratioBps: 1000, floorCents: 0 }, 'credit_reserve_currency_invalid'],
    ['non-numeric partner', { partnerId: 'abc', currencyCode: 'USD', ratioBps: 1000, floorCents: 0 }, 'credit_reserve_partner_invalid'],
  ])('rejects %s with 400 before anything is queued', (_label, input, code) => {
    expect(() => validateReservePolicyInput(input)).toThrow(expect.objectContaining({ code, statusCode: 400 }));
  });

  test('accepts a default policy and normalizes the currency', () => {
    expect(validateReservePolicyInput({
      partnerId: null, currencyCode: 'usd', ratioBps: 1500, floorCents: 60000,
    })).toEqual({ partnerId: null, currencyCode: 'USD', ratioBps: 1500, floorCents: 60000 });
  });
});

describe('reserve policy maker-checker', () => {
  function reservePendingRow() {
    pendingActionRow = {
      id: ACTION_ID,
      action_type: 'credit_reserve_policy_update',
      payload: { partnerId: null, currencyCode: 'USD', ratioBps: 1500, floorCents: 60000 },
      requested_by: MAKER_ID,
      requested_at: '2026-10-01T10:00:00.000Z',
      status: 'pending',
      decided_by: null,
      decided_at: null,
      decision_reason: null,
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      idempotency_key: 'k-reserve-1',
      execution_refs: {},
    };
    pendingActionDecidedStatus = 'pending';
  }

  beforeEach(() => { reservePendingRow(); });

  test('requesting queues the change without executing it', async () => {
    const result = await requestPendingAction({
      actionType: 'credit_reserve_policy_update',
      payload: { partnerId: null, currencyCode: 'USD', ratioBps: 1500, floorCents: 60000 },
      requestedBy: MAKER_ID,
      idempotencyKey: 'k-reserve-1',
    });
    expect(result.executed).toBe(false);
    expect(result.pendingAction.status).toBe('pending');
    expect(reserveService.upsertReservePolicy).not.toHaveBeenCalled();
  });

  test('the maker cannot approve their own change (403)', async () => {
    await expect(decidePendingAction({
      actionId: ACTION_ID, decidedBy: MAKER_ID, decision: 'approve',
      stepupChallengeId: 'challenge-1', stepupCode: '123456',
    })).rejects.toMatchObject({ status: 403, code: 'credit_self_approval_forbidden' });
    expect(reserveService.upsertReservePolicy).not.toHaveBeenCalled();
  });

  test('the checker executes exactly once; a second approval replays stored refs', async () => {
    const first = await decidePendingAction({
      actionId: ACTION_ID, decidedBy: CHECKER_ID, decision: 'approve',
      stepupChallengeId: 'challenge-1', stepupCode: '123456',
    });
    expect(first.replayed).toBe(false);
    expect(reserveService.upsertReservePolicy).toHaveBeenCalledTimes(1);
    expect(reserveService.upsertReservePolicy).toHaveBeenCalledWith(expect.anything(), {
      partnerId: null, currencyCode: 'USD', ratioBps: 1500, floorCents: 60000,
    });
    expect(first.pendingAction.status).toBe('approved');

    const second = await decidePendingAction({
      actionId: ACTION_ID, decidedBy: CHECKER_ID, decision: 'approve',
      stepupChallengeId: 'challenge-1', stepupCode: '123456',
    });
    expect(second.replayed).toBe(true);
    expect(reserveService.upsertReservePolicy).toHaveBeenCalledTimes(1);
  });
});
// ── (d) Stripe chargeback ingestion ──────────────────────────────────────
describe('ingestStripeChargeback', () => {
  function linkChargebackTopup() {
    linkedTopupRow = {
      id: 'topup-cb-1',
      customer_id: CUSTOMER_ID,
      journal_transaction_id: 'tx-cb-1',
      stripe_payment_intent_id: 'pi_cb_1',
      amount_cents: 5000,
      currency_code: 'USD',
      status: 'completed',
    };
    journalTxRow = {
      id: 'tx-cb-1',
      partner_id: null,
      amount_cents: 5000,
      currency_code: 'USD',
      transaction_type: 'load',
      status: 'posted',
    };
  }

  const stripeDispute = (overrides = {}) => ({
    id: 'dp_1',
    status: 'needs_response',
    amount: 5000,
    reason: 'fraudulent',
    payment_intent: 'pi_cb_1',
    ...overrides,
  });

  function disputeInsertCalls() {
    return mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO oxsteed_credit_disputes'));
  }

  function journalWriteCalls() {
    return mockQuery.mock.calls.filter(([sql]) => {
      const s = String(sql);
      return s.includes('UPDATE oxsteed_credit_transactions') || s.includes('INSERT INTO oxsteed_credit_transactions');
    });
  }

  test('charge.dispute.created opens a linked system dispute of type chargeback', async () => {
    linkChargebackTopup();

    const result = await ingestStripeChargeback({
      eventType: 'charge.dispute.created',
      dispute: stripeDispute(),
    });

    expect(result.outcome).toBe('opened');
    expect(insertedDisputes).toHaveLength(1);
    expect(insertedDisputes[0]).toMatchObject({
      idempotency_key: 'credit-dispute-chargeback:dp_1',
      dispute_type: 'chargeback',
      opened_by: null,
    });
    expect(result.dispute.status).toBe('open');
  });

  test('redelivery of the same dispute is a no-op (dedupe on the Stripe dispute id)', async () => {
    linkChargebackTopup();
    const first = await ingestStripeChargeback({ eventType: 'charge.dispute.created', dispute: stripeDispute() });
    expect(first.outcome).toBe('opened');
    const insertsAfterFirst = disputeInsertCalls().length;

    const second = await ingestStripeChargeback({ eventType: 'charge.dispute.created', dispute: stripeDispute() });

    expect(second.outcome).toBe('duplicate');
    expect(disputeInsertCalls()).toHaveLength(insertsAfterFirst);
    expect(recordIncident).not.toHaveBeenCalled();
  });

  test('closed+lost resolves in the customer favor with compensating entries; originals untouched', async () => {
    linkChargebackTopup();

    const result = await ingestStripeChargeback({
      eventType: 'charge.dispute.closed',
      dispute: stripeDispute({ status: 'lost' }),
    });

    expect(result.outcome).toBe('resolved_customer');
    expect(result.compensation).toMatchObject({ kind: 'adjustment', amountCents: 5000 });
    expect(creditService.adjustCustomerCreditInTransaction).toHaveBeenCalledTimes(1);
    expect(creditService.adjustCustomerCreditInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        amountCents: 5000,
        currencyCode: 'USD',
        direction: 'credit',
        actorType: 'system',
        referenceType: 'oxsteed_credit_dispute',
      })
    );
    // The original journal entries are never edited: no journal UPDATE or
    // INSERT ran; the compensation is a new append-only adjustment.
    expect(journalWriteCalls()).toHaveLength(0);
  });

  test('closed+won resolves in the merchant favor with no money movement', async () => {
    linkChargebackTopup();

    const result = await ingestStripeChargeback({
      eventType: 'charge.dispute.closed',
      dispute: stripeDispute({ status: 'won' }),
    });

    expect(result.outcome).toBe('resolved_merchant');
    expect(creditService.adjustCustomerCreditInTransaction).not.toHaveBeenCalled();
    expect(creditService.refundCreditInTransaction).not.toHaveBeenCalled();
    expect(journalWriteCalls()).toHaveLength(0);
  });

  test('an unknown closed status is logged and skipped', async () => {
    linkChargebackTopup();

    const result = await ingestStripeChargeback({
      eventType: 'charge.dispute.closed',
      dispute: stripeDispute({ status: 'warning_closed' }),
    });

    expect(result.outcome).toBe('skipped');
    expect(disputeInsertCalls()).toHaveLength(0);
  });

  test('a dispute that is not a credit top-up is ignored even when the rail is frozen', async () => {
    railEnabled = false;
    linkedTopupRow = null;

    const result = await ingestStripeChargeback({
      eventType: 'charge.dispute.created',
      dispute: stripeDispute({ payment_intent: 'pi_unknown' }),
    });

    expect(result).toEqual({ outcome: 'ignored', reason: 'not_a_credit_topup' });
    expect(disputeInsertCalls()).toHaveLength(0);
  });
});

// ── (e) Journal status CHECK regression ──────────────────────────────────
describe('journal status constraint (migration 641)', () => {
  test('the migration narrows the journal status CHECK to posted only', () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '641_oxsteed_credit_phase8_hardening.sql'),
      'utf8'
    );
    expect(migration).toContain('oxsteed_credit_transactions_status_posted_check');
    expect(migration).toMatch(/CHECK\s*\(\s*status\s+IN\s*\(\s*'posted'\s*\)\s*\)/);
  });

  test('the admin read model keeps only the states that can ever be written', () => {
    expect(CREDIT_TRANSACTION_STATUSES).toEqual(new Set(['posted']));
  });
});
