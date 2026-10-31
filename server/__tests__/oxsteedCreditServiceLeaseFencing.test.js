'use strict';

/**
 * Q1 — service-layer lease fencing.
 *
 * Worker jobs fence their own writes, but the shared money services
 * (createSettlement, createAgreement, transitionAgreement) used to route
 * every write through withTransaction(pool, ...) with a raw client. A
 * worker that lost its lease mid-run could therefore still commit a
 * settlement or agreement record a second time after failover.
 *
 * The contract: when a fence is supplied, every statement of the service
 * transaction goes through the fence, so a write after lease loss is
 * refused with LeaseLostError and rolled back instead of committed.
 * Without a fence (the admin HTTP path) behavior is unchanged.
 */

const { mockQuery } = require('./setup');
const { createFence } = require('../jobs/jobLockingService');
const {
  createSettlement,
  createAgreement,
  transitionAgreement,
} = require('../services/oxsteedCreditAdminService');

const AGREEMENT_ROW = {
  id: 'agreement-1',
  partner_id: 41,
  status: 'active',
  partner_status: 'active',
  restaurant_id: 9,
  restaurant_name: 'OxSteed Cafe',
  settlement_currency_code: 'USD',
  starts_at: '2026-09-01T00:00:00.000Z',
  ends_at: null,
};

const SETTLEMENT_ROW = {
  id: 'settlement-1',
  partner_id: 41,
  agreement_id: 'agreement-1',
  currency_code: 'USD',
  period_start: '2026-09-01T00:00:00.000Z',
  period_end: '2026-10-01T00:00:00.000Z',
  gross_cents: '2500',
  refund_cents: '0',
  fee_cents: '0',
  net_cents: '2500',
  status: 'pending',
  payment_reference: null,
  metadata: {},
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
};

function settlementArgs(overrides = {}) {
  return {
    partnerId: 41,
    agreementId: 'agreement-1',
    periodStart: '2026-09-01T00:00:00.000Z',
    periodEnd: '2026-10-01T00:00:00.000Z',
    idempotencyKey: 'settlement-fence-1',
    reason: 'Month-end partner settlement review',
    actorUserId: 'admin-1',
    settlementTotals: { grossCents: 2500, refundCents: 0, feeCents: 0 },
    ...overrides,
  };
}

