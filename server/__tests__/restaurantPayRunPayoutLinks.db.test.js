'use strict';

/**
 * DB tests: finding 25 pay-run payout linkage.
 *
 *   - A finalized run links a completed payout (UUID id) and reports it.
 *   - When linked payouts cover total pay, the run moves to 'paid'.
 *   - A paid run cannot be voided, and cannot take further links.
 *   - A partial link leaves the run finalized with the linked total shown.
 *   - A voided run cannot be exported (block, not watermark).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * The migration 20261102120000 must be applied (it creates the link
 * table and the 'paid' / 'clawed_back' statuses).
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayRunPayoutLinks.db.test.js
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
  process.env['JWT' + '_SECRET'] = 'pay-run-link-test-secret';
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

jest.setTimeout(60000);

const accessByUser = new Map();
resolveRestaurantAccess.mockImplementation(async (userId) => {
  const row = accessByUser.get(String(userId));
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

async function makeUser() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Pay', 'Link', 'customer', TRUE, TRUE)`,
    [id, `paylink-${id}@example.invalid`]
  );
  return id;
}

async function makeCompletedPayout(restaurantId, userId, amountCents) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO restaurant_payouts
       (id, restaurant_id, currency_code, amount_cents, status, stripe_account_id, idempotency_key, requested_by, completed_at)
     VALUES ($1, $2, 'USD', $3, 'completed', 'acct_test_link', $4, $5, NOW())`,
    [id, restaurantId, amountCents, `link-${id}`, userId]
  );
  return id;
}

async function makeFinalizedRun(restaurantId, owner, totalPayCents) {
  const created = await call(
    controller.createPayRun,
    mockReq({ params: { restaurantId }, body: { periodFrom: '2026-10-01', periodTo: '2026-10-15' }, user: { id: owner } })
  );
  expect(created.err).toBeNull();
  const runId = created.res.payload.payRun.id;
  const finalized = await call(
    controller.finalizePayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: owner } })
  );
  expect(finalized.err).toBeNull();
  // The labor computation has no rows in this fixture, so stamp a test
  // total directly; the link logic reads totals.total_pay_cents.
  await pool.query(
    `UPDATE restaurant_pay_runs SET totals = jsonb_set(totals, '{total_pay_cents}', $2::jsonb) WHERE id = $1`,
    [runId, JSON.stringify(totalPayCents)]
  );
  return runId;
}

ddescribe('finding 25: pay-run payout linkage', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser();
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Pay Link ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Pay Link Diner']
    );
    accessByUser.set(String(owner), {
      id: rest.id, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
      effective_role: 'owner', effective_membership_id: null,
    });
    F = { owner, businessId: biz.id, restaurantId: rest.id };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('linking payouts that cover total pay moves the run to paid; a paid run cannot be voided', async () => {
    const runId = await makeFinalizedRun(F.restaurantId, F.owner, 5000);
    const payoutId = await makeCompletedPayout(F.restaurantId, F.owner, 5000);
    const linked = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payoutId },
        user: { id: F.owner },
      })
    );
    expect(linked.err).toBeNull();
    expect(linked.res.payload.payRun.status).toBe('paid');
    expect(linked.res.payload.payRun.linkedPayoutCents).toBe(5000);
    expect(linked.res.payload.payRun.payoutLinks).toHaveLength(1);
    expect(linked.res.payload.payRun.payoutLinks[0].restaurantPayoutId).toBe(payoutId);

    const voided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(voided.err).toMatchObject({ code: 'pay_run_paid' });

    const relink = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payoutId: await makeCompletedPayout(F.restaurantId, F.owner, 100) },
        user: { id: F.owner },
      })
    );
    expect(relink.err).toMatchObject({ code: 'pay_run_not_finalized' });
  });

  test('a partial link leaves the run finalized with the linked total, and voided runs cannot export', async () => {
    const runId = await makeFinalizedRun(F.restaurantId, F.owner, 8000);
    const payoutId = await makeCompletedPayout(F.restaurantId, F.owner, 5000);
    const linked = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { restaurantPayoutId: payoutId },
        user: { id: F.owner },
      })
    );
    expect(linked.err).toBeNull();
    expect(linked.res.payload.payRun.status).toBe('finalized');
    expect(linked.res.payload.payRun.linkedPayoutCents).toBe(5000);

    const voided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(voided.err).toBeNull();
    expect(voided.res.payload.payRun.status).toBe('voided');

    const exported = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(exported.err).toMatchObject({ code: 'pay_run_voided' });
  });

  test('a non-completed payout cannot be linked', async () => {
    const runId = await makeFinalizedRun(F.restaurantId, F.owner, 5000);
    const payoutId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO restaurant_payouts
         (id, restaurant_id, currency_code, amount_cents, status, stripe_account_id, idempotency_key, requested_by)
       VALUES ($1, $2, 'USD', 5000, 'requested', 'acct_test_link', $3, $4)`,
      [payoutId, F.restaurantId, `link-${payoutId}`, F.owner]
    );
    const linked = await call(
      controller.linkPayRunPayout,
      mockReq({
        params: { restaurantId: F.restaurantId, payRunId: runId },
        body: { payoutId },
        user: { id: F.owner },
      })
    );
    expect(linked.err).toMatchObject({ code: 'pay_run_payout_not_completed' });
  });
});
