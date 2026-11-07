'use strict';

/**
 * Staff review S-04 remainders against the real migrated schema:
 * schedule publishing (draft -> published + staff notification) and
 * time-off/PTO requests with the manager approve/deny workflow.
 *
 * Runs only against an explicitly opted-in disposable st_w2 database:
 *   ST_W2_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/st_w2
 *     npx jest __tests__/staffSchedulePublishing.db.test.js
 */
function staffDbOptIn() {
  // S-23: standard disposable test database (ci-local.sh sets it). The
  // suite runs whenever the test DB is available and self-skips only
  // when no test DB is configured at all. STATEMENT_REQUIRE_DB_TESTS
  // (set by ci-local.sh) turns a missing DB into a hard failure instead
  // of a silent skip.
  const value = process.env.STATEMENT_TEST_DATABASE_URL || '';
  if (!value) {
    if (process.env.STATEMENT_REQUIRE_DB_TESTS === 'true') {
      throw new Error('STATEMENT_TEST_DATABASE_URL is required when STATEMENT_REQUIRE_DB_TESTS=true');
    }
    return '';
  }
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (!loopback) {
    throw new Error('STATEMENT_TEST_DATABASE_URL must be a loopback database');
  }
  return value;
}

const url = staffDbOptIn();
if (url) process.env.DATABASE_URL = url;
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../db');
const ctrl = require('../controllers/businessStaffScheduleController');
const { sendNotification } = require('../services/notificationService');

const suite = url ? describe : describe.skip;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
function mockNext() {
  const next = (err) => { if (err) next.error = err; };
  next.error = null;
  return next;
}
async function call(handler, req) {
  const res = mockRes();
  const next = mockNext();
  await handler({ headers: {}, ...req }, res, next);
  return { res, error: next.error };
}

const stamp = `${Date.now()}`;
const rid = require('crypto').randomBytes(2).toString('hex');
const uid = (tail) => `b0000000-0000-4000-8000-${rid}${tail}`;
const OWNER = uid('11111111');
const MANAGER = uid('22222222');
const EMPLOYEE = uid('33333333');
const EMPLOYEE2 = uid('44444444');

let bizId;

async function insertUser(id, email, firstName) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active)
     VALUES ($1, $2, 'x', $3, 'Test', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [id, email, firstName]
  );
}
async function insertMembership(memberId, role, status = 'active') {
  await db.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [bizId, OWNER, memberId, role, `sched-${memberId.slice(-8)}@example.com`, status, status === 'active' ? new Date() : null]
  );
}
const asManager = (id) => ({ user: { id }, businessRole: 'manager', params: { businessId: String(bizId) } });
const asEmployee = (id) => ({ user: { id }, businessRole: 'employee', params: { businessId: String(bizId) } });

