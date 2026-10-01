'use strict';

/**
 * Phase 3 tests: automated settlement cycle (gap 3) + partner reserve regime
 * (gap 4).
 *
 * Mock strategy follows the house pattern (server/__tests__/setup.js mocks
 * pg): a scripted mockQuery answers per-SQL-fragment with fixture rows,
 * keeping the cycle job, reserve monitor, and payout gate deterministic
 * without a live database. Migration SQL is loaded from disk and asserted
 * as text (CHECK/UNIQUE wording), same as the sub-bank suite.
 */

const path = require('path');
const fs = require('fs');

jest.mock('../services/reconciliationExceptions', () => ({
  recordException: jest.fn(async () => null),
}));

jest.mock('stripe', () => jest.fn(() => ({
  transfers: { create: jest.fn(async () => ({ id: 'tr_test_cycle_123' })) },
})));

const { Pool } = require('pg');
const mockQuery = Pool.mockQuery;

const {
  isWeekend,
  nextBusinessDay,
  addBusinessDays,
  startOfUtcDay,
} = require('../services/oxsteedCreditSettlementCalendar');
const {
  JOB_NAME,
  planCycles,
  parseWeeklyWeekday,
  parseWarnMultiplier,
  runOxsteedCreditSettlementCycle,
  checkReserveLevels,
} = require('../jobs/oxsteedCreditSettlementCycle');
const {
  getReserveStatus,
  assertReserveFloorForPosting,
} = require('../services/oxsteedCreditReserveService');
const { initiateSettlementPayout, CREDIT_SYSTEM_ACTOR } = require('../services/oxsteedCreditAdminService');

const MIGRATION_635_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '635_oxsteed_credit_settlement_cycles.sql'),
  'utf8'
);
const MIGRATION_636_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '636_oxsteed_credit_reserve_policies.sql'),
  'utf8'
);

const PARTNER_ID = 41;
const RESTAURANT_ID = 9;
const CURRENCY = 'USD';
const CYCLE_ID = '11111111-2222-4333-8444-555555555555';
const AGREEMENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ADMIN_UUID = 'ffffffff-0000-4000-8000-000000000001';

function partnerRow(overrides = {}) {
  return {
    id: PARTNER_ID,
    restaurant_id: RESTAURANT_ID,
    business_id: 5,
    settlement_currency_code: CURRENCY,
    status: 'active',
    ...overrides,
  };
}

function agreementRow(overrides = {}) {
  return {
    id: AGREEMENT_ID,
    partner_id: PARTNER_ID,
    restaurant_id: RESTAURANT_ID,
    restaurant_name: 'Testaurant',
    settlement_currency_code: CURRENCY,
    version: 1,
    status: 'draft',
    partner_status: 'active',
    starts_at: new Date('2026-09-01T00:00:00Z'),
    ends_at: null,
    customer_terms: null,
    allowed_order_types: [],
    allowed_categories: [],
    allowed_menu_item_ids: [],
    geography: {},
    max_transaction_cents: null,
    daily_customer_limit_cents: null,
    lifetime_customer_limit_cents: null,
    metadata: {},
    requires_customer_entitlement: false,
    created_by: null,
    approved_by: null,
    created_at: new Date('2026-09-30T00:00:00Z'),
    updated_at: new Date('2026-09-30T00:00:00Z'),
    ...overrides,
  };
}

