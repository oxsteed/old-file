'use strict';

/**
 * Phase 4: external reconciliation vs Stripe (gap 7).
 *
 * A fake Stripe client is injected through the service's `getStripe`
 * parameter (the shared stripe mock lacks paymentIntents.retrieve/list and
 * transfers). The DB is the suite-local pg mock with a SQL-content router
 * that applies the same period/window filters as the real queries, so
 * period-scoping is exercised end to end at the SQL level.
 */

const { Pool } = require('pg');
const mockQuery = Pool.mockQuery;

jest.mock('../jobs/jobLockingService', () => ({
  withJobLock: jest.fn(async (_name, handler) => handler()),
}));
jest.mock('../services/oxsteedCreditWorkerHeartbeat', () => ({
  recordOxsteedCreditWorkerRun: jest.fn(async () => ({})),
}));
jest.mock('../services/incidentStore', () => ({
  recordIncident: jest.fn(async (input) => ({ id: 'incident-1', ...input })),
}));
jest.mock('../services/reconciliationExceptions', () => ({
  recordException: jest.fn(async () => 'exc-1'),
}));
jest.mock('../services/oxsteedCreditService', () => {
  const actual = jest.requireActual('../services/oxsteedCreditService');
  return {
    ...actual,
    isCreditRailEnabled: jest.fn(async () => true),
    freezeCreditRail: jest.fn(async () => ({
      freeze: { id: 'freeze-1' },
      engaged: true,
      replayed: false,
    })),
  };
});

const pool = require('../db');
const {
  reconcileCreditExternal,
  triggerExternalReconciliation,
} = require('../services/oxsteedCreditExternalReconciliation');
const {
  runOxsteedCreditExternalReconciliation,
} = require('../jobs/oxsteedCreditExternalReconciliation');
const {
  assertCreditRailEnabled,
  unfreezeCreditRail,
  isCreditRailEnabled,
  freezeCreditRail,
} = require('../services/oxsteedCreditService');
const { recordException } = require('../services/reconciliationExceptions');
const { recordIncident } = require('../services/incidentStore');
const { withJobLock } = require('../jobs/jobLockingService');
const { recordOxsteedCreditWorkerRun } = require('../services/oxsteedCreditWorkerHeartbeat');

const PERIOD = {
  start: new Date('2026-09-30T00:00:00Z'),
  end: new Date('2026-10-01T00:00:00Z'),
};
const NOW = new Date('2026-10-01T12:00:00Z');

// Mutable fixture state, applied by the SQL router below.
const db = { topups: [], topupById: {}, settlements: [], journalByRef: {}, partners: [] };
let openFreeze = null;
let railEnabled = true;
let lastRunCurrency = 'USD';
let lastRunPeriod = { start: PERIOD.start.toISOString(), end: PERIOD.end.toISOString() };
let stripe = null;

function effectivePaidDate(settlement) {
  return new Date(settlement.paid_at || settlement.updated_at);
}

