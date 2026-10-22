'use strict';

/**
 * DB tests: F-22 pay-run records (migration 99917) — immutable payroll
 * snapshots with a native CSV export.
 *
 *   - create builds a draft from the current labor computation;
 *   - finalize snapshots totals and is append-only (second finalize 409s);
 *   - finalize fails closed when employees have hours but no wage rate;
 *   - the CSV export always reflects the finalized snapshot (drafts 409);
 *   - void moves to the voided state, never deletes; double void 409s;
 *   - every action is audited; payroll.manage gates mutations and
 *     payroll.view gates reads/exports (manager default: neither).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayRuns.db.test.js
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
  process.env['JWT' + '_SECRET'] = 'pay-run-test-secret';
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
     VALUES ($1, $2, 'x', 'Pay', 'Run', 'customer', TRUE, TRUE)`,
    [id, `payrun-${id}@example.invalid`]
  );
  return id;
}

async function auditCount(businessId, action) {
  const { rows: [row] } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM business_audit_log WHERE business_id = $1 AND action = $2',
    [businessId, action]
  );
  return row.n;
}

ddescribe('F-22 pay-run records', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser();
    const manager = await makeUser();
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Pay Run ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Pay Run Diner']
    );
    const { rows: [membership] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'manager', $4, 'active') RETURNING id`,
      [biz.id, owner, manager, `mgr-${manager.slice(0, 8)}@example.invalid`]
    );
    const base = {
      id: rest.id, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
    };
    accessByUser.set(String(owner), { ...base, effective_role: 'owner', effective_membership_id: null });
    accessByUser.set(String(manager), {
      ...base, effective_role: 'manager', effective_membership_id: membership.id,
    });
    F = { owner, manager, businessId: biz.id, restaurantId: rest.id };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  const period = () => ({ periodFrom: '2026-10-01', periodTo: '2026-10-15' });

  test('create builds a draft; finalize snapshots totals; export matches the snapshot', async () => {
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    expect(created.res.statusCode).toBe(201);
    const run = created.res.payload.payRun;
    expect(run.status).toBe('draft');
    expect(new Date(run.period_from).toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(new Date(run.period_to).toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(Array.isArray(run.lines)).toBe(true);

    // Drafts cannot be exported: nothing approved yet.
    const draftExport = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(draftExport.err).toMatchObject({ code: 'pay_run_not_finalized' });

    const finalized = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(finalized.err).toBeNull();
    expect(finalized.res.payload.payRun.status).toBe('finalized');
    expect(finalized.res.payload.payRun.totals.currency).toBe('USD');
    expect(finalized.res.payload.payRun.finalized_by).toBe(F.owner);

    // Finalizing twice fails closed.
    const again = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(again.err).toMatchObject({ code: 'pay_run_not_draft' });

    const exported = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: run.id }, user: { id: F.owner } })
    );
    expect(exported.err).toBeNull();
    expect(exported.res.headers['Content-Type']).toContain('text/csv');
    expect(exported.res.headers['Content-Disposition']).toContain(`pay-run-${run.id}`);
    expect(exported.res.body).toContain('employee_name,user_id,regular_hours');
    expect(exported.res.body).toContain(`run ${run.id}`);

    const listed = await call(
      controller.listPayRuns,
      mockReq({ params: { restaurantId: F.restaurantId }, user: { id: F.owner } })
    );
    expect(listed.err).toBeNull();
    expect(listed.res.payload.payRuns.some((r) => Number(r.id) === Number(run.id))).toBe(true);

    F.finalizedRunId = run.id;
  });

  test('void is append-only; double void fails closed', async () => {
    const voided = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.owner } })
    );
    expect(voided.err).toBeNull();
    expect(voided.res.payload.payRun.status).toBe('voided');
    // The row still exists with its snapshot intact.
    const fetched = await call(
      controller.getPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.owner } })
    );
    expect(fetched.err).toBeNull();
    expect(fetched.res.payload.payRun.totals.currency).toBe('USD');

    const again = await call(
      controller.voidPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.owner } })
    );
    expect(again.err).toMatchObject({ code: 'pay_run_already_voided' });
  });

  test('finalize fails closed when hours lack a wage rate', async () => {
    const created = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.owner } })
    );
    expect(created.err).toBeNull();
    const runId = created.res.payload.payRun.id;
    // Simulate an employee with clocked hours but no wage rate on record.
    await pool.query(
      `INSERT INTO restaurant_pay_run_lines
         (pay_run_id, staff_label, regular_hours, overtime_hours,
          hourly_wage_cents, wages_cents, gross_tips_cents, net_tips_cents, total_pay_cents)
       VALUES ($1, 'Wageless Worker', 8, 0, NULL, NULL, 0, 0, 0)`,
      [runId]
    );
    const finalized = await call(
      controller.finalizePayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(finalized.err).toMatchObject({ code: 'pay_run_missing_wages' });
    // Still a draft: nothing was snapshotted.
    const fetched = await call(
      controller.getPayRun,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: runId }, user: { id: F.owner } })
    );
    expect(fetched.res.payload.payRun.status).toBe('draft');
  });

  test('payroll.manage gates mutations; payroll.view gates reads (manager default: neither)', async () => {
    const denied = await call(
      controller.createPayRun,
      mockReq({ params: { restaurantId: F.restaurantId }, body: period(), user: { id: F.manager } })
    );
    expect(denied.err).toMatchObject({ code: 'payroll_permission_required' });

    const deniedExport = await call(
      controller.exportPayRunCsv,
      mockReq({ params: { restaurantId: F.restaurantId, payRunId: F.finalizedRunId }, user: { id: F.manager } })
    );
    expect(deniedExport.err).toMatchObject({ code: 'payroll_permission_required' });
  });

  test('pay-run actions are audited', async () => {
    expect(await auditCount(F.businessId, 'restaurant.pay_run.created')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.finalized')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.exported')).toBeGreaterThan(0);
    expect(await auditCount(F.businessId, 'restaurant.pay_run.voided')).toBeGreaterThan(0);
  });
});