function settlementRow(overrides = {}) {
  return {
    id: 'settlement-1',
    partner_id: PARTNER_ID,
    agreement_id: AGREEMENT_ID,
    restaurant_id: RESTAURANT_ID,
    restaurant_name: 'Testaurant',
    currency_code: CURRENCY,
    period_start: new Date('2026-09-30T00:00:00Z'),
    period_end: new Date('2026-10-01T00:00:00Z'),
    gross_cents: 10000,
    refund_cents: 1000,
    fee_cents: 200,
    net_cents: 8800,
    status: 'pending',
    payout_status: 'none',
    payment_reference: null,
    stripe_transfer_id: null,
    payout_initiated_by: null,
    payout_initiated_at: null,
    idempotency_key: `credit-settlement-cycle:${CYCLE_ID}:partner:${PARTNER_ID}:${CURRENCY}`,
    metadata: {},
    creation_reason: 'Automated settlement cycle',
    creation_request_hash: 'hash',
    created_by: null,
    approved_by: null,
    paid_at: null,
    cycle_id: CYCLE_ID,
    value_date: '2026-10-01',
    settlement_date: '2026-10-01',
    created_at: new Date('2026-10-01T00:05:00Z'),
    updated_at: new Date('2026-10-01T00:05:00Z'),
    ...overrides,
  };
}