function callsContaining(fragment) {
  return mockQuery.mock.calls.filter(([sql]) => String(sql).includes(fragment));
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('Q1 service-layer lease fencing', () => {
  test('createSettlement refuses the money write when the lease is lost mid-transaction', async () => {
    const fence = createFence('service-fence-test', 'lock-value-1');
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM cron_job_locks WHERE lock_id')) return { rows: [{ '1': 1 }] };
      if (sql.includes('FROM oxsteed_credit_partner_agreements a') && sql.includes('a.id = $1')) {
        return { rows: [AGREEMENT_ROW] };
      }
      if (sql.includes('pg_advisory_xact_lock')) {
        // The renewal loop observes the lost lease after the transaction
        // began but before the money write. This is the mid-transaction
        // simulation: every later statement must be refused.
        fence._onLeaseLost();
        return { rows: [] };
      }
      if (sql.includes('s.idempotency_key')) return { rows: [] };
      if (sql.includes('period_start < $4')) return { rows: [] };
      if (sql.includes('INSERT INTO oxsteed_credit_settlements')) return { rows: [SETTLEMENT_ROW] };
      if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [] };
    });

    await expect(createSettlement(settlementArgs({ fence })))
      .rejects.toMatchObject({ name: 'LeaseLostError', code: 'LEASE_LOST' });

    // The refused write must never reach the database.
    expect(callsContaining('INSERT INTO oxsteed_credit_settlements')).toHaveLength(0);
    expect(callsContaining('INSERT INTO oxsteed_credit_audit_events')).toHaveLength(0);
    // The partial transaction is rolled back, never committed.
    expect(callsContaining('ROLLBACK')).toHaveLength(1);
    expect(callsContaining('COMMIT')).toHaveLength(0);
  });

  test('createSettlement refuses before any write when the lease is already lost', async () => {
    const fence = createFence('service-fence-test', 'lock-value-1');
    fence._onLeaseLost(); // the renewal loop observed the loss before the call
    mockQuery.mockImplementation(async () => ({ rows: [] }));

    await expect(createSettlement(settlementArgs({ fence })))
      .rejects.toMatchObject({ name: 'LeaseLostError', code: 'LEASE_LOST' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('createSettlement refuses when the lease row is gone at transaction start', async () => {
    const fence = createFence('service-fence-test', 'lock-value-1');
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      // The lease row was taken over: in-transaction verification fails.
      if (sql.includes('FROM cron_job_locks WHERE lock_id')) return { rows: [] };
      if (sql.includes('FROM oxsteed_credit_partner_agreements a')) return { rows: [AGREEMENT_ROW] };
      return { rows: [] };
    });

    await expect(createSettlement(settlementArgs({ fence })))
      .rejects.toMatchObject({ name: 'LeaseLostError', code: 'LEASE_LOST' });
    expect(callsContaining('INSERT INTO oxsteed_credit_settlements')).toHaveLength(0);
    expect(callsContaining('ROLLBACK')).toHaveLength(1);
    expect(callsContaining('COMMIT')).toHaveLength(0);
  });

  test('createAgreement refuses the agreement write after lease loss', async () => {
    const fence = createFence('service-fence-test', 'lock-value-1');
    fence._onLeaseLost();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('creation_idempotency_key')) return { rows: [] };
      if (sql.includes('FROM oxsteed_credit_partners WHERE id')) {
        return { rows: [{ id: 41, status: 'active' }] };
      }
      if (sql.includes('MAX(version)')) return { rows: [{ next_version: 1 }] };
      if (sql.includes('INSERT INTO oxsteed_credit_partner_agreements')) {
        return { rows: [{ id: 'agreement-1', partner_id: 41 }] };
      }
      return { rows: [] };
    });

    await expect(createAgreement({
      partnerId: 41,
      startsAt: '2026-09-12T00:00:00.000Z',
      reason: 'Agreement review',
      idempotencyKey: 'credit-agreement-fence-1',
      actorUserId: 'admin-1',
      fence,
    })).rejects.toMatchObject({ name: 'LeaseLostError', code: 'LEASE_LOST' });
    expect(callsContaining('INSERT INTO oxsteed_credit_partner_agreements')).toHaveLength(0);
  });

  test('transitionAgreement refuses the status write after lease loss', async () => {
    const fence = createFence('service-fence-test', 'lock-value-1');
    fence._onLeaseLost();
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_partner_agreements a')) {
        return {
          rows: [{
            id: 'agreement-1',
            partner_id: 41,
            partner_status: 'active',
            restaurant_id: 9,
            restaurant_name: 'OxSteed Cafe',
            status: 'draft',
          }],
        };
      }
      if (sql.includes('UPDATE oxsteed_credit_partner_agreements')) {
        return { rows: [{ id: 'agreement-1', status: 'pending_approval' }] };
      }
      return { rows: [] };
    });

    await expect(transitionAgreement({
      agreementId: 'agreement-1',
      targetStatus: 'pending_approval',
      expectedStatus: 'draft',
      reason: 'Submitted for approval',
      actorUserId: 'admin-1',
      fence,
    })).rejects.toMatchObject({ name: 'LeaseLostError', code: 'LEASE_LOST' });
    expect(callsContaining('UPDATE oxsteed_credit_partner_agreements')).toHaveLength(0);
  });

  test('createSettlement without a fence still commits (admin path unchanged)', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM oxsteed_credit_partner_agreements a') && sql.includes('a.id = $1')) {
        return { rows: [AGREEMENT_ROW] };
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('s.idempotency_key')) return { rows: [] };
      if (sql.includes('period_start < $4')) return { rows: [] };
      if (sql.includes('INSERT INTO oxsteed_credit_settlements')) return { rows: [SETTLEMENT_ROW] };
      if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [] };
      return { rows: [] };
    });

    const result = await createSettlement(settlementArgs());
    expect(result.settlement.id).toBe('settlement-1');
    expect(result.replayed).toBe(false);
    expect(callsContaining('INSERT INTO oxsteed_credit_settlements')).toHaveLength(1);
    expect(callsContaining('ROLLBACK')).toHaveLength(0);
  });
});
