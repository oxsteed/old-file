'use strict';

/**
 * DB tests: S-04 / S-15 / S-16 restaurant payroll, tips, labor and
 * team-activity surface (restaurantPayrollController + service,
 * migration 951) against a real migrated database.
 *
 * Proves:
 *   - tip attribution: POS order tips follow the shift's staff member;
 *     shift-less order tips are unattributed;
 *   - tip pool math: role tip-out + shared pool conserve cents exactly;
 *   - declared cash tips are attributed to the named staff member and
 *     the declaration is audited;
 *   - labor cost and labor % use membership wages x recorded hours and
 *     the F-07 net-collected revenue definition;
 *   - payroll endpoints fail closed on the catalog payroll.view
 *     permission (manager default has NO payroll.view; an override
 *     grant opens it; owner always passes);
 *   - the team activity view is gated on audit.view, is filterable by
 *     person / action / date, and is business-scoped;
 *   - the exception report counts voids, refunds, comps, discounts,
 *     no-sales, payouts and missing time entries per employee;
 *   - time-entry create/delete in staffSchedulingController now write
 *     business_audit_log rows (S-16 gap).
 *
 * The scope-model gate is stubbed (its own suite covers the real
 * gate); permissions resolve against the REAL catalog tables and
 * every query runs against the real schema.
 *
 * Run with:
 *   RESTAURANT_PAYROLL_TEST_DATABASE_URL=<url>
 *     npx jest __tests__/restaurantPayrollTips.db.test.js
 * Without it, the DB describes skip (fail closed).
 */
jest.unmock('pg');

const crypto = require('crypto');

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && ['/st_t6'].includes(url.pathname);
  } catch { return false; }
}
const RAW_URL = process.env.RESTAURANT_PAYROLL_TEST_DATABASE_URL || '';
if (RAW_URL && !isDisposableDb(RAW_URL)) {
  throw new Error('Payroll DB tests require an explicit loopback disposable database');
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only a disposable loopback database', () => {
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
const schedulingCtrl = require('../controllers/staffSchedulingController');
const { logBusinessAction } = require('../services/businessAuditLog');

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

// ── Fixture builders ─────────────────────────────────────────────────

async function makeUser(first, last) {
  const id = crypto.randomUUID();
  const tag = crypto.randomUUID().slice(0, 8);
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, $4, 'customer', TRUE, TRUE)`,
    [id, `payroll-${tag}@example.invalid`, first, last]
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
    [businessId, ownerId, userId, role, `member-${userId.slice(0, 8)}@example.invalid`, jobRole, wage]
  );
  return m.id;
}

async function addOverride(membershipId, code, effect) {
  const { rows: [p] } = await pool.query('SELECT id FROM team_permissions WHERE code = $1', [code]);
  await pool.query(
    `INSERT INTO membership_permission_overrides (membership_id, permission_id, effect)
     VALUES ($1, $2, $3)`,
    [membershipId, p.id, effect]
  );
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

async function newOrder(fx, {
  createdAt, status = 'completed', paymentStatus = 'paid',
  subtotal = 0, discount = 0, tax = 0, tip = 0, total = 0, metadata = {}, queue,
}) {
  const { rows: [o] } = await pool.query(
    `INSERT INTO food_orders
       (restaurant_id, business_id, guest_name, fulfillment_type, order_source,
        status, payment_status, subtotal_cents, discount_cents, tax_cents,
        tip_cents, total_cents, currency_code, queue_number, metadata, created_at)
     VALUES ($1, $2, 'Payroll Guest', 'pickup', 'counter', $3, $4, $5, $6, $7, $8, $9, 'USD', $10, $11::jsonb, $12)
     RETURNING id`,
    [fx.restaurantId, fx.businessId, status, paymentStatus, subtotal, discount, tax, tip, total, queue, JSON.stringify(metadata), createdAt]
  );
  return o.id;
}

async function newPayment(fx, orderId, { type = 'cash', amount, status = 'recorded', createdBy = null, shiftId = null, createdAt = LOCAL_NOON }) {
  const { rows: [p] } = await pool.query(
    `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [fx.restaurantId, orderId, shiftId, type, amount, status, createdBy, createdAt]
  );
  return p.id;
}