function cycleRow(overrides = {}) {
  return {
    id: CYCLE_ID,
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

function defaultPolicyRow() {
  return {
    id: 1,
    partner_id: null,
    currency_code: CURRENCY,
    ratio_bps: 1000,
    floor_cents: 50000,
    is_default: true,
  };
}

/**
 * Scripted pg mock for the cycle job + reserve monitor. Fixtures are
 * per-test knobs; SQL is matched on distinctive fragments (most specific
 * first).
 */
function makeCycleMock({
  railEnabled = true,
  existingCycleStatus = null,
  activity = [{ partner_id: PARTNER_ID, currency_code: CURRENCY }],
  partner = partnerRow(),
  activeAgreement = null,
  existingAgreement = null,
  totals = { gross_cents: '10000', refund_cents: '1000', fee_cents: '200' },
  payableBalanceCents = 0,
  reserveAccounts = [{ partner_id: PARTNER_ID, currency_code: CURRENCY, balance_cents: 100000 }],
  reserveBalances = {},
  payableReserveRead = {},
  overlapOnCreate = false,
} = {}) {
  const calls = { settlementInserts: [], fundingInserts: [], incidents: [], heartbeats: 0 };
  const agreement = existingAgreement || agreementRow({ status: 'active' });
  // transitionAgreement reads the agreement back after createAgreement: it is
  // still a draft at that point (activation happens in the UPDATE). The job
  // walks draft -> pending_approval -> active, so the second read must see
  // pending_approval. Transition updates are detected by their version
  // increment: the job's two transitions raise version 2 then 3.
  let transitionReads = 0;

  const mock = jest.fn(async (text, params = []) => {
    const sql = String(text);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [{}] };
    if (sql.includes("FROM feature_flags WHERE key = 'oxsteed_credit_enabled'")) {
      return railEnabled ? { rows: [{ is_enabled: true }] } : { rows: [{ is_enabled: false }] };
    }
    if (sql.includes('INSERT INTO cron_job_locks')) return { rows: [{ lock_id: 'job_lock:x' }] };
    if (sql.includes('DELETE FROM cron_job_locks')) return { rows: [] };
    if (sql.includes('INSERT INTO oxsteed_credit_settlement_cycles')) {
      if (existingCycleStatus) return { rows: [] };
      return { rows: [cycleRow()] };
    }
    if (sql.includes('SELECT * FROM oxsteed_credit_settlement_cycles WHERE cycle_type')) {
      return { rows: [cycleRow({ status: existingCycleStatus || 'scheduled' })] };
    }
    if (sql.includes('UPDATE oxsteed_credit_settlement_cycles')) {
      return { rows: [cycleRow({ status: sql.includes("'completed'") ? 'completed' : 'processing' })] };
    }
    if (sql.includes('SELECT DISTINCT t.partner_id, t.currency_code')) {
      return { rows: activity };
    }
    // Reserve policy read (shared by monitor, payout gate, posting guard).
    if (sql.includes('FROM oxsteed_credit_reserve_policies')) {
      return { rows: [defaultPolicyRow()] };
    }
    // getReserveStatus balance reads: params are [account_type, partner_id, currency_code].
    if (sql.includes('SELECT balance_cents') && sql.includes('FROM oxsteed_credit_accounts') && params.length === 3) {
      const [accountType, partnerId] = params;
      if (accountType === 'partner_reserve') {
        const key = `${partnerId}:${params[2]}`;
        return { rows: [{ balance_cents: reserveBalances[key] ?? 100000 }] };
      }
      if (accountType === 'partner_payable') {
        const key = `${partnerId}:${params[2]}`;
        return { rows: [{ balance_cents: payableReserveRead[key] ?? 0 }] };
      }
    }
    if (sql.includes('FROM oxsteed_credit_accounts') && sql.includes("account_type = 'partner_reserve'") && params.length === 0) {
      return { rows: reserveAccounts };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_reserve_funding_requirements')) {
      calls.fundingInserts.push(params);
      return { rows: [{ id: 7 }] };
    }
    if (sql.includes('INSERT INTO incident_log')) {
      calls.incidents.push(params);
      return { rows: [{ id: 99 }] };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_worker_heartbeats')) {
      calls.heartbeats += 1;
      return { rows: [{}] };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [{}] };
    // createAgreement idempotency replay check (must precede the generic
    // FOR UPDATE agreement match: its SQL also carries fr.display_name).
    if (sql.includes('creation_idempotency_key') && sql.includes('FROM oxsteed_credit_partner_agreements a')) {
      return { rows: existingAgreement ? [existingAgreement] : [] };
    }
    // createSettlement: agreement lookup is FOR SHARE; transitionAgreement is FOR UPDATE.
    if (sql.includes('FOR SHARE') && sql.includes('FROM oxsteed_credit_partner_agreements a')) {
      return { rows: [agreementRow({ status: 'active' })] };
    }
    if (sql.includes('FOR UPDATE') && sql.includes('fr.display_name') && sql.includes('FROM oxsteed_credit_partner_agreements a')) {
      transitionReads += 1;
      return { rows: [existingAgreement || agreementRow({ status: transitionReads > 1 ? 'pending_approval' : 'draft', version: transitionReads })] };
    }
    if (sql.includes('COALESCE(MAX(version), 0) + 1')) return { rows: [{ next_version: 1 }] };
    if (sql.includes('INSERT INTO oxsteed_credit_partner_agreements')) {
      return { rows: [agreementRow({ status: 'draft' })] };
    }
    if (sql.includes('UPDATE oxsteed_credit_partner_agreements')) {
      return { rows: [agreementRow({ status: 'active' })] };
    }
    if (sql.includes("a.status = 'active'") && sql.includes('FROM oxsteed_credit_partner_agreements a')) {
      return { rows: activeAgreement ? [activeAgreement] : [] };
    }
    if (sql.includes('FROM oxsteed_credit_partners WHERE id = $1')) {
      return { rows: partner ? [partner] : [] };
    }
    if (sql.includes('pg_advisory_xact_lock(hashtextextended')) return { rows: [{}] };
    if (sql.includes('WHERE s.idempotency_key = $1')) return { rows: [] };
    if (sql.includes('WHERE s.id = $1') && sql.includes('FROM oxsteed_credit_settlements s')) {
      throw new Error(`unexpected settlement lookup by id in cycle mock: ${sql.slice(0, 80)}`);
    }
    if (sql.includes('SUM(t.amount_cents) FILTER')) return { rows: [totals] };
    if (sql.includes("account_type = 'partner_payable'") && sql.includes('FOR UPDATE')) {
      return { rows: [{ balance_cents: payableBalanceCents }] };
    }
    if (sql.includes('INSERT INTO oxsteed_credit_settlements')) {
      if (overlapOnCreate) {
        const conflict = new Error('Settlement period overlaps an existing non-voided settlement');
        conflict.code = 'credit_settlement_period_overlap';
        conflict.statusCode = 409;
        conflict.details = { settlementId: 'existing-1', status: 'approved' };
        throw conflict;
      }
      calls.settlementInserts.push(params);
      return { rows: [settlementRow()] };
    }
    return { rows: [] };
  });
  mockQuery.mockImplementation(mock);
  return { mock, calls };
}

beforeEach(() => {
  mockQuery.mockReset();
  jest.clearAllMocks();
});

describe('settlement calendar (pure UTC)', () => {
  test('weekends roll forward to Monday', () => {
    // 2026-09-26 is a Saturday, 2026-09-27 a Sunday, 2026-09-28 a Monday.
    expect(isWeekend(new Date('2026-09-26T12:00:00Z'))).toBe(true);
    expect(isWeekend(new Date('2026-09-27T12:00:00Z'))).toBe(true);
    expect(isWeekend(new Date('2026-09-28T12:00:00Z'))).toBe(false);
    // 2026-09-25 is a Friday (a business day: unchanged), 2026-09-26 a
    // Saturday, 2026-09-27 a Sunday, 2026-09-28 a Monday.
    expect(nextBusinessDay(new Date('2026-09-25T12:00:00Z')).toISOString()).toBe('2026-09-25T12:00:00.000Z');
    expect(nextBusinessDay(new Date('2026-09-26T12:00:00Z')).toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(nextBusinessDay(new Date('2026-09-28T12:00:00Z')).toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });

  test('addBusinessDays skips weekends', () => {
    expect(addBusinessDays(new Date('2026-09-25T00:00:00Z'), 1).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(addBusinessDays(new Date('2026-09-28T00:00:00Z'), 5).toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  test('startOfUtcDay truncates to midnight UTC', () => {
    expect(startOfUtcDay(new Date('2026-10-01T15:30:00Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });
});

describe('cycle planning', () => {
  test('weekly weekday creates only the weekly cycle for the previous 7 days', () => {
    // 2026-09-28 is a Monday.
    const cycles = planCycles(new Date('2026-09-28T12:00:00Z'), 1);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycleType).toBe('weekly');
    expect(cycles[0].periodStart.toISOString()).toBe('2026-09-21T00:00:00.000Z');
    expect(cycles[0].periodEnd.toISOString()).toBe('2026-09-28T00:00:00.000Z');
  });

  test('other days create only the daily cycle for the previous UTC day', () => {
    // 2026-10-01 is a Thursday.
    const cycles = planCycles(new Date('2026-10-01T12:00:00Z'), 1);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycleType).toBe('daily');
    expect(cycles[0].periodStart.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(cycles[0].periodEnd.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  test('invalid env parsing falls back to documented defaults', () => {
    process.env.OXSTEED_CREDIT_SETTLEMENT_WEEKLY_WEEKDAY = '9';
    process.env.OXSTEED_CREDIT_RESERVE_WARN_MULTIPLIER = '0.5';
    expect(parseWeeklyWeekday()).toBe(1);
    expect(parseWarnMultiplier()).toBe(1.1);
    delete process.env.OXSTEED_CREDIT_SETTLEMENT_WEEKLY_WEEKDAY;
    delete process.env.OXSTEED_CREDIT_RESERVE_WARN_MULTIPLIER;
  });
});

describe('settlement cycle job', () => {
  test('creates one pending settlement per partner with agreement auto-provisioning', async () => {
    const { mock, calls } = makeCycleMock();
    const result = await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    expect(result.locked).not.toBe(false);
    const cycle = result.cycles[0];
    expect(cycle.cycleType).toBe('daily');
    expect(cycle.status).toBe('completed');
    expect(cycle.settlements).toHaveLength(1);
    expect(cycle.settlements[0].status).toBe('created');

    // Agreement flow ran: insert then draft -> active transition.
    expect(mock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oxsteed_credit_partner_agreements'), expect.anything());
    expect(mock).toHaveBeenCalledWith(expect.stringContaining('UPDATE oxsteed_credit_partner_agreements'), expect.anything());

    // The settlement insert carries the cycle columns and the payable netting params.
    expect(calls.settlementInserts).toHaveLength(1);
    const params = calls.settlementInserts[0];
    expect(params[15]).toBe(CYCLE_ID); // cycle_id
    expect(params[16]).toBe('2026-10-01'); // value_date = period end date
    expect(params[17]).toBe('2026-10-01'); // settlement_date = next business day
    const metadata = JSON.parse(params[11]);
    expect(metadata.systemActor).toBe(CREDIT_SYSTEM_ACTOR);
    expect(metadata.netting_breakdown).toMatchObject({
      gross_cents: 10000,
      refund_cents: 1000,
      fee_cents: 200,
      prior_payable_balance_cents: 0,
      currency_code: CURRENCY,
    });
    expect(calls.heartbeats).toBe(1);
  });

  test('activity query uses the half-open previous-day cut-off window', async () => {
    const { mock } = makeCycleMock();
    await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    const activityCall = mock.mock.calls.find(([text]) => String(text).includes('SELECT DISTINCT t.partner_id, t.currency_code'));
    expect(activityCall).toBeTruthy();
    // [period_start, period_end): 2026-09-30 00:00Z inclusive, 2026-10-01 00:00Z exclusive.
    expect(new Date(activityCall[1][1]).toISOString()).toBe('2026-09-30T00:00:00.000Z');
    expect(new Date(activityCall[1][2]).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  test('re-run of a completed cycle is a no-op', async () => {
    const { mock, calls } = makeCycleMock({ existingCycleStatus: 'completed' });
    const result = await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    expect(result.cycles[0].status).toBe('already_completed');
    expect(calls.settlementInserts).toHaveLength(0);
    expect(mock).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oxsteed_credit_partner_agreements'), expect.anything());
  });

  test('rail disabled short-circuits before the lock, heartbeat, and incidents', async () => {
    const { mock, calls } = makeCycleMock({ railEnabled: false });
    const result = await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    expect(result).toEqual({ locked: false, skipped: 'rail_disabled' });
    expect(mock).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO cron_job_locks'), expect.anything());
    expect(calls.heartbeats).toBe(0);
    expect(calls.incidents).toHaveLength(0);
  });

  test('negative payable balance nets down the settlement (per-currency)', async () => {
    const { calls } = makeCycleMock({ payableBalanceCents: -1500 });
    await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    const params = calls.settlementInserts[0];
    // net = max(0, 10000 - 1000 - 200 + min(0, -1500)) = 7300
    expect(params[8]).toBe(7300);
    const metadata = JSON.parse(params[11]);
    expect(metadata.netting_breakdown).toMatchObject({ prior_payable_balance_cents: -1500, net_cents: 7300 });
  });

  test('positive payable balance is never netted away', async () => {
    const { calls } = makeCycleMock({ payableBalanceCents: 5000 });
    await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    const params = calls.settlementInserts[0];
    expect(params[8]).toBe(8800);
    expect(JSON.parse(params[11]).netting_breakdown.prior_payable_balance_cents).toBe(5000);
  });

  test('non-active partner is skipped with a warning incident and no agreement', async () => {
    const { mock, calls } = makeCycleMock({ partner: partnerRow({ status: 'suspended' }) });
    const result = await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    expect(result.cycles[0].status).toBe('completed');
    expect(result.cycles[0].settlements[0]).toMatchObject({ status: 'skipped', reason: 'partner_not_active' });
    expect(calls.settlementInserts).toHaveLength(0);
    expect(mock).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oxsteed_credit_partner_agreements'), expect.anything());
    expect(calls.incidents.length).toBeGreaterThan(0);
  });

  test('period overlap is treated as already-covered, not a failure', async () => {
    const { calls } = makeCycleMock({ overlapOnCreate: true });
    const result = await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    expect(result.cycles[0].status).toBe('completed');
    expect(result.cycles[0].settlements[0]).toMatchObject({ status: 'skipped', reason: 'period_already_covered' });
    expect(result.cycles[0].errors).toHaveLength(0);
    expect(calls.settlementInserts).toHaveLength(0);
  });

  test('currency outside the partner settlement currency is skipped loudly', async () => {
    const { calls } = makeCycleMock({
      activity: [{ partner_id: PARTNER_ID, currency_code: 'EUR' }],
    });
    const result = await runOxsteedCreditSettlementCycle({ now: new Date('2026-10-01T12:00:00Z') });
    expect(result.cycles[0].settlements[0]).toMatchObject({ status: 'skipped', reason: 'currency_mismatch' });
    expect(calls.settlementInserts).toHaveLength(0);
    expect(calls.incidents.length).toBeGreaterThan(0);
  });

  test('job name matches the worker registry entry', () => {
    expect(JOB_NAME).toBe('oxsteed-credit-settlement-cycle');
  });
});

describe('reserve monitor', () => {
  test('below-floor reserve pages critical and opens a funding requirement', async () => {
    const { calls } = makeCycleMock({
      reserveAccounts: [{ partner_id: PARTNER_ID, currency_code: CURRENCY, balance_cents: 10000 }],
      reserveBalances: { [`${PARTNER_ID}:${CURRENCY}`]: 10000 },
    });
    const result = await checkReserveLevels();

    expect(result.checked).toBe(1);
    expect(result.belowFloor).toHaveLength(1);
    expect(result.low).toHaveLength(0);
    // Critical incident paged.
    expect(calls.incidents.length).toBeGreaterThan(0);
    // One open funding requirement for the shortfall (50000 - 10000).
    expect(calls.fundingInserts).toHaveLength(1);
    expect(calls.fundingInserts[0][0]).toBe(PARTNER_ID);
    expect(calls.fundingInserts[0][1]).toBe(CURRENCY);
    expect(calls.fundingInserts[0][2]).toBe(40000);
    expect(calls.fundingInserts[0][3]).toBe('reserve_below_floor');
  });

  test('low-but-above-floor reserve warns without a funding requirement', async () => {
    const { calls } = makeCycleMock({
      reserveAccounts: [{ partner_id: PARTNER_ID, currency_code: CURRENCY, balance_cents: 52000 }],
      reserveBalances: { [`${PARTNER_ID}:${CURRENCY}`]: 52000 },
    });
    const result = await checkReserveLevels({ warnMultiplier: 1.1 });

    expect(result.belowFloor).toHaveLength(0);
    expect(result.low).toHaveLength(1);
    expect(calls.incidents.length).toBeGreaterThan(0);
    expect(calls.fundingInserts).toHaveLength(0);
  });

  test('healthy reserve is silent', async () => {
    const { calls } = makeCycleMock({
      reserveAccounts: [{ partner_id: PARTNER_ID, currency_code: CURRENCY, balance_cents: 100000 }],
      reserveBalances: { [`${PARTNER_ID}:${CURRENCY}`]: 100000 },
    });
    const result = await checkReserveLevels();
    expect(result.belowFloor).toHaveLength(0);
    expect(result.low).toHaveLength(0);
    expect(calls.incidents).toHaveLength(0);
    expect(calls.fundingInserts).toHaveLength(0);
  });

  test('the monitor never posts journal entries', async () => {
    const { mock } = makeCycleMock({
      reserveAccounts: [{ partner_id: PARTNER_ID, currency_code: CURRENCY, balance_cents: 10000 }],
      reserveBalances: { [`${PARTNER_ID}:${CURRENCY}`]: 10000 },
    });
    await checkReserveLevels();
    expect(mock).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oxsteed_credit_transactions'), expect.anything());
    expect(mock).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oxsteed_credit_accounts'), expect.anything());
  });
});

describe('reserve posting guard', () => {
  function makePostingMock() {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_reserve_policies')) return { rows: [defaultPolicyRow()] };
      return { rows: [] };
    });
  }

  test('a posting that would breach the floor is rejected before it posts', async () => {
    makePostingMock();
    const debitAccount = { partner_id: PARTNER_ID, currency_code: CURRENCY };
    await expect(
      assertReserveFloorForPosting({ query: mockQuery }, { debitAccount, nextBalanceCents: 49999 })
    ).rejects.toMatchObject({ code: 'credit_reserve_floor_breach', statusCode: 403 });
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO oxsteed_credit_transactions'), expect.anything());
  });

  test('a posting that stays at or above the floor passes', async () => {
    makePostingMock();
    const debitAccount = { partner_id: PARTNER_ID, currency_code: CURRENCY };
    await expect(
      assertReserveFloorForPosting({ query: mockQuery }, { debitAccount, nextBalanceCents: 50000 })
    ).resolves.toBeUndefined();
  });

  test('getReserveStatus fails closed when no policy exists', async () => {
    mockQuery.mockImplementation(async (text) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_reserve_policies')) return { rows: [] };
      return { rows: [] };
    });
    await expect(getReserveStatus({ query: mockQuery }, { partnerId: PARTNER_ID, currencyCode: CURRENCY }))
      .rejects.toMatchObject({ code: 'credit_reserve_policy_missing' });
  });

  test('negative payable balance does not inflate the ratio requirement', async () => {
    mockQuery.mockImplementation(async (text, params = []) => {
      const sql = String(text);
      if (sql.includes('FROM oxsteed_credit_reserve_policies')) return { rows: [defaultPolicyRow()] };
      if (sql.includes('SELECT balance_cents') && params[0] === 'partner_reserve') return { rows: [{ balance_cents: 60000 }] };
      if (sql.includes('SELECT balance_cents') && params[0] === 'partner_payable') return { rows: [{ balance_cents: -20000 }] };
      return { rows: [] };
    });
    const status = await getReserveStatus({ query: mockQuery }, { partnerId: PARTNER_ID, currencyCode: CURRENCY });
    expect(status.outstandingPayableCents).toBe(0);
    expect(status.requiredCents).toBe(50000); // floor only; ratio of 0
    expect(status.meetsFloor).toBe(true);
  });
});

describe('settlement payout reserve gate', () => {
  function makePayoutMock({ reserveBalanceCents }) {
    const calls = { transfers: 0 };
    mockQuery.mockImplementation(async (text, params = []) => {
      const sql = String(text);
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [{}] };
      if (sql.includes('WHERE s.id = $1') && sql.includes('FROM oxsteed_credit_settlements s')) {
        return { rows: [settlementRow({ status: 'approved', payout_status: 'none', net_cents: 100000 })] };
      }
      if (sql.includes('FROM oxsteed_credit_reserve_policies')) return { rows: [defaultPolicyRow()] };
      if (sql.includes('FROM oxsteed_credit_sanctions_screenings')) {
        // Phase 5: the payout beneficiary screens clear (fresh), so the
        // payout sanctions gate passes in these success-path tests.
        return { rows: [{ id: 'san-2', subject_type: 'partner', subject_id: 'partner-1', provider: 'manual_review', result: 'clear', hit_context: null, payload_hash: 'h', screened_at: new Date().toISOString(), cleared_at: null, cleared_by: null, clear_reason: null, created_at: new Date().toISOString() }] };
      }
      if (sql.includes('SELECT balance_cents') && params[0] === 'partner_reserve') return { rows: [{ balance_cents: reserveBalanceCents }] };
      if (sql.includes('SELECT balance_cents') && params[0] === 'partner_payable') return { rows: [{ balance_cents: 0 }] };
      if (sql.includes('FROM food_restaurants fr')) return { rows: [{ business_id: 5, owner_user_id: 'owner-1' }] };
      if (sql.includes('FROM businesses b')) return { rows: [{ stripe_account_id: 'acct_test_123' }] };
      if (sql.includes('UPDATE oxsteed_credit_settlements')) {
        return { rows: [settlementRow({ status: 'approved', payout_status: 'initiated', stripe_transfer_id: 'tr_test_cycle_123' })] };
      }
      if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) return { rows: [{}] };
      return { rows: [] };
    });
    return calls;
  }

  test('payout is blocked while the reserve is below max(floor, ratio * net)', async () => {
    makePayoutMock({ reserveBalanceCents: 10000 });
    const error = await initiateSettlementPayout({
      settlementId: 'settlement-1',
      actorUserId: ADMIN_UUID,
      idempotencyKey: 'payout-test-1',
    }).catch((e) => e);
    expect(error).toMatchObject({ code: 'credit_settlement_payout_reserve_breach', statusCode: 409 });
    // net 100000 -> ratio requirement 10000; floor 50000 wins; balance 10000 < 50000.
    expect(error.fields).toMatchObject({
      reserveBalanceCents: '10000',
      reserveFloorCents: '50000',
      requiredReserveCents: '50000',
    });
    // No Stripe transfer was attempted and no payout state changed.
    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE oxsteed_credit_settlements'), expect.anything());
  });

  test('payout proceeds once the reserve meets the requirement', async () => {
    makePayoutMock({ reserveBalanceCents: 60000 });
    const result = await initiateSettlementPayout({
      settlementId: 'settlement-1',
      actorUserId: ADMIN_UUID,
      idempotencyKey: 'payout-test-2',
    });
    expect(result.settlement.payoutStatus).toBe('initiated');
    expect(result.stripeTransferId).toBe('tr_test_cycle_123');
    expect(result.settlement.stripeTransferId).toBe('tr_test_cycle_123');
  });
});

describe('phase 3 migration text', () => {
  test('635 creates the cycles table, the unique period guard, and the settlement columns', () => {
    expect(MIGRATION_635_SQL).toContain('CREATE TABLE IF NOT EXISTS oxsteed_credit_settlement_cycles');
    expect(MIGRATION_635_SQL).toContain('uq_oxsteed_credit_settlement_cycles_type_period');
    expect(MIGRATION_635_SQL).toContain('UNIQUE (cycle_type, period_start)');
    expect(MIGRATION_635_SQL).toContain('oxsteed_credit_settlement_cycles_period_check');
    expect(MIGRATION_635_SQL).toContain('cycle_id UUID');
    expect(MIGRATION_635_SQL).toContain('value_date');
    expect(MIGRATION_635_SQL).toContain('settlement_date');
    // The immutability trigger is recreated to cover the new columns.
    expect(MIGRATION_635_SQL).toContain('cycle_id');
    expect(MIGRATION_635_SQL).toContain('value_date');
  });

  test('636 creates the policy tables with their uniqueness guards and default seeds', () => {
    expect(MIGRATION_636_SQL).toContain('CREATE TABLE IF NOT EXISTS oxsteed_credit_reserve_policies');
    expect(MIGRATION_636_SQL).toContain('CREATE TABLE IF NOT EXISTS oxsteed_credit_reserve_funding_requirements');
    expect(MIGRATION_636_SQL).toContain('uq_oxsteed_credit_reserve_policy_partner_currency');
    expect(MIGRATION_636_SQL).toContain('uq_oxsteed_credit_reserve_default_policy');
    expect(MIGRATION_636_SQL).toContain('uq_oxsteed_credit_reserve_funding_open');
    expect(MIGRATION_636_SQL).toContain('ratio_bps');
    expect(MIGRATION_636_SQL).toContain('floor_cents');
    expect(MIGRATION_636_SQL).toContain("(NULL, 'USD', 1000, 50000, true)");
  });
});