mockQuery.mockImplementation((sql, params = []) => {
  if (sql.includes('oxsteed_credit_rail_freezes')) {
    if (sql.includes('INSERT INTO')) {
      const row = {
        id: 'freeze-1',
        reason: params[0],
        metadata: JSON.parse(params[2] || '{}'),
        engaged_by: params[3],
        engaged_at: new Date(),
        cleared_at: null,
      };
      openFreeze = row;
      return Promise.resolve({ rows: [row] });
    }
    if (sql.includes('UPDATE')) {
      const row = openFreeze
        ? { ...openFreeze, cleared_at: new Date(), cleared_by: params[0], clear_reason: params[1] }
        : null;
      openFreeze = null;
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    return Promise.resolve({ rows: openFreeze ? [openFreeze] : [] });
  }
  if (sql.includes('FROM feature_flags')) {
    return Promise.resolve({ rows: railEnabled ? [{ is_enabled: true }] : [] });
  }
  if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve({ rows: [] });
  if (sql.includes('INSERT INTO oxsteed_credit_audit_events')) {
    return Promise.resolve({ rows: [] });
  }
  if (sql.includes('INSERT INTO oxsteed_credit_external_reconciliation_runs')) {
    const [currencyCode, periodStart, periodEnd, completedBy] = params;
    lastRunCurrency = currencyCode;
    lastRunPeriod = { start: periodStart, end: periodEnd };
    return Promise.resolve({
      rows: [{
        id: `run-${currencyCode}`,
        currency_code: currencyCode,
        period_start: periodStart,
        period_end: periodEnd,
        scope: 'period',
        status: 'running',
        completed_by: completedBy,
        started_at: new Date(),
        completed_at: null,
        error_message: null,
        metadata: {},
        freeze_engaged: false,
      }],
    });
  }
  if (sql.includes('UPDATE oxsteed_credit_external_reconciliation_runs')) {
    const p = params;
    return Promise.resolve({
      rows: [{
        id: p[0],
        currency_code: lastRunCurrency,
        period_start: lastRunPeriod.start,
        period_end: lastRunPeriod.end,
        scope: 'period',
        status: p[1],
        topups_checked: p[2],
        topups_matched: p[3],
        topups_missing_in_stripe: p[4],
        topups_missing_in_ledger: p[5],
        payouts_checked: p[6],
        payouts_matched: p[7],
        payouts_missing_in_stripe: p[8],
        payouts_reversed_in_stripe: p[9],
        partner_checks: p[10],
        partner_mismatches: p[11],
        material: p[12],
        freeze_engaged: p[13],
        error_message: p[14],
        metadata: JSON.parse(p[15] || '{}'),
        started_at: new Date(),
        completed_at: new Date(),
        completed_by: null,
      }],
    });
  }
  if (sql.includes('FROM oxsteed_credit_topups')) {
    if (sql.includes('WHERE id = $1')) {
      const row = db.topupById[params[0]];
      return Promise.resolve({ rows: row ? [row] : [] });
    }
    const [currency, start, end] = params;
    const s = new Date(start);
    const e = new Date(end);
    const rows = db.topups.filter((t) => t.currency_code === currency && (
      t.status === 'requires_attention'
      || (t.status === 'completed' && t.created_at >= s && t.created_at < e)
    ));
    return Promise.resolve({ rows });
  }
  if (sql.includes('FROM oxsteed_credit_settlements')) {
    const [currency, start, end] = params;
    const s = new Date(start);
    const e = new Date(end);
    const rows = db.settlements.filter((x) => x.currency_code === currency
      && x.payout_status === 'paid'
      && effectivePaidDate(x) >= s && effectivePaidDate(x) < e);
    return Promise.resolve({ rows });
  }
  if (sql.includes('FROM oxsteed_credit_transactions')) {
    const row = db.journalByRef[params[0]];
    return Promise.resolve({ rows: row ? [row] : [] });
  }
  if (sql.includes('FROM oxsteed_credit_accounts')) {
    const rows = db.partners.filter((a) => a.currency_code === params[0]
      && a.account_type === 'partner_payable');
    return Promise.resolve({ rows });
  }
  return Promise.resolve({ rows: [] });
});

function makeStripe() {
  return {
    paymentIntents: { retrieve: jest.fn(), list: jest.fn() },
    transfers: { retrieve: jest.fn() },
  };
}

function baseTopup(overrides = {}) {
  return {
    id: 'topup-1',
    customer_id: 'cust-1',
    currency_code: 'USD',
    amount_cents: 5000,
    status: 'completed',
    stripe_payment_intent_id: 'pi_1',
    created_at: new Date('2026-09-30T10:00:00Z'),
    updated_at: new Date('2026-09-30T10:05:00Z'),
    ...overrides,
  };
}

function baseSettlement(overrides = {}) {
  return {
    id: 'settle-1',
    partner_id: 7,
    currency_code: 'USD',
    net_cents: 9000,
    payout_status: 'paid',
    stripe_transfer_id: 'tr_1',
    payout_destination_account: 'acct_dest',
    paid_at: new Date('2026-09-30T15:00:00Z'),
    updated_at: new Date('2026-09-30T15:05:00Z'),
    ...overrides,
  };
}

async function reconcile(overrides = {}) {
  return reconcileCreditExternal({
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    currencyCodes: ['USD'],
    getStripe: () => stripe,
    now: NOW,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  db.topups = [];
  db.topupById = {};
  db.settlements = [];
  db.journalByRef = {};
  db.partners = [];
  openFreeze = null;
  railEnabled = true;
  lastRunCurrency = 'USD';
  lastRunPeriod = { start: PERIOD.start.toISOString(), end: PERIOD.end.toISOString() };
  stripe = makeStripe();
  stripe.paymentIntents.list.mockResolvedValue({ data: [], has_more: false });
  isCreditRailEnabled.mockResolvedValue(true);
});

describe('topup IN checks', () => {
  test('completed top-up matching a succeeded PaymentIntent is matched', async () => {
    db.topups = [baseTopup()];
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1', amount: 5000, currency: 'usd', status: 'succeeded',
    });

    const { runs, errors } = await reconcile();
    expect(errors).toHaveLength(0);
    const run = runs[0];
    expect(run.status).toBe('matched');
    expect(run.topupsChecked).toBe(1);
    expect(run.topupsMatched).toBe(1);
    expect(run.material).toBe(false);
    expect(run.freezeEngaged).toBe(false);
    expect(freezeCreditRail).not.toHaveBeenCalled();
    expect(recordIncident).not.toHaveBeenCalled();
    expect(recordException).not.toHaveBeenCalled();
  });

  test('top-up whose PaymentIntent is gone from Stripe is a material missing_in_stripe', async () => {
    db.topups = [baseTopup({ id: 'topup-2', stripe_payment_intent_id: 'pi_missing' })];
    stripe.paymentIntents.retrieve.mockRejectedValue(
      Object.assign(new Error('No such payment_intent'), { code: 'resource_missing' })
    );

    const { runs, incidents } = await reconcile();
    const run = runs[0];
    expect(run.status).toBe('mismatch');
    expect(run.material).toBe(true);
    expect(run.topupsMissingInStripe).toBe(1);
    expect(run.freezeEngaged).toBe(true);
    expect(freezeCreditRail).toHaveBeenCalledWith(expect.objectContaining({
      systemEngaged: true,
      incidentRef: 'oxsteed-credit-external-reconciliation:material:USD',
    }));
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      domain: 'credit_external',
      referenceId: 'credit-topup:topup-2:missing_in_stripe',
      severity: 'critical',
    }));
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'oxsteed_credit_external_reconciliation_material',
      severity: 'critical',
    }));
    expect(incidents).toHaveLength(1);
  });

  test('aged Stripe payment with no ledger row is a non-material missing_in_ledger warning', async () => {
    stripe.paymentIntents.list.mockResolvedValue({
      data: [{
        id: 'pi_ghost', amount: 100, currency: 'usd', status: 'succeeded',
        created: Math.floor(new Date('2026-09-30T01:00:00Z').getTime() / 1000),
        metadata: { oxsteed_credit_topup_id: 'topup-ghost' },
      }],
      has_more: false,
    });

    const { runs } = await reconcile();
    const run = runs[0];
    expect(run.status).toBe('mismatch');
    expect(run.topupsMissingInLedger).toBe(1);
    expect(run.material).toBe(false);
    expect(freezeCreditRail).not.toHaveBeenCalled();
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'credit-topup-pi:pi_ghost:missing_in_ledger',
      severity: 'warning',
    }));
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'oxsteed_credit_external_reconciliation_mismatch',
      severity: 'warning',
    }));
  });

  test('in-flight Stripe payment with no ledger row yet is pending, not a mismatch', async () => {
    const start = new Date('2026-09-30T12:00:00Z');
    const end = new Date('2026-10-01T12:00:00Z');
    stripe.paymentIntents.list.mockResolvedValue({
      data: [{
        id: 'pi_new', amount: 5000, currency: 'usd', status: 'succeeded',
        created: Math.floor((NOW.getTime() - 10 * 60 * 1000) / 1000),
        metadata: { oxsteed_credit_topup_id: 'topup-new' },
      }],
      has_more: false,
    });

    const { runs } = await reconcile({ periodStart: start, periodEnd: end });
    const run = runs[0];
    expect(run.status).toBe('matched');
    expect(run.topupsMissingInLedger).toBe(0);
    expect(run.metadata.pending).toHaveLength(1);
    expect(run.metadata.pending[0].kind).toBe('topup_pending');
    expect(recordException).not.toHaveBeenCalled();
    expect(recordIncident).not.toHaveBeenCalled();
  });

  test('small amount shortfall is a non-material mismatch with no freeze', async () => {
    db.topups = [baseTopup()];
    stripe.paymentIntents.retrieve.mockResolvedValue({
      id: 'pi_1', amount: 4900, currency: 'usd', status: 'succeeded',
    });

    const { runs } = await reconcile();
    const run = runs[0];
    expect(run.status).toBe('mismatch');
    expect(run.material).toBe(false);
    expect(freezeCreditRail).not.toHaveBeenCalled();
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'oxsteed_credit_external_reconciliation_mismatch',
      severity: 'warning',
    }));
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warning' }));
  });
});

