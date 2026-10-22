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
});