suite('S-04 schedule publishing + time-off (DB)', () => {
  beforeAll(async () => {
    await insertUser(OWNER, `sched-owner-${stamp}@example.com`, 'Olive');
    await insertUser(MANAGER, `sched-manager-${stamp}@example.com`, 'Moe');
    await insertUser(EMPLOYEE, `sched-emp-${stamp}@example.com`, 'Eli');
    await insertUser(EMPLOYEE2, `sched-emp2-${stamp}@example.com`, 'Eve');
    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [OWNER, `Sched Biz ${stamp}`]
    );
    bizId = biz.id;
    await insertMembership(MANAGER, 'manager');
    await insertMembership(EMPLOYEE, 'employee');
    await insertMembership(EMPLOYEE2, 'employee');
  });

  afterAll(async () => { await db.end(); });

  test('migration 1200: publishing columns and time-off table exist', async () => {
    const { rows } = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'business_staff_shifts' AND column_name IN ('published_at', 'published_by')`
    );
    expect(rows.map((r) => r.column_name).sort()).toEqual(['published_at', 'published_by']);
    const t = await db.query(`SELECT to_regclass('public.business_time_off_requests') AS c`);
    expect(t.rows[0].c).toBe('business_time_off_requests');
  });

  test('new shifts are drafts: manager sees them, staff do not', async () => {
    const created = await call(ctrl.createShift, {
      ...asManager(MANAGER),
      body: { user_id: EMPLOYEE, shift_start: '2026-11-02T09:00', shift_end: '2026-11-02T17:00', role: 'Cashier' },
    });
    expect(created.error).toBeNull();
    expect(created.res.statusCode).toBe(201);
    expect(created.res.body.published_at).toBeNull();

    const mgrList = await call(ctrl.listShifts, { ...asManager(MANAGER), query: {} });
    expect(mgrList.res.body.some((s) => s.id === created.res.body.id && s.published === false)).toBe(true);

    const empList = await call(ctrl.listShifts, { ...asEmployee(EMPLOYEE), query: {} });
    expect(empList.res.body.some((s) => s.id === created.res.body.id)).toBe(false);
  });

  test('publishShifts flips drafts and notifies each assignee once', async () => {
    sendNotification.mockClear();
    const c1 = await call(ctrl.createShift, {
      ...asManager(MANAGER),
      body: { user_id: EMPLOYEE, shift_start: '2026-11-03T09:00', shift_end: '2026-11-03T17:00', role: 'Cashier' },
    });
    const c2 = await call(ctrl.createShift, {
      ...asManager(MANAGER),
      body: { user_id: EMPLOYEE, shift_start: '2026-11-04T09:00', shift_end: '2026-11-04T17:00', role: 'Cashier' },
    });
    const pub = await call(ctrl.publishShifts, {
      ...asManager(MANAGER),
      body: { from: '2026-11-03', to: '2026-11-04' },
    });
    expect(pub.error).toBeNull();
    expect(pub.res.body.published).toBeGreaterThanOrEqual(2);

    const { rows } = await db.query(
      `SELECT published_at, published_by FROM business_staff_shifts WHERE id = ANY($1::bigint[])`,
      [[c1.res.body.id, c2.res.body.id]]
    );
    expect(rows.every((r) => r.published_at && String(r.published_by) === MANAGER)).toBe(true);

    const calls = sendNotification.mock.calls.filter((c) => c[0].type === 'crew_shift_published');
    const toEmployee = calls.filter((c) => String(c[0].userId) === EMPLOYEE);
    expect(toEmployee.length).toBe(1);
    expect(toEmployee[0][0].data.params.restaurantName).toBeTruthy();
    expect(toEmployee[0][0].data.params.shiftLabel).toContain('shifts');

    const empList = await call(ctrl.listShifts, { ...asEmployee(EMPLOYEE), query: {} });
    expect(empList.res.body.some((s) => s.id === c1.res.body.id && s.published === true)).toBe(true);
  });

  test('publishShifts rejects non-managers', async () => {
    const { res } = await call(ctrl.publishShifts, { ...asEmployee(EMPLOYEE), body: {} });
    expect(res.statusCode).toBe(403);
  });

  test('time-off: request, conflict detection, approve, visibility', async () => {
    // Employee requests leave overlapping their published shift (2026-11-03).
    const created = await call(ctrl.createTimeOffRequest, {
      ...asEmployee(EMPLOYEE),
      body: { request_type: 'vacation', start_date: '2026-11-03', end_date: '2026-11-05', reason: 'Family trip' },
    });
    expect(created.error).toBeNull();
    expect(created.res.statusCode).toBe(201);
    expect(created.res.body.request.status).toBe('pending');
    expect(created.res.body.conflicts.length).toBeGreaterThanOrEqual(1);

    // Another employee cannot see it; the manager can.
    const other = await call(ctrl.listTimeOffRequests, { ...asEmployee(EMPLOYEE2), query: {} });
    expect(other.res.body.requests.length).toBe(0);
    const mgr = await call(ctrl.listTimeOffRequests, { ...asManager(MANAGER), query: {} });
    expect(mgr.res.body.requests.some((r) => r.id === created.res.body.request.id)).toBe(true);

    // Non-manager cannot decide.
    const denied = await call(ctrl.decideTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
      body: { decision: 'approved' },
    });
    expect(denied.res.statusCode).toBe(403);

    // Manager approves; requester is notified.
    sendNotification.mockClear();
    const approved = await call(ctrl.decideTimeOffRequest, {
      ...asManager(MANAGER),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
      body: { decision: 'approved' },
    });
    expect(approved.res.body.request.status).toBe('approved');
    expect(sendNotification).toHaveBeenCalled();

    // Deciding twice is a 404 (no longer pending).
    const again = await call(ctrl.decideTimeOffRequest, {
      ...asManager(MANAGER),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
      body: { decision: 'denied' },
    });
    expect(again.res.statusCode).toBe(404);
  });

  test('time-off: requester can cancel a pending request', async () => {
    const created = await call(ctrl.createTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      body: { request_type: 'sick', start_date: '2026-12-01', end_date: '2026-12-01' },
    });
    expect(created.res.statusCode).toBe(201);
    const cancelled = await call(ctrl.cancelTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
    });
    expect(cancelled.res.body.request.status).toBe('cancelled');
  });

  test('time-off: validation rejects bad input', async () => {
    const bad = await call(ctrl.createTimeOffRequest, {
      ...asEmployee(EMPLOYEE),
      body: { request_type: 'yacht', start_date: '2026-12-05', end_date: '2026-12-01' },
    });
    expect(bad.res.statusCode).toBe(400);
  });

  test('publish 409s on blocking violations and publishes nothing (finding 51)', async () => {
    // Two overlapping drafts for the same person, inserted directly:
    // createShift would have 409ed the second one, so a pre-existing
    // conflicting pair can only arrive via another path (or legacy rows).
    const { rows: [d1] } = await db.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label)
       VALUES ($1, $2, '2026-11-16', '09:00', '17:00', 'Cashier') RETURNING id`,
      [bizId, EMPLOYEE]
    );
    const { rows: [d2] } = await db.query(
      `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label)
       VALUES ($1, $2, '2026-11-16', '12:00', '20:00', 'Cashier') RETURNING id`,
      [bizId, EMPLOYEE]
    );
    const pub = await call(ctrl.publishShifts, {
      ...asManager(MANAGER),
      body: { from: '2026-11-16', to: '2026-11-16' },
    });
    expect(pub.error).toBeNull();
    expect(pub.res.statusCode).toBe(409);
    expect(pub.res.body.code).toBe('shift_conflicts');
    expect(pub.res.body.violations.map((v) => v.code)).toContain('shift_overlap');
    // All-or-nothing: neither draft was published.
    const { rows } = await db.query(
      'SELECT published_at FROM business_staff_shifts WHERE id = ANY($1::bigint[])',
      [[d1.id, d2.id]]
    );
    expect(rows.every((r) => r.published_at == null)).toBe(true);
  });

  test('publish 409s when a draft falls inside leave approved after it was created (finding 51)', async () => {
    const draft = await call(ctrl.createShift, {
      ...asManager(MANAGER),
      body: { user_id: EMPLOYEE2, shift_start: '2026-11-17T09:00', shift_end: '2026-11-17T17:00', role: 'Cashier' },
    });
    expect(draft.res.statusCode).toBe(201);
    const created = await call(ctrl.createTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      body: { request_type: 'vacation', start_date: '2026-11-17', end_date: '2026-11-18' },
    });
    expect(created.res.statusCode).toBe(201);
    const approved = await call(ctrl.decideTimeOffRequest, {
      ...asManager(MANAGER),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
      body: { decision: 'approved' },
    });
    expect(approved.res.body.request.status).toBe('approved');
    const pub = await call(ctrl.publishShifts, {
      ...asManager(MANAGER),
      body: { from: '2026-11-17', to: '2026-11-17' },
    });
    expect(pub.res.statusCode).toBe(409);
    expect(pub.res.body.violations.map((v) => v.code)).toContain('time_off_overlap');
    const { rows } = await db.query(
      'SELECT published_at FROM business_staff_shifts WHERE id = $1',
      [draft.res.body.id]
    );
    expect(rows[0].published_at).toBeNull();
  });

  test('time-off: cancelling an approved request refunds the balance once (finding 25)', async () => {
    const policy = await call(ctrl.setTimeOffPolicy, {
      ...asManager(MANAGER),
      params: { businessId: String(bizId), userId: EMPLOYEE2 },
      body: { request_type: 'vacation', accrual_amount: 5, accrual_unit: 'days', accrual_period: 'monthly' },
    });
    expect(policy.error).toBeNull();
    expect(policy.res.statusCode).toBe(200);
    const granted = await call(ctrl.grantTimeOffAccrual, {
      ...asManager(MANAGER),
      body: { user_id: EMPLOYEE2, request_type: 'vacation' },
    });
    expect(granted.res.body.grants[0].balance_after).toBe(5);
    const created = await call(ctrl.createTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      body: { request_type: 'vacation', start_date: '2026-12-10', end_date: '2026-12-11' },
    });
    expect(created.res.statusCode).toBe(201);
    expect(created.res.body.pto_balance.required).toBe(2);
    const approved = await call(ctrl.decideTimeOffRequest, {
      ...asManager(MANAGER),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
      body: { decision: 'approved' },
    });
    expect(approved.res.body.pto_balance.balance).toBe(3);
    const cancelled = await call(ctrl.cancelTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
    });
    expect(cancelled.error).toBeNull();
    expect(cancelled.res.body.request.status).toBe('cancelled');
    expect(cancelled.res.body.pto_balance).toEqual({ restored: 2, unit: 'days', balance: 5 });
    // Cancelling again is a 404 and the balance stays refunded once.
    const again = await call(ctrl.cancelTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
    });
    expect(again.res.statusCode).toBe(404);
    const { rows: [balance] } = await db.query(
      `SELECT balance FROM business_time_off_balances
        WHERE business_id = $1 AND user_id = $2 AND request_type = 'vacation'`,
      [bizId, EMPLOYEE2]
    );
    expect(Number(balance.balance)).toBe(5);
    const { rows: reversals } = await db.query(
      `SELECT amount, event_type FROM business_time_off_accrual_events
        WHERE request_id = $1 AND event_type = 'reversal'`,
      [created.res.body.request.id]
    );
    expect(reversals).toHaveLength(1);
    expect(Number(reversals[0].amount)).toBe(2);
  });

  test('time-off: a second accrual grant in the same period is refused (finding 26)', async () => {
    // EMPLOYEE2's vacation policy was granted once this month by the
    // finding-25 test above; a second grant for the same period 409s
    // and the balance is untouched.
    const again = await call(ctrl.grantTimeOffAccrual, {
      ...asManager(MANAGER),
      body: { user_id: EMPLOYEE2, request_type: 'vacation' },
    });
    expect(again.res.statusCode).toBe(409);
    expect(again.res.body.code).toBe('pto_accrual_already_granted');
    expect(again.res.body.refusals).toHaveLength(1);
    const now = new Date();
    const thisMonth = `monthly:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(again.res.body.refusals[0].period).toBe(thisMonth);
    expect(again.res.body.refusals[0].existing_grant.amount).toBe(5);
    const { rows: [balance] } = await db.query(
      `SELECT balance FROM business_time_off_balances
        WHERE business_id = $1 AND user_id = $2 AND request_type = 'vacation'`,
      [bizId, EMPLOYEE2]
    );
    expect(Number(balance.balance)).toBe(5);
  });

  test('time-off: an hours policy consumes scheduled hours, not days x 8 (finding 27)', async () => {
    const policy = await call(ctrl.setTimeOffPolicy, {
      ...asManager(MANAGER),
      params: { businessId: String(bizId), userId: EMPLOYEE2 },
      body: { request_type: 'sick', accrual_amount: 20, accrual_unit: 'hours', accrual_period: 'monthly' },
    });
    expect(policy.res.statusCode).toBe(200);
    const granted = await call(ctrl.grantTimeOffAccrual, {
      ...asManager(MANAGER),
      body: { user_id: EMPLOYEE2, request_type: 'sick' },
    });
    expect(granted.res.body.grants[0].balance_after).toBe(20);
    // Mon 6h + Tue 4h scheduled, Wed unscheduled.
    for (const [date, start, end] of [['2026-12-14', '09:00', '15:00'], ['2026-12-15', '09:00', '13:00']]) {
      const shift = await call(ctrl.createShift, {
        ...asManager(MANAGER),
        body: { user_id: EMPLOYEE2, shift_start: `${date}T${start}`, shift_end: `${date}T${end}`, role: 'Cashier' },
      });
      expect(shift.res.statusCode).toBe(201);
    }
    const created = await call(ctrl.createTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      body: { request_type: 'sick', start_date: '2026-12-14', end_date: '2026-12-16' },
    });
    expect(created.res.statusCode).toBe(201);
    expect(created.res.body.pto_balance).toEqual({ balance: 20, required: 10, unit: 'hours' });
    const approved = await call(ctrl.decideTimeOffRequest, {
      ...asManager(MANAGER),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
      body: { decision: 'approved' },
    });
    expect(approved.res.body.pto_balance).toEqual({ balance: 10, required: 10, unit: 'hours' });
    const cancelled = await call(ctrl.cancelTimeOffRequest, {
      ...asEmployee(EMPLOYEE2),
      params: { businessId: String(bizId), requestId: String(created.res.body.request.id) },
    });
    expect(cancelled.res.body.pto_balance).toEqual({ restored: 10, unit: 'hours', balance: 20 });
  });

  test('publish evaluates each location under its own jurisdiction rules (finding 30)', async () => {
    const { rows: [rest] } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, 'Publish Rules Grill') RETURNING id`,
      [bizId, OWNER]
    );
    const { rows: [locA] } = await db.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone) VALUES ($1, 'CA Store', 'America/Los_Angeles') RETURNING id`,
      [rest.id]
    );
    const { rows: [locB] } = await db.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone) VALUES ($1, 'FED Store', 'America/New_York') RETURNING id`,
      [rest.id]
    );
    await db.query(
      `INSERT INTO restaurant_labor_jurisdictions (restaurant_id, location_id, jurisdiction_code)
       VALUES ($1, $2, 'US-CA'), ($1, $3, 'US-FED')`,
      [rest.id, locA.id, locB.id]
    );
    // Two 10h shifts for the same adult on different days/stores.
    // California prices 8h daily overtime (advisory at publish);
    // US-FED has no daily threshold, so the second day warns nothing.
    for (const [loc, date] of [[locA, '2026-11-09'], [locB, '2026-11-10']]) {
      await db.query(
        `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, location_id, restaurant_id)
         VALUES ($1, $2, $3, '09:00', '19:00', 'Server', $4, $5)`,
        [bizId, EMPLOYEE, date, loc.id, rest.id]
      );
    }
    const pub = await call(ctrl.publishShifts, {
      ...asManager(MANAGER),
      body: { from: '2026-11-09', to: '2026-11-10', restaurant_id: rest.id },
    });
    expect(pub.error).toBeNull();
    expect(pub.res.statusCode).toBe(200);
    expect(pub.res.body.published).toBe(2);
    // The 10h day clears the 12h double-time threshold under CA rules
    // (the advisory count sees the just-published shift twice, once as
    // context and once as the publish, a pre-existing duplication in
    // the advisory evaluation, so 20h is reported). Exactly one
    // double-time warning, for the California day: the old code ran
    // the whole batch under the first shift's (CA) rules and warned
    // for both days; per-location evaluation warns only for the CA day.
    const dailyDt = (pub.res.body.rule_warnings || []).filter((w) => w.rule === 'daily_doubletime');
    expect(dailyDt).toHaveLength(1);
    expect(dailyDt[0].message).toContain('2026-11-09');
  });
});