describe('payout OUT checks', () => {
  const matchedTransfer = {
    id: 'tr_1', amount: 9000, currency: 'usd', reversed: false,
    destination: 'acct_dest', metadata: { oxsteed_credit_settlement_id: 'settle-1' },
  };

  beforeEach(() => {
    db.settlements = [baseSettlement()];
    db.journalByRef = {
      'settle-1': { id: 'tx-1', status: 'posted' },
    };
    stripe.transfers.retrieve.mockResolvedValue(matchedTransfer);
  });

  test('paid settlement with matching transfer and journal is matched', async () => {
    const { runs, errors } = await reconcile();
    expect(errors).toHaveLength(0);
    const run = runs[0];
    expect(run.status).toBe('matched');
    expect(run.payoutsChecked).toBe(1);
    expect(run.payoutsMatched).toBe(1);
    expect(freezeCreditRail).not.toHaveBeenCalled();
  });

  test('settlement whose transfer is gone from Stripe is a material missing_in_stripe', async () => {
    stripe.transfers.retrieve.mockRejectedValue(
      Object.assign(new Error('No such transfer'), { code: 'resource_missing' })
    );

    const { runs } = await reconcile();
    const run = runs[0];
    expect(run.status).toBe('mismatch');
    expect(run.material).toBe(true);
    expect(run.payoutsMissingInStripe).toBe(1);
    expect(run.freezeEngaged).toBe(true);
    expect(freezeCreditRail).toHaveBeenCalledWith(expect.objectContaining({ systemEngaged: true }));
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'credit-settlement:settle-1:missing_in_stripe',
      severity: 'critical',
    }));
  });

  test('reversed transfer is a material reversed_in_stripe finding', async () => {
    stripe.transfers.retrieve.mockResolvedValue({ ...matchedTransfer, reversed: true });

    const { runs } = await reconcile();
    const run = runs[0];
    expect(run.status).toBe('mismatch');
    expect(run.material).toBe(true);
    expect(run.payoutsReversedInStripe).toBe(1);
    expect(freezeCreditRail).toHaveBeenCalled();
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'credit-settlement:settle-1:reversed_in_stripe',
      severity: 'critical',
    }));
  });

  test('paid settlement with no posted journal leg is a structural material finding', async () => {
    db.journalByRef = {};

    const { runs } = await reconcile();
    const run = runs[0];
    expect(run.payoutsMatched).toBe(1);
    expect(run.status).toBe('mismatch');
    expect(run.material).toBe(true);
    expect(freezeCreditRail).toHaveBeenCalled();
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'credit-settlement:settle-1:missing_journal',
      severity: 'critical',
    }));
  });
});

