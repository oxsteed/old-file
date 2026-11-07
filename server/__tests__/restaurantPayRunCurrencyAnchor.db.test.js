'use strict';

/**
 * DB tests: design-review Group 7 (currency display/anchors).
 *
 *   - Finding 7: a single-store run snapshots the store's currency
 *     (labor.currency) as its one anchor; payout links and
 *     disbursements follow the run currency, never the restaurant's.
 *   - Finding 39: the pay-run list's linked total filters by run
 *     currency, agreeing with the detail view; a legacy
 *     cross-currency link is excluded from both.
 *   - Finding 57: carry-forward pricing fails visibly when no
 *     currency is configured anywhere, instead of inventing USD.
 *   - Finding 22: scheduled-report summaries format minor units in
 *     their own currency's precision (unit tests, no DB).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayRunCurrencyAnchor.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'pay-run-currency-anchor-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const pool = require('../db');
const controller = require('../controllers/restaurantPayrollController');
const payrollService = require('../services/restaurantPayrollService');
const { summarizeReport } = require('../services/restaurantScheduledReports');

jest.setTimeout(60000);

const accessByUser = new Map();
resolveRestaurantAccess.mockImplementation(async (userId, restaurantId) => {
  const row = accessByUser.get(`${userId}:${restaurantId}`) || accessByUser.get(String(userId));
  if (!row) {
    const err = new Error('Restaurant not found');
    err.statusCode = 404;
    err.code = 'restaurant_not_found';
    throw err;
  }
  return row;
});

function mockReq({ params = {}, query = {}, body = {}, user = { id: 'nobody' } } = {}) {
  return { params, query, body, user, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

async function makeUser(tag) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Anchor', $3, 'customer', TRUE, TRUE)`,
    [id, `anchor-${tag}-${id.slice(0, 8)}@example.invalid`, tag]
  );
  return id;
}

async function addOverride(membershipId, code) {
  const { rows: [p] } = await pool.query('SELECT id FROM team_permissions WHERE code = $1', [code]);
  await pool.query(
    `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
     VALUES ($1, $2, 'allow')`,
    [membershipId, p.id]
  );
}

async function makeCompletedPayout(restaurantId, userId, amountCents, currencyCode = 'USD') {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO restaurant_payouts
       (id, restaurant_id, currency_code, amount_cents, status, stripe_account_id, idempotency_key, requested_by, completed_at)
     VALUES ($1, $2, $3, $4, 'completed', 'acct_test_anchor', $5, $6, NOW())`,
    [id, restaurantId, currencyCode, amountCents, `anchor-${id}`, userId]
  );
  return id;
}

async function finalizeAndApprove(restaurantId, runId, owner, checker) {
  const finalized = await call(
    controller.finalizePayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: owner } })
  );
  expect(finalized.err).toBeNull();
  const approved = await call(
    controller.approvePayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: checker } })
  );
  expect(approved.err).toBeNull();
  expect(approved.res.payload.payRun.approved_by).toBe(checker);
}

async function stampTotal(runId, totalPayCents) {
  await pool.query(
    `UPDATE restaurant_pay_runs SET totals = jsonb_set(totals, '{total_pay_cents}', $2::jsonb) WHERE id = $1`,
    [runId, JSON.stringify(totalPayCents)]
  );
}

// Finding 22: no DB needed — the summary is a pure formatter over a
// report object.
describe('finding 22: scheduled-report summaries format minor units per currency', () => {
  test('daily close renders JPY with no decimals and BHD with three', () => {
    const text = summarizeReport('daily_close', {
      business_date: '2026-11-06',
      brand_totals: [
        { currency: 'JPY', totals: { revenue_cents: 100500 } },
        { currency: 'BHD', totals: { revenue_cents: 123456 } },
      ],
    });
    expect(text).toContain('100,500');
    expect(text).not.toContain('100500.00');
    expect(text).toContain('123.456');
    expect(text).not.toContain('1234.56');
  });

  test('labor summary renders the cost in the report currency precision', () => {
    const text = summarizeReport('labor', {
      from_date: '2026-11-01', to_date: '2026-11-07',
      total_hours: 40, labor_cost_cents: 50000, currency: 'JPY', labor_percent: 30,
    });
    expect(text).toContain('50,000');
    expect(text).not.toContain('500.00');
  });
});

ddescribe('findings 7, 39, 57: one currency anchor per pay run', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser('owner');
    const checker = await makeUser('checker');
    const storeMgr = await makeUser('mgr');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Anchor ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Anchor Diner']
    );
    const { rows: [eurStore] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code)
       VALUES ($1, $2, 'America/New_York', 'EUR') RETURNING id`,
      [rest.id, 'Anchor Paris Store']
    );
    const base = {
      id: rest.id, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
    };
    accessByUser.set(`${owner}:${rest.id}`, { ...base, effective_role: 'owner', effective_membership_id: null });
    accessByUser.set(`${checker}:${rest.id}`, { ...base, effective_role: 'owner', effective_membership_id: null });
    const { rows: [m] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active') RETURNING id`,
      [biz.id, owner, storeMgr, `anchor-sm-${storeMgr.slice(0, 8)}@example.invalid`]
    );
    for (const code of ['payroll.view', 'payroll.manage']) await addOverride(m.id, code);
    await pool.query(
      `INSERT INTO restaurant_location_memberships (membership_id, restaurant_id, location_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [m.id, rest.id, eurStore.id]
    );
    accessByUser.set(`${storeMgr}:${rest.id}`, {
      ...base, effective_role: 'manager', effective_membership_id: m.id,
    });
    F = { owner, checker, storeMgr, businessId: biz.id, restaurantId: rest.id, eurStoreId: Number(eurStore.id) };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function createEurRun() {
    const created = await call(
      controller.createPayRun,
      mockReq({
        params: { restaurantId: F.restaurantId },
        body: { periodFrom: '2026-10-01', periodTo: '2026-10-15' },
        user: { id: F.storeMgr },
      })
    );
    expect(created.err).toBeNull();
    return created.res.payload.payRun;
  }

  test('finding 7: a single-store run snapshots the store currency; settlement follows it', async () => {
    const run = await createEurRun();
    expect(run.scope).toBe('single_store');
    expect(run.locationIds).toEqual([F.eurStoreId]);
    // Before the fix the run was stamped USD (the restaurant
    // currency) while its lines were priced in EUR.
    expect(run.currencyCode).toBe('EUR');
    const { rows: [row] } = await pool.query('SELECT currency_code FROM restaurant_pay_runs WHERE id = $1', [run.id]);
    expect(row.currency_code).toBe('EUR');

    await finalizeAndApprove(F.restaurantId, run.id, F.owner, F.checker);
    await stampTotal(run.id, 5000);
    const { rows: [finalRow] } = await pool.query('SELECT totals FROM restaurant_pay_runs WHERE id = $1', [run.id]);
    expect(finalRow.totals.currency).toBe('EUR');

    const eurPayout = await makeCompletedPayout(F.restaurantId, F.owner, 5000, 'EUR');
    const linked = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: run.id },
        body: { payoutId: eurPayout },
        user: { id: F.owner },
      })
    );
    expect(linked.err).toBeNull();
    expect(linked.res.payload.payRun.status).toBe('paid');
    expect(linked.res.payload.payRun.linkedPayoutCents).toBe(5000);
    expect(linked.res.payload.payRun.payoutLinks[0].currencyCode).toBe('EUR');
  });

  test('finding 7: a payout in the restaurant currency cannot fund a foreign-currency run', async () => {
    const run = await createEurRun();
    await finalizeAndApprove(F.restaurantId, run.id, F.owner, F.checker);
    await stampTotal(run.id, 5000);
    const usdPayout = await makeCompletedPayout(F.restaurantId, F.owner, 5000, 'USD');
    const linked = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: run.id },
        body: { payoutId: usdPayout },
        user: { id: F.owner },
      })
    );
    expect(linked.err).toMatchObject({ code: 'pay_run_payout_currency_mismatch' });
  });

  test('finding 7: a disbursement is stamped in the run currency', async () => {
    const run = await createEurRun();
    await finalizeAndApprove(F.restaurantId, run.id, F.owner, F.checker);
    await stampTotal(run.id, 2500);
    const { rows: [line] } = await pool.query(
      `INSERT INTO restaurant_pay_run_lines (pay_run_id, staff_user_id, staff_label, total_pay_cents)
       VALUES ($1, $2, 'Anchor Staff', 2500) RETURNING id`,
      [run.id, F.owner]
    );
    const recorded = await call(
      controller.recordPayRunDisbursement,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: run.id },
        body: { payRunLineId: line.id, amountCents: 2500, method: 'bank_transfer' },
        user: { id: F.owner },
      })
    );
    expect(recorded.err).toBeNull();
    expect(recorded.res.payload.payRun.disbursements[0].currencyCode).toBe('EUR');
    const { rows: [dRow] } = await pool.query(
      'SELECT currency_code FROM restaurant_pay_run_disbursements WHERE pay_run_id = $1',
      [run.id]
    );
    expect(dRow.currency_code).toBe('EUR');
  });

  test('finding 39: list and detail linked totals agree and exclude a legacy cross-currency link', async () => {
    const run = await createEurRun();
    await finalizeAndApprove(F.restaurantId, run.id, F.owner, F.checker);
    await stampTotal(run.id, 5000);
    const eurPayout = await makeCompletedPayout(F.restaurantId, F.owner, 3000, 'EUR');
    const usdPayout = await makeCompletedPayout(F.restaurantId, F.owner, 2000, 'USD');
    // Legacy rows: the USD link predates the currency gate, so it is
    // inserted directly rather than through the endpoint.
    await pool.query(
      `INSERT INTO restaurant_pay_run_payout_links (pay_run_id, restaurant_payout_id, amount_cents, currency_code, linked_by)
       VALUES ($1, $2, 3000, 'EUR', $3), ($1, $4, 2000, 'USD', $3)`,
      [run.id, eurPayout, F.owner, usdPayout]
    );
    const listed = await call(
      controller.listPayRuns,
      mockReq({ params: { restaurantId: F.restaurantId }, user: { id: F.owner } })
    );
    expect(listed.err).toBeNull();
    const listedRun = listed.res.payload.payRuns.find((r) => r.id === run.id);
    expect(listedRun.linkedPayoutCents).toBe(3000);
    const detail = await call(
      controller.getPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(detail.err).toBeNull();
    expect(detail.res.payload.payRun.linkedPayoutCents).toBe(3000);
  });

  test('finding 57: carry-forward pricing fails visibly with no currency anywhere', async () => {
    const neverQuery = { query: () => { throw new Error('must not reach the database'); } };
    await expect(payrollService.buildCarryForwardItems(neverQuery, {
      restaurant: { id: F.restaurantId, currency_code: null },
      targetPeriodFrom: '2026-10-01',
      targetPeriodTo: '2026-10-15',
      locationIds: [F.eurStoreId],
      currency: null,
      wagesByUser: new Map(),
    })).rejects.toMatchObject({ code: 'restaurant_currency_missing' });
  });
});
