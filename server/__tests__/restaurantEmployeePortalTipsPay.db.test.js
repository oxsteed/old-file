'use strict';

/**
 * DB tests: Phase 3 Track B employee self-service tips/pay (goal
 * goal_a0fc7c0f0394) against a real migrated database.
 *
 * Proves, end to end through the payroll controller handlers:
 *   - GET tips/mine returns only the caller's own tips; a
 *     client-supplied user id in the query cannot widen the scope;
 *   - GET pay/mine returns only the caller's own labor row (hours,
 *     wages, overtime/double-time/premium lines, tips, total);
 *   - a non-member gets a 404, never another employee's numbers;
 *   - a draft pay run produces no pay stub; a finalized run produces
 *     a stub with only the caller's own line, and the stub is the
 *     immutable snapshot (later tip confirmations do not rewrite it);
 *   - a pending self-declared cash tip does not affect tip
 *     allocations or pay until a manager confirms it; a rejected one
 *     never does; the manager-only declare path stays confirmed at
 *     entry and flows into pay immediately;
 *   - an idempotent re-submit of a self-declaration replays instead
 *     of double-declaring; an employee cannot confirm their own
 *     declaration (payroll.manage required); confirming a
 *     non-pending declaration is a 409.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantEmployeePortalTipsPay.db.test.js
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPunchIntegrityPhase2.db.test.js.
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
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const pool = require('../db');
const controller = require('../controllers/restaurantPayrollController');
const payrollService = require('../services/restaurantPayrollService');

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
  return { params, query, body, user, headers: {} };
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

async function makeUser(first, last) {
  const id = crypto.randomUUID();
  const tag = crypto.randomUUID().slice(0, 8);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, $4, 'customer', TRUE, TRUE)`,
    [id, `portal-${tag}@example.invalid`, first, last]
  );
  return id;
}

async function makeBusiness(ownerId, label) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
    [ownerId, label]
  );
  return b.id;
}

async function makeRestaurant(businessId, ownerId, label) {
  const { rows: [r] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
     VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
    [businessId, ownerId, label]
  );
  return r.id;
}

async function addMember(businessId, ownerId, userId, role, { jobRole = null, wage = null } = {}) {
  const { rows: [m] } = await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, job_role, hourly_wage_cents)
     VALUES ($1, $2, $3, $4, $5, 'active', $6, $7) RETURNING id`,
    [businessId, ownerId, userId, role, `portal-member-${userId.slice(0, 8)}@example.invalid`, jobRole, wage]
  );
  return m.id;
}

function registerAccess(userId, restaurantId, businessId, role, membershipId = null) {
  accessByUser.set(String(userId), {
    id: restaurantId,
    business_id: businessId,
    effective_role: role,
    effective_membership_id: membershipId,
    timezone: 'America/New_York',
    currency_code: 'USD',
  });
}

const RANGE = { from: '2026-10-05', to: '2026-10-11' };
const LOCAL_NOON = '2026-10-06T16:00:00Z';

ddescribe('Phase 3 Track B: employee tips, pay and pay stubs', () => {
  let fx;
  let payRunId;

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const businessId = await makeBusiness(owner, 'Portal Bistro');
    const restaurantId = await makeRestaurant(businessId, owner, 'Portal Bistro');
    const server = await makeUser('Sara', 'Server');
    const cook = await makeUser('Carl', 'Cook');
    const serverMembership = await addMember(businessId, owner, server, 'employee', { jobRole: 'Server', wage: 1500 });
    const cookMembership = await addMember(businessId, owner, cook, 'employee', { jobRole: 'Cook', wage: 1800 });
    fx = { owner, businessId, restaurantId, server, cook };
    registerAccess(owner, restaurantId, businessId, 'owner');
    registerAccess(server, restaurantId, businessId, 'employee', serverMembership);
    registerAccess(cook, restaurantId, businessId, 'employee', cookMembership);

    // Hours: Sara 10h, Carl 5h, both waged (finalize fails closed on
    // missing wages, so no unwaged member in this fixture).
    await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, hours_worked) VALUES
       ($1, $2, '2026-10-06', 10), ($1, $3, '2026-10-06', 5)`,
      [businessId, server, cook]
    );
    // POS order on Sara's shift: total 48000 collected in cash, tip 2000.
    const { rows: [shift] } = await pool.query(
      'INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status) VALUES ($1, $2, \'closed\') RETURNING id',
      [restaurantId, server]
    );
    const { rows: [order] } = await pool.query(
      `INSERT INTO food_orders
         (restaurant_id, business_id, guest_name, fulfillment_type, order_source,
          status, payment_status, subtotal_cents, discount_cents, tax_cents,
          tip_cents, total_cents, currency_code, queue_number, metadata, created_at)
       VALUES ($1, $2, 'Portal Guest', 'pickup', 'counter', 'completed', 'paid',
               44000, 0, 2000, 2000, 48000, 'USD', 301, $3::jsonb, $4) RETURNING id`,
      [restaurantId, businessId, JSON.stringify({ shiftId: shift.id }), LOCAL_NOON]
    );
    await pool.query(
      `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status, created_by, created_at)
       VALUES ($1, $2, $3, 'cash', 48000, 'recorded', $4, $5)`,
      [restaurantId, order.id, shift.id, server, LOCAL_NOON]
    );
    // Online order, no shift: tip 500, unattributed.
    await pool.query(
      `INSERT INTO food_orders
         (restaurant_id, business_id, guest_name, fulfillment_type, order_source,
          status, payment_status, subtotal_cents, discount_cents, tax_cents,
          tip_cents, total_cents, currency_code, queue_number, metadata, created_at)
       VALUES ($1, $2, 'Portal Guest', 'pickup', 'counter', 'completed', 'paid',
               10000, 0, 0, 500, 10500, 'USD', 302, '{}'::jsonb, $3)`,
      [restaurantId, businessId, LOCAL_NOON]
    );
  });

  const restaurantRow = () => accessByUser.get(String(fx.owner));
  const myReq = (userId, extra = {}) => mockReq({
    params: { restaurantId: String(fx.restaurantId) },
    query: { ...RANGE },
    user: { id: userId },
    ...extra,
  });

  test('tips/mine returns only the caller’s own tips', async () => {
    const { res, err } = await call(controller.getMyTips, myReq(fx.server));
    expect(err).toBeNull();
    expect(res.payload.from_date).toBe(RANGE.from);
    expect(res.payload.currencies).toHaveLength(1);
    const usd = res.payload.currencies[0];
    expect(usd).toMatchObject({
      currency: 'USD', gross_tips_cents: 2000, tip_out_cents: 0, tip_in_cents: 0, net_tips_cents: 2000,
    });
    // The unattributed 500 belongs to nobody; it is not the caller's.
    expect(JSON.stringify(res.payload)).not.toContain(fx.cook);
  });

  test('tips/mine ignores a client-supplied user id: scope cannot be widened', async () => {
    const { res, err } = await call(controller.getMyTips, myReq(fx.cook, {
      query: { ...RANGE, user_id: fx.server, userId: fx.server, staffUserId: fx.server },
    }));
    expect(err).toBeNull();
    // Carl earned no tips: no currency row at all, not Sara's 2000.
    expect(res.payload.currencies).toEqual([]);
    expect(JSON.stringify(res.payload)).not.toContain('2000');
  });

  test('pay/mine returns only the caller’s own labor row', async () => {
    const { res, err } = await call(controller.getMyPay, myReq(fx.server));
    expect(err).toBeNull();
    expect(res.payload.currency).toBe('USD');
    expect(res.payload.employee).toMatchObject({
      user_id: fx.server, hours: 10, regular_hours: 10, overtime_hours: 0,
      doubletime_hours: 0, hourly_wage_cents: 1500, wages_cents: 15000,
      meal_break_premium_cents: 0, predictability_premium_cents: 0,
      gross_tips_cents: 2000, net_tips_cents: 2000, total_pay_cents: 17000,
    });
    expect(res.payload).not.toHaveProperty('employees');
    expect(JSON.stringify(res.payload)).not.toContain(fx.cook);
  });

  test('a non-member gets a 404, never another employee’s numbers', async () => {
    const stranger = await makeUser('Sam', 'Stranger');
    const { err } = await call(controller.getMyPay, myReq(stranger));
    expect(err).not.toBeNull();
    expect(err.statusCode).toBe(404);
    const tips = await call(controller.getMyTips, myReq(stranger));
    expect(tips.err.statusCode).toBe(404);
  });

  test('a draft pay run produces no pay stub', async () => {
    const { res, err } = await call(controller.createPayRun, mockReq({
      params: { restaurantId: String(fx.restaurantId) },
      body: { periodFrom: RANGE.from, periodTo: RANGE.to },
      user: { id: fx.owner },
    }));
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    payRunId = res.payload.payRun.id;
    expect(res.payload.payRun.status).toBe('draft');

    const listed = await call(controller.listMyPayStubs, myReq(fx.server, { query: {} }));
    expect(listed.err).toBeNull();
    expect(listed.res.payload.stubs).toEqual([]);

    const stub = await call(controller.getMyPayStub, mockReq({
      params: { restaurantId: String(fx.restaurantId), payRunId: String(payRunId) },
      user: { id: fx.server },
    }));
    expect(stub.err).not.toBeNull();
    expect(stub.err.statusCode).toBe(404);
  });

  test('a finalized run produces a stub with only the caller’s own line', async () => {
    const { err } = await call(controller.finalizePayRun, mockReq({
      params: { restaurantId: String(fx.restaurantId), payRunId: String(payRunId) },
      user: { id: fx.owner },
    }));
    expect(err).toBeNull();

    const sara = await call(controller.listMyPayStubs, myReq(fx.server, { query: {} }));
    expect(sara.err).toBeNull();
    expect(sara.res.payload.stubs).toHaveLength(1);
    expect(sara.res.payload.stubs[0]).toMatchObject({
      pay_run_id: payRunId, period_from: RANGE.from, period_to: RANGE.to,
      status: 'finalized', total_pay_cents: 17000,
    });

    const saraStub = await call(controller.getMyPayStub, mockReq({
      params: { restaurantId: String(fx.restaurantId), payRunId: String(payRunId) },
      user: { id: fx.server },
    }));
    expect(saraStub.err).toBeNull();
    expect(saraStub.res.payload.stub.pay_run.status).toBe('finalized');
    expect(saraStub.res.payload.stub.line).toMatchObject({
      regular_hours: 10, overtime_hours: 0, doubletime_hours: 0,
      wages_cents: 15000, gross_tips_cents: 2000, net_tips_cents: 2000,
      total_pay_cents: 17000,
    });
    expect(JSON.stringify(saraStub.res.payload)).not.toContain(fx.cook);

    // Carl's stub for the same run is his own line, not Sara's.
    const carlStub = await call(controller.getMyPayStub, mockReq({
      params: { restaurantId: String(fx.restaurantId), payRunId: String(payRunId) },
      user: { id: fx.cook },
    }));
    expect(carlStub.err).toBeNull();
    expect(carlStub.res.payload.stub.line.total_pay_cents).toBe(9000);
    expect(JSON.stringify(carlStub.res.payload)).not.toContain(fx.server);
  });

  test('a pending self-declared cash tip does not affect tips or pay', async () => {
    const { res, err } = await call(controller.declareMyCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId) },
      body: { date: '2026-10-06', amountCents: 3000, note: 'Table tips', idempotencyKey: 'trackb-sara-0001' },
      user: { id: fx.server },
    }));
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.payload.declaration).toMatchObject({ status: 'pending', amount_cents: 3000 });
    expect(res.payload.replayed).toBe(false);
    const declarationId = res.payload.declaration.id;

    // Visible to the employee, flagged pending...
    const mine = await call(controller.getMyTips, myReq(fx.server));
    expect(mine.err).toBeNull();
    expect(mine.res.payload.cash_tips).toHaveLength(1);
    expect(mine.res.payload.cash_tips[0]).toMatchObject({ status: 'pending', amount_cents: 3000 });
    // ...but not in the pay math.
    const allocations = await payrollService.computeTipAllocations({
      restaurant: restaurantRow(), fromDate: RANGE.from, toDate: RANGE.to,
    });
    const sara = allocations.currencies[0].employees.find((e) => e.user_id === fx.server);
    expect(sara.gross_tips_cents).toBe(2000);
    const pay = await call(controller.getMyPay, myReq(fx.server));
    expect(pay.res.payload.employee.total_pay_cents).toBe(17000);

    // Idempotent re-submit replays instead of double-declaring.
    const replay = await call(controller.declareMyCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId) },
      body: { date: '2026-10-06', amountCents: 3000, note: 'Table tips', idempotencyKey: 'trackb-sara-0001' },
      user: { id: fx.server },
    }));
    expect(replay.err).toBeNull();
    expect(replay.res.statusCode).toBe(200);
    expect(replay.res.payload.replayed).toBe(true);
    expect(replay.res.payload.declaration.id).toBe(declarationId);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM restaurant_declared_cash_tips WHERE restaurant_id = $1 AND idempotency_key = $2',
      [fx.restaurantId, 'trackb-sara-0001']
    );
    expect(rows[0].n).toBe(1);

    // The employee cannot confirm their own declaration.
    const selfConfirm = await call(controller.confirmCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId), declarationId: String(declarationId) },
      user: { id: fx.server },
    }));
    expect(selfConfirm.err).not.toBeNull();
    expect(selfConfirm.err.statusCode).toBe(403);

    // Manager confirmation puts it into pay from the next computation.
    const confirmed = await call(controller.confirmCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId), declarationId: String(declarationId) },
      user: { id: fx.owner },
    }));
    expect(confirmed.err).toBeNull();
    expect(confirmed.res.payload.declaration.status).toBe('confirmed');
    const after = await payrollService.computeTipAllocations({
      restaurant: restaurantRow(), fromDate: RANGE.from, toDate: RANGE.to,
    });
    expect(after.currencies[0].employees.find((e) => e.user_id === fx.server).gross_tips_cents).toBe(5000);
    const payAfter = await call(controller.getMyPay, myReq(fx.server));
    expect(payAfter.res.payload.employee.total_pay_cents).toBe(20000);

    // The finalized stub is the immutable snapshot: it still reads 17000.
    const stub = await call(controller.getMyPayStub, mockReq({
      params: { restaurantId: String(fx.restaurantId), payRunId: String(payRunId) },
      user: { id: fx.server },
    }));
    expect(stub.res.payload.stub.line.total_pay_cents).toBe(17000);

    // Confirming a non-pending declaration is a 409.
    const again = await call(controller.confirmCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId), declarationId: String(declarationId) },
      user: { id: fx.owner },
    }));
    expect(again.err).not.toBeNull();
    expect(again.err.statusCode).toBe(409);
  });

  test('a rejected self-declaration never flows into pay', async () => {
    const { res, err } = await call(controller.declareMyCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId) },
      body: { date: '2026-10-07', amountCents: 1000, idempotencyKey: 'trackb-carl-0001' },
      user: { id: fx.cook },
    }));
    expect(err).toBeNull();
    const declarationId = res.payload.declaration.id;
    const rejected = await call(controller.rejectCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId), declarationId: String(declarationId) },
      user: { id: fx.owner },
    }));
    expect(rejected.err).toBeNull();
    expect(rejected.res.payload.declaration.status).toBe('rejected');
    const allocations = await payrollService.computeTipAllocations({
      restaurant: restaurantRow(), fromDate: RANGE.from, toDate: RANGE.to,
    });
    const carl = allocations.currencies[0].employees.find((e) => e.user_id === fx.cook);
    expect(carl ? carl.gross_tips_cents : 0).toBe(0);
    // The employee still sees their own rejected declaration.
    const mine = await call(controller.listMyCashTips, myReq(fx.cook));
    expect(mine.res.payload.declarations).toHaveLength(1);
    expect(mine.res.payload.declarations[0].status).toBe('rejected');
  });

  test('the manager-only declare path stays confirmed and flows into pay at once', async () => {
    const { res, err } = await call(controller.declareCashTip, mockReq({
      params: { restaurantId: String(fx.restaurantId) },
      body: { staffUserId: fx.cook, date: '2026-10-06', amountCents: 700, note: 'Counter jar' },
      user: { id: fx.owner },
    }));
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.payload.declaration.status).toBe('confirmed');
    const allocations = await payrollService.computeTipAllocations({
      restaurant: restaurantRow(), fromDate: RANGE.from, toDate: RANGE.to,
    });
    expect(allocations.currencies[0].employees.find((e) => e.user_id === fx.cook).gross_tips_cents).toBe(700);
  });
});