describe('partner payable checks', () => {
  test('partner whose approved-unpaid exceeds the payable balance is material', async () => {
    db.partners = [{
      partner_id: 7, currency_code: 'USD', account_type: 'partner_payable',
      balance_cents: 1000, committed_unpaid_cents: 5000,
    }];

    const { runs } = await reconcile();
    const run = runs[0];
    expect(run.status).toBe('mismatch');
    expect(run.partnerChecks).toBe(1);
    expect(run.partnerMismatches).toBe(1);
    expect(run.material).toBe(true);
    expect(run.freezeEngaged).toBe(true);
    expect(freezeCreditRail).toHaveBeenCalled();
    expect(recordException).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'credit-partner:7:over_committed',
      severity: 'critical',
    }));
  });

  test('partner with sufficient payable balance is clean', async () => {
    db.partners = [{
      partner_id: 7, currency_code: 'USD', account_type: 'partner_payable',
      balance_cents: 8000, committed_unpaid_cents: 5000,
    }];

    const { runs } = await reconcile();
    const run = runs[0];
    expect(run.status).toBe('matched');
    expect(run.partnerChecks).toBe(1);
    expect(run.partnerMismatches).toBe(0);
    expect(freezeCreditRail).not.toHaveBeenCalled();
  });
});

describe('period scoping', () => {
  test('out-of-period entries are excluded from the reconciliation', async () => {
    db.topups = [
      baseTopup(),
      baseTopup({ id: 'topup-old', stripe_payment_intent_id: 'pi_old', created_at: new Date('2026-09-29T10:00:00Z') }),
      baseTopup({ id: 'topup-flagged', stripe_payment_intent_id: 'pi_flagged', status: 'requires_attention', created_at: new Date('2026-09-01T10:00:00Z') }),
    ];
    stripe.paymentIntents.retrieve.mockImplementation(async (id) => ({
      id, amount: 5000, currency: 'usd', status: 'succeeded',
    }));
    db.settlements = [
      baseSettlement(),
      baseSettlement({ id: 'settle-old', stripe_transfer_id: 'tr_old', paid_at: new Date('2026-09-28T10:00:00Z') }),
    ];
    db.journalByRef = {
      'settle-1': { id: 'tx-1', status: 'posted' },
    };
    stripe.transfers.retrieve.mockImplementation(async (id) => ({
      id, amount: 9000, currency: 'usd', reversed: false, destination: 'acct_dest',
      metadata: { oxsteed_credit_settlement_id: 'settle-1' },
    }));

    const { runs } = await reconcile();
    const run = runs[0];
    // in-period completed + always-included requires_attention; the
    // 2026-09-29 completed top-up is out of the window.
    expect(run.topupsChecked).toBe(2);
    expect(run.topupsMatched).toBe(2);
    // only the in-period paid settlement counts.
    expect(run.payoutsChecked).toBe(1);
    expect(run.status).toBe('matched');
  });

  test('manual trigger rejects periods wider than 31 days', async () => {
    await expect(triggerExternalReconciliation({
      periodStart: '2026-01-01T00:00:00Z',
      periodEnd: '2026-10-01T00:00:00Z',
      currencyCode: 'USD',
      actorUserId: 'admin-1',
      reason: 'oversized manual window',
      getStripe: () => stripe,
    })).rejects.toMatchObject({ statusCode: 400, code: 'credit_recon_period_too_wide' });
    expect(stripe.paymentIntents.list).not.toHaveBeenCalled();
  });
});

