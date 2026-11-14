'use strict';

/**
 * DB tests: money-flows audit 2026-11-07, R6.
 *
 * Declared cash tips are currency-less by schema, so they used to be
 * bucketed under the restaurant currency and silently vanished from a
 * single-store run priced in a location currency. The fix resolves
 * the declaring location's currency at read time (the location
 * stamped on the declaration) and buckets cash tips by it — no new
 * column: Domain 8 #10 owns the currency_code column on its own
 * branch (migration 20261113184500), and a second ADD COLUMN here
 * would collide at deploy if both branches merge. Both resolutions
 * agree (that migration backfills from the same source), so this
 * path is correct whether or not the column exists.
 *
 *   - A cash tip declared at a EUR store reaches the single-store
 *     EUR run under a USD restaurant, and that run finalizes.
 *   - The same tip is excluded from the all-store USD run's flat
 *     totals, stays visible in its EUR bucket, and finalize fails
 *     closed naming EUR.
 *   - A late-confirmed EUR tip carries only into a later EUR run,
 *     never into a USD run (same guard as late premiums).
 *   - A late EUR premium carries into a EUR run and stays behind
 *     for a USD run (pins the R5 wiring the premium guard relies
 *     on; a foreign-currency premium needs a run in its own
 *     currency, documented in code — no FX conversion).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayrollCashTipCurrency.db.test.js
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
  process.env['JWT' + '_SECRET'] = 'cash-tip-currency-test-secret';
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

jest.setTimeout(60000);

const accessByUser = new Map();
resolveRestaurantAccess.mockImplementation(async (userId, restaurantId) => {
  const row = accessByUser.get(`${String(userId)}:${restaurantId}`);
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
     VALUES ($1, $2, 'x', 'CashTip', $3, 'customer', TRUE, TRUE)`,
    [id, `cashtip-${tag}-${id.slice(0, 8)}@example.invalid`, tag]
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

// One USD restaurant with one EUR store, a store-scoped manager for
// the EUR store, and one waged staff member.
async function makeFixture() {
  const owner = await makeUser('owner');
  const checker = await makeUser('checker');
  const storeMgr = await makeUser('mgr');
  const { rows: [biz] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [owner, `CashTip ${crypto.randomUUID().slice(0, 8)}`]
  );
  const { rows: [rest] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
     VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
    [biz.id, owner, 'CashTip Diner']
  );
  const { rows: [eurStore] } = await pool.query(
    `INSERT INTO restaurant_locations (restaurant_id, name, timezone, currency_code)
     VALUES ($1, $2, 'America/New_York', 'EUR') RETURNING id`,
    [rest.id, 'CashTip Paris Store']
  );
  const base = {
    id: rest.id, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
  };
  accessByUser.set(`${owner}:${rest.id}`, { ...base, effective_role: 'owner', effective_membership_id: null });
  accessByUser.set(`${checker}:${rest.id}`, { ...base, effective_role: 'owner', effective_membership_id: null });
  const { rows: [m] } = await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
     VALUES ($1, $2, $3, 'manager', $4, 'active') RETURNING id`,
    [biz.id, owner, storeMgr, `cashtip-sm-${storeMgr.slice(0, 8)}@example.invalid`]
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
  const staff = await makeUser('staff');
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, hourly_wage_cents)
     VALUES ($1, $2, $3, 'employee', $4, 'active', 2000)`,
    [biz.id, owner, staff, `cashtip-staff-${staff.slice(0, 8)}@example.invalid`]
  );
  return {
    owner, checker, storeMgr, staff,
    businessId: biz.id, restaurantId: rest.id, eurStoreId: Number(eurStore.id),
  };
}

async function declareTip(fixture, amountCents, businessDate) {
  const row = await payrollService.declareCashTip(fixture.restaurantId, {
    staffUserId: fixture.staff,
    businessDate,
    amountCents,
    declaredBy: fixture.owner,
    locationId: fixture.eurStoreId,
  });
  expect(row.status).toBe('confirmed');
  return row;
}

async function createRun(fixture, userId, from, to) {
  const created = await call(
    controller.createPayRun,
    mockReq({
      params: { restaurantId: fixture.restaurantId },
      body: { periodFrom: from, periodTo: to },
      user: { id: userId },
    })
  );
  expect(created.err).toBeNull();
  return created.res.payload.payRun;
}

async function finalizeRun(fixture, runId) {
  return call(
    controller.finalizePayRun,
    mockReq({ params: { restaurantId: fixture.restaurantId, payRunId: runId }, user: { id: fixture.owner } })
  );
}

function restaurantRow(fixture) {
  return { id: fixture.restaurantId, business_id: fixture.businessId, currency_code: 'USD', timezone: 'America/New_York' };
}

ddescribe('R6: declared cash tips bucket in the declaring store currency', () => {
  test('a EUR-store cash tip reaches the single-store EUR run and finalizes', async () => {
    const F = await makeFixture();
    await declareTip(F, 2500, '2026-10-06');
    const run = await createRun(F, F.storeMgr, '2026-10-01', '2026-10-15');
    expect(run.scope).toBe('single_store');
    expect(run.currencyCode).toBe('EUR');
    const line = run.lines.find((l) => l.staff_user_id === F.staff);
    expect(line).toBeDefined();
    // Before the fix the tip sat in the USD bucket, so the EUR run
    // priced it at zero and finalize 409ed on a foreign USD tip.
    expect(line.gross_tips_cents).toBe(2500);
    expect(line.net_tips_cents).toBe(2500);
    expect(line.total_pay_cents).toBe(2500);
    expect((await finalizeRun(F, run.id)).err).toBeNull();
  });

  test('the same tip is excluded from the all-store USD run and finalize names EUR', async () => {
    const F = await makeFixture();
    await declareTip(F, 2500, '2026-10-06');
    const labor = await payrollService.computeLabor({
      restaurant: restaurantRow(F),
      fromDate: '2026-10-01',
      toDate: '2026-10-15',
    });
    expect(labor.currency).toBe('USD');
    const employee = labor.employees.find((e) => e.user_id === F.staff);
    expect(employee).toBeDefined();
    expect(employee.gross_tips_cents).toBe(0);
    expect(employee.tips_by_currency.EUR).toMatchObject({ gross_tips_cents: 2500, net_tips_cents: 2500 });
    const run = await createRun(F, F.owner, '2026-10-01', '2026-10-15');
    expect(run.currencyCode).toBe('USD');
    const blocked = await finalizeRun(F, run.id);
    expect(blocked.err).toMatchObject({ code: 'pay_run_finalize_multi_currency_tips' });
    expect(blocked.err.fields).toMatchObject({
      anchored_currency: 'USD',
      currencies: [{ currency: 'EUR', total_tips_cents: 2500 }],
    });
  });

  test('a late EUR cash tip carries into a later EUR run, not into a USD run', async () => {
    const F = await makeFixture();
    await declareTip(F, 2500, '2026-10-06');
    const source = await createRun(F, F.storeMgr, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(F, source.id)).err).toBeNull();
    // Declared after finalization, dated inside the source period:
    // a late input that must ride into the next run in its currency.
    await declareTip(F, 1800, '2026-10-10');
    // The USD run is built first so it cannot hide behind the EUR
    // run's claim: it must skip the tip on currency, not on claim.
    const usdTarget = await createRun(F, F.owner, '2026-10-16', '2026-10-31');
    expect(usdTarget.currencyCode).toBe('USD');
    expect(usdTarget.lines.filter((l) => l.is_carry_forward && l.carry_forward_kind === 'cash_tip')).toHaveLength(0);
    const eurTarget = await createRun(F, F.storeMgr, '2026-10-16', '2026-10-31');
    expect(eurTarget.currencyCode).toBe('EUR');
    const carried = eurTarget.lines.filter((l) => l.is_carry_forward && l.carry_forward_kind === 'cash_tip');
    expect(carried).toHaveLength(1);
    expect(carried[0].staff_user_id).toBe(F.staff);
    expect(carried[0].gross_tips_cents).toBe(1800);
    expect(carried[0].net_tips_cents).toBe(1800);
  });

  test('a late EUR premium carries into a EUR run and stays behind for a USD run', async () => {
    const F = await makeFixture();
    const source = await createRun(F, F.storeMgr, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(F, source.id)).err).toBeNull();
    await pool.query(
      `INSERT INTO business_staff_schedule_changes
         (business_id, shift_id, user_id, restaurant_id, location_id, change_type,
          before_state, after_state, premium_due, premium_cents, premium_hours,
          premium_currency_code, changed_by, created_at)
       VALUES ($1, 1, $2, $3, $4, 'edited',
               '{"shift_date": "2026-10-08", "start_time": "09:00", "end_time": "17:00"}'::jsonb,
               '{"shift_date": "2026-10-08", "start_time": "10:00", "end_time": "17:00"}'::jsonb,
               TRUE, 1500, NULL, 'EUR', $5, NOW())`,
      [F.businessId, F.staff, F.restaurantId, F.eurStoreId, F.owner]
    );
    const usdTarget = await createRun(F, F.owner, '2026-10-16', '2026-10-31');
    expect(usdTarget.lines.filter((l) => l.is_carry_forward && l.carry_forward_kind === 'premium')).toHaveLength(0);
    const eurTarget = await createRun(F, F.storeMgr, '2026-10-16', '2026-10-31');
    const carried = eurTarget.lines.filter((l) => l.is_carry_forward && l.carry_forward_kind === 'premium');
    expect(carried).toHaveLength(1);
    expect(carried[0].staff_user_id).toBe(F.staff);
    expect(carried[0].predictability_premium_cents).toBe(1500);
  });
});

afterAll(async () => {
  await pool.end().catch(() => {});
});