async function newShift(fx, staffUserId) {
  const { rows: [s] } = await pool.query(
    `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status)
     VALUES ($1, $2, 'closed') RETURNING id`,
    [fx.restaurantId, staffUserId]
  );
  return s.id;
}

const RANGE = { from: '2026-10-05', to: '2026-10-11' };
// Local noon in America/New_York (EDT) on 2026-10-06.
const LOCAL_NOON = '2026-10-06T16:00:00Z';

// ════════════════════════════════════════════════════════════════════
// fxA: labor figures, tip attribution, pool math, cash declarations
// ════════════════════════════════════════════════════════════════════
ddescribe('S-15/S-04 labor, tips and payroll (fxA)', () => {
  let fx;

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const businessId = await makeBusiness(owner, 'Payroll Bistro');
    const restaurantId = await makeRestaurant(businessId, owner, 'Payroll Bistro');
    const server = await makeUser('Sara', 'Server');
    const cook = await makeUser('Carl', 'Cook');
    const nowage = await makeUser('Ned', 'Nowage');
    const serverMembership = await addMember(businessId, owner, server, 'employee', { jobRole: 'Server', wage: 1500 });
    const cookMembership = await addMember(businessId, owner, cook, 'employee', { jobRole: 'Cook', wage: 1800 });
    await addMember(businessId, owner, nowage, 'employee', { jobRole: 'Server', wage: null });
    fx = { owner, businessId, restaurantId, server, cook, nowage };
    registerAccess(owner, restaurantId, businessId, 'owner');
    registerAccess(server, restaurantId, businessId, 'employee', serverMembership);
    registerAccess(cook, restaurantId, businessId, 'employee', cookMembership);

    // Hours: server 10h, cook 5h, nowage 4h (no wage on file).
    await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, hours_worked) VALUES
       ($1, $2, '2026-10-06', 10), ($1, $3, '2026-10-06', 5), ($1, $4, '2026-10-06', 4)`,
      [businessId, server, cook, nowage]
    );
    // Scheduled: server 8h pinned to the restaurant; cook 5h legacy
    // (restaurant_id NULL) — both must count.
    await pool.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, restaurant_id) VALUES
       ($1, $2, '2026-10-06', '09:00', '17:00', 'Server', $4),
       ($1, $3, '2026-10-07', '10:00', '15:00', 'Cook', NULL)`,
      [businessId, server, cook, restaurantId]
    );

    // POS order on Sara's shift: total 48000 collected in cash, tip 2000.
    const shiftId = await newShift(fx, server);
    fx.shiftId = shiftId;
    const posOrder = await newOrder(fx, {
      createdAt: LOCAL_NOON, subtotal: 44000, tax: 2000, tip: 2000, total: 48000,
      metadata: { shiftId }, queue: 201,
    });
    await newPayment(fx, posOrder, { type: 'cash', amount: 48000, createdBy: server, shiftId });
    // Online order, no shift: paid by payment_status, tip 500, total 10500.
    await newOrder(fx, {
      createdAt: LOCAL_NOON, subtotal: 10000, tip: 500, total: 10500, queue: 202,
    });
  });

  const restaurantRow = () => accessByUser.get(String(fx.owner));

  test('tip pool settings default to pooling off with no rules', async () => {
    const { res, err } = await call(controller.getTipPoolSettings,
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, user: { id: fx.owner } }));
    expect(err).toBeNull();
    expect(res.payload.settings.pooling_enabled).toBe(false);
    expect(res.payload.settings.tip_out_rules).toEqual([]);
  });

  test('tips attribute to the shift staff member; shift-less tips are unattributed', async () => {
    const allocations = await payrollService.computeTipAllocations({
      restaurant: restaurantRow(), fromDate: RANGE.from, toDate: RANGE.to,
    });
    expect(allocations.currencies).toHaveLength(1);
    const usd = allocations.currencies[0];
    expect(usd.currency).toBe('USD');
    expect(usd.total_tips_cents).toBe(2500);
    expect(usd.unattributed_cents).toBe(500);
    const sara = usd.employees.find((e) => e.user_id === fx.server);
    expect(sara.gross_tips_cents).toBe(2000);
    expect(sara.net_tips_cents).toBe(2000);
    expect(sara.job_role).toBe('Server');
  });

  test('labor cost = hours x membership wage; labor % uses F-07 net collected', async () => {
    const { res, err } = await call(controller.laborSummary,
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, query: { ...RANGE }, user: { id: fx.owner } }));
    expect(err).toBeNull();
    const labor = res.payload;
    // Revenue (net collected): 48000 POS cash + 10500 paid online = 58500.
    expect(labor.revenue_cents).toBe(58500);
    // Wages: 10h x 1500 + 5h x 1800 = 24000. Nowage has hours, no wage.
    expect(labor.labor_cost_cents).toBe(24000);
    expect(labor.labor_percent).toBe(41.03);
    expect(labor.total_hours).toBe(19);
    expect(labor.scheduled_hours).toBe(13);
    expect(labor.sales_per_labor_hour_cents).toBe(3079);
    expect(labor.missing_wage_user_ids).toEqual([fx.nowage]);
    const sara = labor.employees.find((e) => e.user_id === fx.server);
    expect(sara).toMatchObject({ hours: 10, hourly_wage_cents: 1500, wages_cents: 15000, scheduled_hours: 8 });
    const ned = labor.employees.find((e) => e.user_id === fx.nowage);
    expect(ned.wages_cents).toBeNull();
  });

  test('declared cash tips attribute to the named staff member and are audited', async () => {
    const { res, err } = await call(controller.declareCashTip,
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        body: { staffUserId: fx.cook, date: '2026-10-06', amountCents: 700, note: 'Counter jar' },
        user: { id: fx.owner },
      }));
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.payload.declaration.amount_cents).toBe(700);

    const { rows } = await pool.query(
      `SELECT action FROM business_audit_log WHERE business_id = $1 AND action = 'restaurant.cash_tip.declared'`,
      [fx.businessId]
    );
    expect(rows).toHaveLength(1);

    const allocations = await payrollService.computeTipAllocations({
      restaurant: restaurantRow(), fromDate: RANGE.from, toDate: RANGE.to,
    });
    const carl = allocations.currencies[0].employees.find((e) => e.user_id === fx.cook);
    expect(carl.gross_tips_cents).toBe(700);
  });

  test('declaring a cash tip for a non-team user is rejected', async () => {
    const stranger = await makeUser('Stan', 'Stranger');
    const { err } = await call(controller.declareCashTip,
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        body: { staffUserId: stranger, date: '2026-10-06', amountCents: 100 },
        user: { id: fx.owner },
      }));
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(400);
  });

  test('tip pool: role tip-out + shared pool conserve every cent', async () => {
    const { res, err } = await call(controller.updateTipPoolSettings,
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        body: {
          pooling_enabled: true,
          tip_out_rules: [
            { target_type: 'role', target_key: 'Cook', percent_bps: 1000 },
            { target_type: 'pool', percent_bps: 500 },
          ],
        },
        user: { id: fx.owner },
      }));
    expect(err).toBeNull();
    expect(res.payload.settings.pooling_enabled).toBe(true);
    expect(res.payload.settings.tip_out_rules).toHaveLength(2);

    const allocations = await payrollService.computeTipAllocations({
      restaurant: restaurantRow(), fromDate: RANGE.from, toDate: RANGE.to,
    });
    const usd = allocations.currencies[0];
    // Total tips 3200 (2000 shift + 500 unattributed + 700 declared).
    expect(usd.total_tips_cents).toBe(3200);
    expect(usd.unattributed_cents).toBe(500);
    const sara = usd.employees.find((e) => e.user_id === fx.server);
    const carl = usd.employees.find((e) => e.user_id === fx.cook);
    // Role pot 320 to Carl; pool pot 160 split between earners.
    // Deductions are proportional to gross (Sara 2000, Carl 700).
    expect(sara.tip_out_cents).toBe(356);
    expect(carl.tip_out_cents).toBe(124);
    expect(sara.tip_in_cents).toBe(80);
    expect(carl.tip_in_cents).toBe(400);
    expect(sara.net_tips_cents).toBe(1724);
    expect(carl.net_tips_cents).toBe(976);
    const netSum = usd.employees.reduce((sum, e) => sum + e.net_tips_cents, 0);
    expect(netSum + usd.unattributed_cents).toBe(usd.total_tips_cents);
  });

  test('tip-out rules over 100% in total are rejected', async () => {
    const { err } = await call(controller.updateTipPoolSettings,
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        body: {
          pooling_enabled: true,
          tip_out_rules: [
            { target_type: 'role', target_key: 'Cook', percent_bps: 6000 },
            { target_type: 'pool', percent_bps: 5000 },
          ],
        },
        user: { id: fx.owner },
      }));
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('validation_failed');
  });

  test('payroll CSV export carries hours, wages and net tips per employee', async () => {
    const { res, err } = await call(controller.payrollExportCsv,
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, query: { ...RANGE }, user: { id: fx.owner } }));
    expect(err).toBeNull();
    expect(res.headers['Content-Type']).toContain('text/csv');
    const lines = res.body.trim().split('\n');
    expect(lines[0]).toContain('hourly_wage_cents');
    const saraLine = lines.find((l) => l.includes('Sara Server'));
    expect(saraLine).toBeTruthy();
    expect(saraLine).toContain('15000'); // wages
    expect(saraLine).toContain('1724');  // net tips after pooling
    const { rows } = await pool.query(
      `SELECT action FROM business_audit_log WHERE business_id = $1 AND action = 'restaurant.payroll.exported'`,
      [fx.businessId]
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// fxB: permission gating (fail closed)
// ════════════════════════════════════════════════════════════════════
ddescribe('S-15/S-16 permission gating (fxB)', () => {
  let fx;

  beforeAll(async () => {
    const owner = await makeUser('Owen', 'Owner');
    const businessId = await makeBusiness(owner, 'Gating Grill');
    const restaurantId = await makeRestaurant(businessId, owner, 'Gating Grill');
    const manager = await makeUser('Manny', 'Manager');
    const managerPayroll = await makeUser('Paula', 'Payroll');
    const managerNoAudit = await makeUser('Andy', 'Noaudit');
    const employee = await makeUser('Erin', 'Employee');
    await addMember(businessId, owner, manager, 'manager');
    const mpMembership = await addMember(businessId, owner, managerPayroll, 'manager');
    const naMembership = await addMember(businessId, owner, managerNoAudit, 'manager');
    const empMembership = await addMember(businessId, owner, employee, 'employee');
    await addOverride(mpMembership, 'payroll.view', 'allow');
    await addOverride(naMembership, 'audit.view', 'deny');
    fx = { owner, businessId, restaurantId, manager, managerPayroll, managerNoAudit, employee };
    registerAccess(owner, restaurantId, businessId, 'owner');
    registerAccess(manager, restaurantId, businessId, 'manager',
      (await pool.query('SELECT id FROM business_members WHERE business_id=$1 AND member_id=$2', [businessId, manager])).rows[0].id);
    registerAccess(managerPayroll, restaurantId, businessId, 'manager', mpMembership);
    registerAccess(managerNoAudit, restaurantId, businessId, 'manager', naMembership);
    registerAccess(employee, restaurantId, businessId, 'employee', empMembership);
  });

  const laborReq = (userId) => mockReq({
    params: { restaurantId: String(fx.restaurantId) }, query: { ...RANGE }, user: { id: userId },
  });

  test('manager without payroll.view is denied labor figures (fail closed)', async () => {
    const { err } = await call(controller.laborSummary, laborReq(fx.manager));
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('payroll_permission_required');
  });

  test('manager with a payroll.view override grant passes', async () => {
    const { res, err } = await call(controller.laborSummary, laborReq(fx.managerPayroll));
    expect(err).toBeNull();
    expect(res.payload.labor_percent).toBeNull(); // no revenue yet
    expect(res.payload.revenue_cents).toBe(0);
  });

  test('employee is denied at the manager gate', async () => {
    const { err } = await call(controller.laborSummary, laborReq(fx.employee));
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('forbidden');
  });

  test('payroll CSV export fails closed without payroll.view', async () => {
    const { res, err } = await call(controller.payrollExportCsv, laborReq(fx.manager));
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('payroll_permission_required');
    expect(res.send).not.toHaveBeenCalled();
  });

  test('owner can export payroll CSV', async () => {
    const { res, err } = await call(controller.payrollExportCsv, laborReq(fx.owner));
    expect(err).toBeNull();
    expect(res.send).toHaveBeenCalled();
    expect(res.body.split('\n')[0]).toContain('total_pay_cents');
  });

  test('team activity requires audit.view: deny override blocks a manager', async () => {
    const { err } = await call(controller.teamActivity,
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, user: { id: fx.managerNoAudit } }));
    expect(err).toBeTruthy();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('audit_permission_required');
  });

  test('team activity passes for a manager (audit.view is a manager default)', async () => {
    const { res, err } = await call(controller.teamActivity,
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, user: { id: fx.manager } }));
    expect(err).toBeNull();
    expect(Array.isArray(res.payload.entries)).toBe(true);
    expect(Array.isArray(res.payload.actors)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// fxC: exception report, team activity content, time-entry audit
// ════════════════════════════════════════════════════════════════════
ddescribe('S-16 exceptions, activity and time-entry audit (fxC)', () => {
  let fx;

  beforeAll(async () => {
    const owner = await makeUser('Opal', 'Owner');
    const businessId = await makeBusiness(owner, 'Exception Eats');
    const restaurantId = await makeRestaurant(businessId, owner, 'Exception Eats');
    const manager = await makeUser('Marge', 'Manager');
    const server = await makeUser('Steve', 'Server');
    const cook = await makeUser('Cory', 'Cook');
    await addMember(businessId, owner, manager, 'manager');
    await addMember(businessId, owner, server, 'employee', { jobRole: 'Server', wage: 1500 });
    await addMember(businessId, owner, cook, 'employee', { jobRole: 'Cook', wage: 1800 });
    fx = { owner, businessId, restaurantId, manager, server, cook };
    registerAccess(owner, restaurantId, businessId, 'owner');

    const shiftId = await newShift(fx, server);
    // A normal paid order on Steve's shift, with a discount.
    const order = await newOrder(fx, {
      createdAt: LOCAL_NOON, subtotal: 5000, discount: 300, tax: 300, total: 5000,
      metadata: { shiftId }, queue: 301,
    });
    await newPayment(fx, order, { type: 'cash', amount: 5000, createdBy: server, shiftId });
    // Exceptions by Steve: a voided payment, a refund, a comp.
    await newPayment(fx, order, { type: 'cash', amount: 1200, status: 'voided', createdBy: server, shiftId });
    await newPayment(fx, order, { type: 'refund', amount: 800, status: 'recorded', createdBy: server, shiftId });
    await newPayment(fx, order, { type: 'comp', amount: 600, status: 'recorded', createdBy: server, shiftId });
    // Drawer events by Steve: two no-sales, one payout.
    await pool.query(
      `INSERT INTO restaurant_pos_drawer_events (restaurant_id, shift_id, event_type, amount_cents, created_by, created_at) VALUES
       ($1, $2, 'no_sale', 0, $3, $4), ($1, $2, 'no_sale', 0, $3, $4), ($1, $2, 'payout', 1500, $3, $4)`,
      [restaurantId, shiftId, server, LOCAL_NOON]
    );
    // Scheduled shifts: Cory on 2026-10-07 with NO time entry (missing
    // punch); Steve on 2026-10-06 WITH a time entry (not missing).
    await pool.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, restaurant_id) VALUES
       ($1, $2, '2026-10-07', '10:00', '15:00', $4), ($1, $3, '2026-10-06', '09:00', '17:00', $4)`,
      [businessId, cook, server, restaurantId]
    );
    await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, hours_worked) VALUES ($1, $2, '2026-10-06', 8)`,
      [businessId, server]
    );

    // Audit rows: two for this business, one for a stranger business.
    const fakeReq = { user: { id: manager }, headers: {} };
    await logBusinessAction(fakeReq, {
      business_id: businessId, action: 'business.member.invited',
      target_type: 'user', target_id: server,
    });
    await logBusinessAction({ user: { id: owner }, headers: {} }, {
      business_id: businessId, action: 'business.member.role_changed',
      target_type: 'user', target_id: server,
    });
    const otherOwner = await makeUser('Otto', 'Other');
    const otherBusiness = await makeBusiness(otherOwner, 'Other Biz');
    await logBusinessAction({ user: { id: otherOwner }, headers: {} }, {
      business_id: otherBusiness, action: 'business.member.invited',
      target_type: 'user', target_id: server,
    });
    fx.otherBusiness = otherBusiness;
  });

  test('exception report counts POS and drawer exceptions per employee', async () => {
    const { res, err } = await call(controller.exceptionsReport,
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, query: { ...RANGE }, user: { id: fx.owner } }));
    expect(err).toBeNull();
    const steve = res.payload.employees.find((e) => e.user_id === fx.server);
    expect(steve).toMatchObject({
      voids: 1, voided_cents: 1200,
      refunds: 1, refund_cents: 800,
      comps: 1, comp_cents: 600,
      discounted_orders: 1, discount_cents: 300,
      no_sales: 2, payouts: 1, payout_cents: 1500,
      missing_punches: 0,
    });
    const cory = res.payload.employees.find((e) => e.user_id === fx.cook);
    expect(cory).toMatchObject({ missing_punches: 1, voids: 0, no_sales: 0 });
  });

  test('team activity is business-scoped and filterable by action and actor', async () => {
    const all = await call(controller.teamActivity,
      mockReq({ params: { restaurantId: String(fx.restaurantId) }, user: { id: fx.owner } }));
    expect(all.err).toBeNull();
    expect(all.res.payload.total).toBe(2);
    expect(all.res.payload.actors.map((a) => a.user_id).sort())
      .toEqual([fx.manager, fx.owner].sort());

    const byAction = await call(controller.teamActivity,
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        query: { action: 'business.member.invited' },
        user: { id: fx.owner },
      }));
    expect(byAction.res.payload.total).toBe(1);
    expect(byAction.res.payload.entries[0].actor_user_id).toBe(fx.manager);

    const byActor = await call(controller.teamActivity,
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        query: { actor_user_id: fx.owner },
        user: { id: fx.owner },
      }));
    expect(byActor.res.payload.total).toBe(1);
    expect(byActor.res.payload.entries[0].action).toBe('business.member.role_changed');

    const byPrefix = await call(controller.teamActivity,
      mockReq({
        params: { restaurantId: String(fx.restaurantId) },
        query: { action_prefix: 'business.member' },
        user: { id: fx.owner },
      }));
    expect(byPrefix.res.payload.total).toBe(2);
  });

  test('time-entry create and delete write audit rows (S-16 gap)', async () => {
    const managerReq = {
      params: { businessId: String(fx.businessId) },
      body: { user_id: fx.server, entry_date: '2026-10-08', hours_worked: 3.5, description: 'Audit probe' },
      user: { id: fx.manager },
      headers: {},
      business: { id: fx.businessId },
      businessRole: 'manager',
    };
    const res1 = mockRes();
    const next1 = jest.fn();
    await schedulingCtrl.logHours(managerReq, res1, next1);
    expect(next1).not.toHaveBeenCalled();
    expect(res1.statusCode).toBe(201);
    const entryId = res1.payload.entry.id;

    const res2 = mockRes();
    const next2 = jest.fn();
    await schedulingCtrl.deleteTimeEntry(
      { ...managerReq, params: { businessId: String(fx.businessId), id: String(entryId) }, body: {} },
      res2, next2
    );
    expect(next2).not.toHaveBeenCalled();
    expect(res2.payload.success).toBe(true);

    const { rows } = await pool.query(
      `SELECT action, before_state FROM business_audit_log
        WHERE business_id = $1 AND action LIKE 'business.time_entry.%' ORDER BY id`,
      [fx.businessId]
    );
    expect(rows.map((r) => r.action)).toEqual([
      'business.time_entry.logged',
      'business.time_entry.voided',
    ]);
    expect(Number(rows[1].before_state.hours_worked)).toBe(3.5);
  });
});

if (CAN_RUN_DB) {
  afterAll(async () => { await pool.end().catch(() => {}); });
}