describe('operator freeze behavior', () => {
  beforeEach(() => {
    openFreeze = {
      id: 'freeze-1',
      reason: 'material external reconciliation mismatch (USD)',
      metadata: { incidentRef: 'oxsteed-credit-external-reconciliation:material:USD' },
      engaged_by: 'system:external-reconciliation',
      engaged_at: new Date('2026-10-01T02:00:00Z'),
      cleared_at: null,
    };
  });

  test('material freeze blocks money initiation with 503 but lets webhook completions proceed', async () => {
    await expect(assertCreditRailEnabled(pool, {})).rejects.toMatchObject({
      statusCode: 503,
      code: 'credit_rail_frozen',
    });
    await expect(assertCreditRailEnabled(pool, { bypassFreeze: true })).resolves.toBeUndefined();
  });

  test('admin unfreeze clears the freeze and records an audit event', async () => {
    const cleared = await unfreezeCreditRail({
      reason: 'verified manually',
      actorUserId: 'admin-1',
      correlationId: 'corr-1',
      requestIp: '127.0.0.1',
    });
    expect(cleared.cleared).toBe(true);
    expect(cleared.replayed).toBe(false);

    const auditCalls = mockQuery.mock.calls.filter(([sql]) => sql.includes('INSERT INTO oxsteed_credit_audit_events'));
    expect(auditCalls.length).toBeGreaterThan(0);
    expect(auditCalls[0][1]).toContain('credit.rail.unfrozen');

    await expect(assertCreditRailEnabled(pool, {})).resolves.toBeUndefined();
  });

  test('unfreeze with no open freeze is a replayed no-op', async () => {
    openFreeze = null;
    const result = await unfreezeCreditRail({ reason: 'nothing to clear', actorUserId: 'admin-1' });
    expect(result.cleared).toBe(false);
    expect(result.replayed).toBe(true);
  });
});

describe('scheduled job', () => {
  test('rail disabled: job skips cleanly without locking or heartbeats', async () => {
    isCreditRailEnabled.mockResolvedValue(false);

    const result = await runOxsteedCreditExternalReconciliation({ now: NOW });
    expect(result.skipped).toBe('rail_disabled');
    expect(result.locked).toBe(false);
    expect(withJobLock).not.toHaveBeenCalled();
    expect(recordIncident).not.toHaveBeenCalled();
    expect(recordOxsteedCreditWorkerRun).not.toHaveBeenCalled();
  });

  test('stripe client unavailable: run fails with a critical incident and no freeze', async () => {
    const result = await runOxsteedCreditExternalReconciliation({
      now: NOW,
      currencyCodes: ['USD'],
      getStripe: () => null,
    });

    expect(result.locked).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toMatch(/Stripe is unavailable/);
    expect(result.runs[0].status).toBe('failed');
    expect(result.runs[0].errorMessage).toMatch(/Stripe is unavailable/);
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      type: 'oxsteed_credit_external_reconciliation_failed',
      severity: 'critical',
    }));
    expect(freezeCreditRail).not.toHaveBeenCalled();
    expect(withJobLock).toHaveBeenCalled();
    expect(recordOxsteedCreditWorkerRun).toHaveBeenCalled();
  });
});
