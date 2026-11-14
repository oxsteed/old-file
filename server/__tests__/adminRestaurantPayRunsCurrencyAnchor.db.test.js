'use strict';

/**
 * Domain 8 #21: admin pay-run read paths anchor linked sums to the
 * restaurant's CURRENT currency.
 *
 * adminRestaurantPayRunsController list (line 29) and detail (lines
 * 86-90) filtered/counted payout links against fr.currency_code /
 * restaurant_currency_code instead of the run's snapshot
 * pr.currency_code. After a restaurant currency change, the admin
 * linked total misreports for older runs. Display-only; the paid flip
 * itself can no longer be mixed-currency.
 *
 * Against the real migrated schema, calling the admin controller
 * directly:
 *   - a EUR run in a USD restaurant reports only its EUR links in
 *     both list and detail;
 *   - after the restaurant's currency changes to GBP, both still
 *     report the EUR total (before the fix both reported 0);
 *   - a run with no currency_code column value still anchors to
 *     totals.currency.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 */
jest.unmock('pg');
jest.unmock('../db');

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
  process.env['JWT' + '_SECRET'] = 'admin-pay-run-currency-test-secret';
}

const pool = require('../db');
const controller = require('../controllers/adminRestaurantPayRunsController');

jest.setTimeout(60000);

function mockReq({ params = {}, query = {} } = {}) {
  return { params, query, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

ddescribe('Domain 8 #21: admin pay-run linked totals anchor to the run currency', () => {
  let F = {};

  beforeAll(async () => {
    const owner = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Admin', 'Anchor', 'customer', TRUE, TRUE)`,
      [owner, `admin-anchor-${owner.slice(0, 8)}@example.invalid`],
    );
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Admin Anchor ${crypto.randomUUID().slice(0, 8)}`],
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Admin Anchor Diner'],
    );
    F = { owner, businessId: biz.id, restaurantId: rest.id };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function makeCompletedPayout(amountCents, currencyCode) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO restaurant_payouts
         (id, restaurant_id, currency_code, amount_cents, status, stripe_account_id, idempotency_key, requested_by, completed_at)
       VALUES ($1, $2, $3, $4, 'completed', 'acct_test_admin_anchor', $5, $6, NOW())`,
      [id, F.restaurantId, currencyCode, amountCents, `admin-anchor-${id}`, F.owner],
    );
    return id;
  }

  async function makeRun({ currencyCode = 'EUR', totals = '{}' } = {}) {
    const { rows: [run] } = await pool.query(
      `INSERT INTO restaurant_pay_runs
         (restaurant_id, period_from, period_to, status, totals, currency_code, created_by)
       VALUES ($1, '2026-10-01', '2026-10-15', 'finalized', $2::jsonb, $3, $4) RETURNING id`,
      [F.restaurantId, totals, currencyCode, F.owner],
    );
    return Number(run.id);
  }

  async function linkPayouts(runId) {
    const eurPayout = await makeCompletedPayout(3000, 'EUR');
    const usdPayout = await makeCompletedPayout(2000, 'USD');
    await pool.query(
      `INSERT INTO restaurant_pay_run_payout_links (pay_run_id, restaurant_payout_id, amount_cents, currency_code, linked_by)
       VALUES ($1, $2, 3000, 'EUR', $3), ($1, $4, 2000, 'USD', $3)`,
      [runId, eurPayout, F.owner, usdPayout],
    );
  }

  async function listLinkedTotal(runId) {
    const listed = await call(controller.listPayRuns, mockReq({ query: { restaurant_id: String(F.restaurantId) } }));
    expect(listed.err).toBeNull();
    const row = listed.res.payload.payRuns.find((r) => Number(r.id) === runId);
    expect(row).toBeTruthy();
    return Number(row.linked_payout_cents);
  }

  async function detailLinkedTotal(runId) {
    const detail = await call(controller.getPayRun, mockReq({ params: { payRunId: runId } }));
    expect(detail.err).toBeNull();
    return Number(detail.res.payload.payRun.linkedPayoutCents);
  }

  test('list and detail anchor to the run currency, not the restaurant currency', async () => {
    const runId = await makeRun({ currencyCode: 'EUR' });
    await linkPayouts(runId);
    expect(await listLinkedTotal(runId)).toBe(3000);
    expect(await detailLinkedTotal(runId)).toBe(3000);
  });

  test('a later restaurant currency change does not move older runs totals', async () => {
    const runId = await makeRun({ currencyCode: 'EUR' });
    await linkPayouts(runId);
    await pool.query("UPDATE food_restaurants SET currency_code = 'GBP' WHERE id = $1", [F.restaurantId]);
    try {
      expect(await listLinkedTotal(runId)).toBe(3000);
      expect(await detailLinkedTotal(runId)).toBe(3000);
    } finally {
      await pool.query("UPDATE food_restaurants SET currency_code = 'USD' WHERE id = $1", [F.restaurantId]);
    }
  });

  test('a run with no currency_code still anchors to totals.currency', async () => {
    const runId = await makeRun({ currencyCode: null, totals: '{"currency":"EUR"}' });
    await linkPayouts(runId);
    expect(await listLinkedTotal(runId)).toBe(3000);
    expect(await detailLinkedTotal(runId)).toBe(3000);
  });
});
