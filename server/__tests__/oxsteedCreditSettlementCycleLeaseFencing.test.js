'use strict';

/**
 * E03 gap — the settlement-cycle job's own writes bypass the lease fence.
 *
 * Failing reproduction: `runOxsteedCreditSettlementCycle` runs inside
 * `withFencedJobLock`, but `runCycle` and `checkReserveLevels` issue their
 * writes (cycle-row INSERT, cycle status UPDATEs, funding-requirement
 * INSERT) through `pool.query` directly. A worker that loses its lease
 * mid-run keeps writing — the fence never sees those statements, so a
 * stale worker can corrupt state after another worker took over the job.
 *
 * The contract (from jobLockingService): the job's writes must go through
 * `fence.db.query` so they are refused with LeaseLostError once the lease
 * is lost, and the handler reports { fenced: true } instead of crashing.
 */

const { Pool } = require('pg');
const mockQuery = Pool.mockQuery;

const mockFenceHolder = { fence: null };
jest.mock('../jobs/jobLockingService', () => {
  const actual = jest.requireActual('../jobs/jobLockingService');
  return {
    ...actual,
    withFencedJobLock: jest.fn((jobName, handler, ttl, opts) =>
      actual.withFencedJobLock(jobName, async (fence) => {
        mockFenceHolder.fence = fence;
        return handler(fence);
      }, ttl, opts)),
  };
});

const { createFence } = require('../jobs/jobLockingService');
const {
  runOxsteedCreditSettlementCycle,
  checkReserveLevels,
} = require('../jobs/oxsteedCreditSettlementCycle');

function cycleRow(overrides = {}) {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    cycle_type: 'daily',
    period_start: new Date('2026-09-30T00:00:00Z'),
    period_end: new Date('2026-10-01T00:00:00Z'),
    cutoff_at: new Date('2026-09-30T00:00:00Z'),
    value_date: '2026-10-01',
    settlement_date: '2026-10-01',
    status: 'scheduled',
    metadata: {},
    created_at: new Date('2026-10-01T00:05:00Z'),
    updated_at: new Date('2026-10-01T00:05:00Z'),
    ...overrides,
  };
}

function writeStatements() {
  return mockQuery.mock.calls
    .map(([sql]) => String(sql))
    .filter((sql) =>
      sql.includes('INSERT INTO oxsteed_credit_settlement_cycles')
      || sql.includes('UPDATE oxsteed_credit_settlement_cycles')
      || sql.includes('INSERT INTO oxsteed_credit_reserve_funding_requirements'));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockFenceHolder.fence = null;
});

describe('settlement cycle lease fencing (E03 gap)', () => {
  test('checkReserveLevels refuses the funding-requirement write after lease loss', async () => {
    mockQuery.mockImplementation(async (text, params = []) => {
      const sql = String(text);
      if (sql.includes("account_type = 'partner_reserve'") && params.length === 0) {
        return { rows: [{ partner_id: 41, currency_code: 'USD', balance_cents: 100000 }] };
      }
      if (sql.includes('FROM oxsteed_credit_reserve_policies')) {
        return { rows: [{ id: 1, partner_id: null, currency_code: 'USD', ratio_bps: 1000, floor_cents: 50000, is_default: true }] };
      }
      if (sql.includes('SELECT balance_cents') && sql.includes('FROM oxsteed_credit_accounts') && params.length === 3) {
        const [accountType] = params;
        // Below the 50000 floor: the monitor must open a funding requirement.
        if (accountType === 'partner_reserve') return { rows: [{ balance_cents: 1000 }] };
        return { rows: [{ balance_cents: 0 }] };
      }
      if (sql.includes('INSERT INTO incident_log')) return { rows: [{ id: 99 }] };
      if (sql.includes('INSERT INTO oxsteed_credit_reserve_funding_requirements')) {
        return { rows: [{ id: 7 }] };
      }
      return { rows: [] };
    });

    const fence = createFence('settlement-cycle-test', 'lock-value');
    fence._onLeaseLost(); // the renewal loop observed a lost lease

    await checkReserveLevels({ fence });

    const fundingWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO oxsteed_credit_reserve_funding_requirements'));
    // The refused write must never reach the database.
    expect(fundingWrites).toHaveLength(0);
  });

  test('a lease lost mid-run refuses the cycle-completion write', async () => {
    mockQuery.mockImplementation(async (text, params = []) => {
      const sql = String(text);
      if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
        return { rows: [{ is_enabled: true }] };
      }
      if (sql.includes('INSERT INTO cron_job_locks')) return { rows: [{ lock_id: 'job_lock:x' }] };
      if (sql.includes('DELETE FROM cron_job_locks')) return { rows: [] };
      if (sql.includes('INSERT INTO oxsteed_credit_settlement_cycles')) {
        return { rows: [cycleRow()] };
      }
      if (sql.includes('UPDATE oxsteed_credit_settlement_cycles') && sql.includes("'processing'")) {
        // The renewal loop observes the lost lease right after the first write.
        mockFenceHolder.fence._onLeaseLost();
        return { rows: [cycleRow({ status: 'processing' })] };
      }
      if (sql.includes('UPDATE oxsteed_credit_settlement_cycles')) {
        return { rows: [cycleRow({ status: 'completed' })] };
      }
      if (sql.includes('SELECT DISTINCT t.partner_id, t.currency_code')) return { rows: [] };
      if (sql.includes('INSERT INTO oxsteed_credit_worker_heartbeats')) return { rows: [{}] };
      return { rows: [] };
    });

    await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z'), runReserveMonitor: false });

    const completionWrites = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE oxsteed_credit_settlement_cycles')
      && !String(sql).includes("'processing'"));
    // The completion write happened after lease loss: it must be refused.
    expect(completionWrites).toHaveLength(0);
  });
});
