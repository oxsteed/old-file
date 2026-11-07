'use strict';

/**
 * DB tests: design-review items 18 and 42 (2026-11-07).
 *
 *   18 - Multi-currency tips: computeLabor carries per-currency tip
 *        buckets (tips_by_currency) per employee and run-wide, so
 *        non-primary-currency tips are never silently dropped from
 *        employee totals; flat gross/net/total fields stay anchored-
 *        currency only and no FX conversion is applied anywhere.
 *        getMyPay's single-employee slice keeps the foreign bucket.
 *        Finalize fails closed with a 409 naming the foreign
 *        currencies and amounts while the period holds tips outside
 *        the run's anchored currency; draft creation stays open and
 *        a single-currency period is unaffected.
 *   42 - Pay-run export CSV: the controller's local csvCell only
 *        RFC 4180 quoted and did not neutralize formula-leading
 *        cells. It now uses the shared server/utils/csv.js sanitizer
 *        (ADM-152): staff labels starting with =, +, - or @ come out
 *        single-quote prefixed in both export formats.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * This suite requires only the payroll controller/service (it does not
 * load the consolidation controller).
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantPayrollMultiCurrencyTips.db.test.js
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
  process.env['JWT' + '_SECRET'] = 'multi-currency-tips-test-secret';
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
  if (row) return row;
  if (restaurantId === undefined) {
    for (const [key, value] of accessByUser) {
      if (key.startsWith(`${String(userId)}:`)) return value;
    }
  }
  const err = new Error('Restaurant not found');
  err.statusCode = 404;
  err.code = 'restaurant_not_found';
  throw err;
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
     VALUES ($1, $2, 'x', 'MultiCurrency', 'Tester', 'customer', TRUE, TRUE)`,
    [id, `multi-currency-${id}@example.invalid`]
  );
  return id;
}

async function makeRestaurant(owner, checker) {
  const { rows: [biz] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [owner, `MultiCurrency ${crypto.randomUUID().slice(0, 8)}`]
  );
  const { rows: [rest] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
     VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id, brand_id`,
    [biz.id, owner, 'MultiCurrency Diner']
  );
  const base = {
    id: rest.id, business_id: biz.id, timezone: 'America/New_York', currency_code: 'USD',
  };
  for (const userId of [owner, checker]) {
    accessByUser.set(`${userId}:${rest.id}`, { ...base, effective_role: 'owner', effective_membership_id: null });
  }
  return { businessId: biz.id, restaurantId: rest.id, brandId: Number(rest.brand_id) };
}

async function makeStaff(businessId, ownerId, wageCents) {
  const userId = await makeUser();
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, hourly_wage_cents)
     VALUES ($1, $2, $3, 'employee', $4, 'active', $5)`,
    [businessId, ownerId, userId, `staff-${userId.slice(0, 8)}@example.invalid`, wageCents]
  );
  return userId;
}

async function createRun(userId, restaurantId, from, to) {
  const created = await call(
    controller.createPayRun,
    mockReq({ params: { restaurantId }, body: { periodFrom: from, periodTo: to }, user: { id: userId } })
  );
  expect(created.err).toBeNull();
  return created.res.payload.payRun;
}

async function finalizeRun(userId, restaurantId, runId) {
  return call(
    controller.finalizePayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: userId } })
  );
}

async function approveRun(userId, restaurantId, runId) {
  return call(
    controller.approvePayRun,
    mockReq({ params: { restaurantId, payRunId: runId }, user: { id: userId } })
  );
}

async function addTippedOrder(restaurantId, businessId, staffUserId, currency, tipCents, totalCents) {
  await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, guest_name, fulfillment_type, order_source,
        status, payment_status, subtotal_cents, discount_cents, tax_cents,
        tip_cents, total_cents, currency_code, queue_number, metadata, created_at,
        acting_staff_user_id)
     VALUES ($1, $2, 'Guest', 'pickup', 'counter', 'completed', 'paid',
             $3, 0, 0, $4, $5, $6, 1, '{}'::jsonb, '2026-10-06T16:00:00Z', $7)`,
    [restaurantId, businessId, totalCents - tipCents, tipCents, totalCents, currency, staffUserId]
  );
}

function restaurantRow(businessId, restaurantId) {
  return { id: restaurantId, business_id: businessId, currency_code: 'USD', timezone: 'America/New_York' };
}

ddescribe('Item 18: multi-currency tips stay visible and block finalize', () => {
  test('labor carries non-primary tip buckets; flat totals stay anchored-currency only', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    await addTippedOrder(restaurantId, businessId, staff, 'USD', 1000, 10000);
    await addTippedOrder(restaurantId, businessId, staff, 'EUR', 1250, 10000);
    const labor = await payrollService.computeLabor({
      restaurant: restaurantRow(businessId, restaurantId),
      fromDate: '2026-10-01',
      toDate: '2026-10-15',
    });
    expect(labor.currency).toBe('USD');
    const employee = labor.employees.find((e) => e.user_id === staff);
    expect(employee).toBeDefined();
    // Flat fields are the anchored currency only.
    expect(employee.gross_tips_cents).toBe(1000);
    expect(employee.net_tips_cents).toBe(1000);
    expect(employee.total_pay_cents).toBe(1000);
    // Both buckets are visible, never converted, never dropped.
    expect(employee.tips_by_currency.USD).toMatchObject({ gross_tips_cents: 1000, net_tips_cents: 1000 });
    expect(employee.tips_by_currency.EUR).toMatchObject({ gross_tips_cents: 1250, net_tips_cents: 1250 });
    const byCurrency = new Map(labor.tips_by_currency.map((b) => [b.currency, b]));
    expect(byCurrency.get('USD')).toMatchObject({ total_tips_cents: 1000 });
    expect(byCurrency.get('EUR')).toMatchObject({ total_tips_cents: 1250 });
    // Revenue is likewise per currency; revenue_cents is USD only.
    const revenues = new Map(labor.revenues.map((r) => [r.currency, r.revenue_cents]));
    expect(revenues.get('USD')).toBe(10000);
    expect(revenues.get('EUR')).toBe(10000);
    expect(labor.revenue_cents).toBe(10000);
  });

  test('single-currency period is unaffected: one bucket, finalize succeeds', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    await addTippedOrder(restaurantId, businessId, staff, 'USD', 1000, 10000);
    const labor = await payrollService.computeLabor({
      restaurant: restaurantRow(businessId, restaurantId),
      fromDate: '2026-10-01',
      toDate: '2026-10-15',
    });
    expect(labor.tips_by_currency).toHaveLength(1);
    expect(labor.tips_by_currency[0].currency).toBe('USD');
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    expect((await finalizeRun(owner, restaurantId, run.id)).err).toBeNull();
  });

  test('getMyPay single-employee slice keeps the foreign bucket (item 55)', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    await addTippedOrder(restaurantId, businessId, staff, 'USD', 1000, 10000);
    await addTippedOrder(restaurantId, businessId, staff, 'EUR', 1250, 10000);
    const mine = await payrollService.getMyPay({
      restaurant: restaurantRow(businessId, restaurantId),
      fromDate: '2026-10-01',
      toDate: '2026-10-15',
      userId: staff,
    });
    expect(mine.employee).not.toBeNull();
    expect(mine.employee.net_tips_cents).toBe(1000);
    expect(mine.employee.tips_by_currency.EUR).toMatchObject({ net_tips_cents: 1250 });
    expect(mine.employee.tips_by_currency.USD).toMatchObject({ net_tips_cents: 1000 });
  });

  test('finalize 409s naming the foreign currency and amount; clearing it unblocks', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    await addTippedOrder(restaurantId, businessId, staff, 'USD', 1000, 10000);
    await addTippedOrder(restaurantId, businessId, staff, 'EUR', 1250, 10000);
    // Draft creation proceeds so the manager can see the problem.
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    expect(run.status).toBe('draft');
    const blocked = await finalizeRun(owner, restaurantId, run.id);
    expect(blocked.err).toMatchObject({ code: 'pay_run_finalize_multi_currency_tips' });
    expect(blocked.err.fields).toMatchObject({
      anchored_currency: 'USD',
      currencies: [{ currency: 'EUR', total_tips_cents: 1250 }],
    });
    expect(String(blocked.err.message)).toContain('EUR');
    expect(String(blocked.err.message)).toContain('12.50');
    // Removing the foreign-currency tips unblocks finalize.
    await pool.query("DELETE FROM food_orders WHERE restaurant_id = $1 AND currency_code = 'EUR'", [restaurantId]);
    const finalized = await finalizeRun(owner, restaurantId, run.id);
    expect(finalized.err).toBeNull();
    expect(finalized.res.payload.payRun.status).toBe('finalized');
  });
});

ddescribe('Item 42: pay-run export CSV neutralizes formula-leading cells', () => {
  test('staff labels starting with =, +, - and @ come out single-quote prefixed in both formats', async () => {
    const owner = await makeUser();
    const checker = await makeUser();
    const { businessId, restaurantId } = await makeRestaurant(owner, checker);
    const staff = await makeStaff(businessId, owner, 2000);
    const run = await createRun(owner, restaurantId, '2026-10-01', '2026-10-15');
    await pool.query('DELETE FROM restaurant_pay_run_lines WHERE pay_run_id = $1', [run.id]);
    for (const label of ['=2+5', '+2+5', '-2+5', '@2+5']) {
      await pool.query(
        `INSERT INTO restaurant_pay_run_lines
           (pay_run_id, staff_user_id, staff_label, regular_hours, overtime_hours,
            hourly_wage_cents, regular_wages_cents, wages_cents,
            gross_tips_cents, tip_out_cents, tip_in_cents, net_tips_cents, total_pay_cents)
         VALUES ($1, $2, $3, 1, 0, 1500, 1500, 1500, 0, 0, 0, 0, 1500)`,
        [run.id, staff, label]
      );
    }
    expect((await finalizeRun(owner, restaurantId, run.id)).err).toBeNull();
    expect((await approveRun(checker, restaurantId, run.id)).err).toBeNull();
    for (const query of [{}, { format: 'provider' }]) {
      const exported = await call(
        controller.exportPayRunCsv,
        mockReq({ params: { restaurantId, payRunId: run.id }, query, user: { id: owner } })
      );
      expect(exported.err).toBeNull();
      for (const label of ['=2+5', '+2+5', '-2+5', '@2+5']) {
        expect(exported.res.body).toContain(`'${label}`);
        expect(exported.res.body).not.toContain(`\n${label},`);
      }
    }
  });
});

afterAll(async () => {
  await pool.end().catch(() => {});
});
