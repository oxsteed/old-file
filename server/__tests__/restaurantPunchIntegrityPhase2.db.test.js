'use strict';

/**
 * DB tests: Phase 2 punch integrity (goal goal_a0fc7c0f0394) against a
 * real migrated database.
 *
 * Proves, end to end through the HTTP handlers:
 *   - concurrent clock-ins from two sessions admit exactly one open
 *     entry (the loser gets a clean 409 from the partial unique index,
 *     not a second open punch); a voided entry does not block a new
 *     clock-in;
 *   - concurrent break updates do not lose a break (one 200, one 409,
 *     exactly one open break in the array);
 *   - a forgotten punch is flagged and auto-closed at the documented
 *     policy (published shift end, or clock-in + 12h with no shift),
 *     the system-closed flag is visible on the entry and in payroll,
 *     and re-running the sweep closes nothing twice;
 *   - an employee correction request changes nothing until a manager
 *     approves it, and approval lands through the append-only audit;
 *   - a punch spanning the spring-forward DST change computes the real
 *     elapsed hours (7, not 8);
 *   - geofence and staff-PIN proof are opt-in per location: enforced
 *     only where coordinates / a PIN are configured, never blocking
 *     where they are not.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
 *     npx jest __tests__/restaurantPunchIntegrityPhase2.db.test.js
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPayrollPhase1.db.test.js.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const express = require('express');
const request = require('supertest');

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
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase2-test-secret';
}

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const scheduleCtrl = require('../controllers/businessStaffScheduleController');
const payrollService = require('../services/restaurantPayrollService');

jest.setTimeout(90000);

function appFor(userId, businessRole) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'phase2@example.com', role: 'customer' };
    req.businessRole = businessRole;
    next();
  });
  app.post('/api/businesses/:businessId/staff/clock-in', scheduleCtrl.clockIn);
  app.post('/api/businesses/:businessId/staff/clock-out/:entryId', scheduleCtrl.clockOut);
  app.post('/api/businesses/:businessId/staff/time-entries/:entryId/break', scheduleCtrl.punchBreak);
  app.get('/api/businesses/:businessId/staff/time-entries', scheduleCtrl.listTimeEntries);
  app.get('/api/businesses/:businessId/staff/time-entries/mine', scheduleCtrl.listMyTimeEntries);
  app.patch('/api/businesses/:businessId/staff/time-entries/:entryId', scheduleCtrl.editTimeEntry);
  app.post('/api/businesses/:businessId/staff/time-entries/:entryId/void', scheduleCtrl.voidTimeEntry);
  app.post('/api/businesses/:businessId/staff/time-entries/close-stale', scheduleCtrl.closeStaleTimeEntries);
  app.post('/api/businesses/:businessId/staff/time-entries/:entryId/corrections', scheduleCtrl.requestTimeEntryCorrection);
  app.get('/api/businesses/:businessId/staff/time-entry-corrections', scheduleCtrl.listTimeEntryCorrections);
  app.get('/api/businesses/:businessId/staff/time-entry-corrections/mine', scheduleCtrl.listMyTimeEntryCorrections);
  app.post('/api/businesses/:businessId/staff/time-entry-corrections/:correctionId/decide', scheduleCtrl.decideTimeEntryCorrection);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Phase2', $3, 'customer', TRUE, TRUE)`,
    [id, `phase2-${label}-${id}@example.invalid`, label]
  );
  return id;
}

async function makeBusiness(owner, name, timezone = 'UTC') {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
    [owner, name, timezone]
  );
  return Number(b.id);
}

async function addMember(businessId, owner, userId, wageCents = 2000) {
  await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status, job_role, hourly_wage_cents)
     VALUES ($1, $2, $3, $4, 'employee', 'active', 'Cook', $5)`,
    [businessId, owner, userId, `member-${userId.slice(0, 8)}@example.invalid`, wageCents]
  );
}

async function addRestaurant(businessId, owner, timezone = 'UTC') {
  const { rows: [r] } = await pool.query(
    `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
     VALUES ($1, $2, $3, $4, 'USD') RETURNING id`,
    [businessId, owner, `Phase 2 ${crypto.randomUUID().slice(0, 8)}`, timezone]
  );
  return Number(r.id);
}

async function addLocation(restaurantId, { timezone = 'UTC', latitude = null, longitude = null } = {}) {
  const { rows: [loc] } = await pool.query(
    `INSERT INTO restaurant_locations
       (restaurant_id, name, address_country, address_state, timezone, currency_code, latitude, longitude, is_primary)
     VALUES ($1, $2, 'US', 'NY', $3, 'USD', $4, $5, FALSE) RETURNING id`,
    [restaurantId, `Store ${crypto.randomUUID().slice(0, 8)}`, timezone, latitude, longitude]
  );
  return Number(loc.id);
}

function yesterdayDate() {
  const d = new Date(Date.now() - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

ddescribe('Phase 2: concurrent clock-ins admit exactly one open punch', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const businessId = await makeBusiness(owner, `Phase 2 Race ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, employee);
    F = { owner, employee, businessId };
  });

  test('two simultaneous clock-ins: one 201, one 409, one open entry', async () => {
    const app = appFor(F.employee, 'employee');
    const url = `/api/businesses/${F.businessId}/staff/clock-in`;
    const [first, second] = await Promise.all([
      request(app).post(url).send({}),
      request(app).post(url).send({}),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    expect(winner.body.clock_in_at).toBeTruthy();
    F.openEntryId = winner.body.id;

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM business_time_entries
        WHERE business_id = $1 AND user_id = $2
          AND clock_in_at IS NOT NULL AND clock_out_at IS NULL AND voided_at IS NULL`,
      [F.businessId, F.employee]
    );
    expect(rows[0].n).toBe(1);
  });

  test('a voided entry does not block the next clock-in', async () => {
    const voided = await request(appFor(F.owner, 'owner'))
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${F.openEntryId}/void`)
      .send({ reason: 'Test void frees the punch' });
    expect(voided.status).toBe(200);
    const again = await request(appFor(F.employee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    expect(again.status).toBe(201);
    F.openEntryId = again.body.id;
    const out = await request(appFor(F.employee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${F.openEntryId}`).send({});
    expect(out.status).toBe(200);
  });
});

ddescribe('Phase 2: concurrent break updates do not lose a break', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const businessId = await makeBusiness(owner, `Phase 2 Break ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, employee);
    F = { owner, employee, businessId };
  });

  test('two simultaneous break starts: one 200, one 409, exactly one open break', async () => {
    const app = appFor(F.employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    F.entryId = inRes.body.id;
    const url = `/api/businesses/${F.businessId}/staff/time-entries/${F.entryId}/break`;
    const [first, second] = await Promise.all([
      request(app).post(url).send({ action: 'start' }),
      request(app).post(url).send({ action: 'start' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const { rows: [row] } = await pool.query(
      'SELECT breaks FROM business_time_entries WHERE id = $1', [F.entryId]
    );
    expect(Array.isArray(row.breaks)).toBe(true);
    expect(row.breaks.length).toBe(1);
    expect(row.breaks[0].ended_at).toBeNull();
  });

  test('break end, then a second break cycle, both persist', async () => {
    const app = appFor(F.employee, 'employee');
    const url = `/api/businesses/${F.businessId}/staff/time-entries/${F.entryId}/break`;
    const end = await request(app).post(url).send({ action: 'end' });
    expect(end.status).toBe(200);
    const start2 = await request(app).post(url).send({ action: 'start' });
    expect(start2.status).toBe(200);
    const end2 = await request(app).post(url).send({ action: 'end' });
    expect(end2.status).toBe(200);
    const { rows: [row] } = await pool.query(
      'SELECT breaks FROM business_time_entries WHERE id = $1', [F.entryId]
    );
    // Two full cycles, nothing lost: both breaks present, both closed.
    expect(row.breaks.length).toBe(2);
    expect(row.breaks.every((b) => b.started_at && b.ended_at)).toBe(true);
    const out = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${F.entryId}`).send({});
    expect(out.status).toBe(200);
  });
});

ddescribe('Phase 2: forgotten punches are flagged and auto-closed', () => {
  test('closes at the published shift end, flagged system-closed, visible in payroll', async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const businessId = await makeBusiness(owner, `Phase 2 Close Shift ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, employee);
    const restaurantId = await addRestaurant(businessId, owner);
    const locationId = await addLocation(restaurantId);
    const day = yesterdayDate();
    const app = appFor(employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    const entryId = inRes.body.id;
    // Explicit AT TIME ZONE 'UTC': a bare ::timestamptz cast would
    // interpret 09:00 in the database session's timezone (EST here),
    // moving the punch by 5 hours.
    await pool.query(
      `UPDATE business_time_entries
          SET clock_in_at = (($2::date + TIME '09:00') AT TIME ZONE 'UTC'), entry_date = $2::date, location_id = $3
        WHERE id = $1`,
      [entryId, day, locationId]
    );
    const { rows: [shift] } = await pool.query(
      `INSERT INTO business_staff_shifts
         (business_id, user_id, shift_date, start_time, end_time, role_label, location_id, published_at)
       VALUES ($1, $2, $3::date, '09:00', '17:00', 'Cook', $4, NOW()) RETURNING id`,
      [businessId, employee, day, locationId]
    );
    expect(shift.id).toBeTruthy();

    const res = await request(appFor(owner, 'owner'))
      .post(`/api/businesses/${businessId}/staff/time-entries/close-stale`).send({});
    expect(res.status).toBe(200);
    expect(res.body.closed.length).toBe(1);
    const closed = res.body.closed[0];
    expect(closed.id).toBe(entryId);
    expect(closed.system_closed).toBe(true);
    expect(closed.system_closed_reason).toBe('auto_close_shift_end');
    expect(Number(closed.hours_worked)).toBe(8);
    // Closed at the shift end (17:00 UTC on the shift date), not at sweep time.
    expect(String(closed.clock_out_at)).toBe(`${day}T17:00:00.000Z`);

    const { rows: [row] } = await pool.query(
      'SELECT * FROM business_time_entries WHERE id = $1', [entryId]
    );
    expect(row.system_closed_at).toBeTruthy();
    expect(Number(row.hours_worked)).toBe(8);

    // The flag is visible where hours are shown (manager list) and in payroll.
    const list = await request(appFor(owner, 'owner'))
      .get(`/api/businesses/${businessId}/staff/time-entries`);
    const listed = list.body.find((e) => e.id === entryId);
    expect(listed.system_closed).toBe(true);
    const labor = await payrollService.computeLabor({
      restaurant: { id: restaurantId, business_id: businessId, currency_code: 'USD', timezone: 'UTC' },
      fromDate: day, toDate: day, locationIds: null,
    });
    const emp = labor.employees.find((e) => e.user_id === employee);
    expect(emp).toBeTruthy();
    expect(emp.system_closed_hours).toBe(8);
    expect(emp.system_closed_entries).toBe(1);

    // Re-running the sweep is a no-op.
    const again = await request(appFor(owner, 'owner'))
      .post(`/api/businesses/${businessId}/staff/time-entries/close-stale`).send({});
    expect(again.status).toBe(200);
    expect(again.body.closed.length).toBe(0);
  });

  test('with no published shift, closes at clock-in + 12 hours (the documented cap)', async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const businessId = await makeBusiness(owner, `Phase 2 Close Cap ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, employee);
    const day = yesterdayDate();
    const app = appFor(employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    const entryId = inRes.body.id;
    await pool.query(
      `UPDATE business_time_entries
          SET clock_in_at = (($2::date + TIME '09:00') AT TIME ZONE 'UTC'), entry_date = $2::date
        WHERE id = $1`,
      [entryId, day]
    );
    const res = await request(appFor(owner, 'owner'))
      .post(`/api/businesses/${businessId}/staff/time-entries/close-stale`).send({});
    expect(res.status).toBe(200);
    expect(res.body.closed.length).toBe(1);
    expect(res.body.closed[0].system_closed_reason).toBe('auto_close_12h_cap');
    expect(Number(res.body.closed[0].hours_worked)).toBe(12);
    expect(String(res.body.closed[0].clock_out_at)).toBe(`${day}T21:00:00.000Z`);
  });

  test('a punch open less than the grace window is left alone', async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const businessId = await makeBusiness(owner, `Phase 2 Close Fresh ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, employee);
    const app = appFor(employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    await pool.query(
      "UPDATE business_time_entries SET clock_in_at = NOW() - INTERVAL '1 hour' WHERE id = $1",
      [inRes.body.id]
    );
    const res = await request(appFor(owner, 'owner'))
      .post(`/api/businesses/${businessId}/staff/time-entries/close-stale`).send({});
    expect(res.status).toBe(200);
    expect(res.body.closed.length).toBe(0);
    const { rows: [row] } = await pool.query(
      'SELECT clock_out_at FROM business_time_entries WHERE id = $1', [inRes.body.id]
    );
    expect(row.clock_out_at).toBeNull();
    await request(app).post(`/api/businesses/${businessId}/staff/clock-out/${inRes.body.id}`).send({});
  });
});

ddescribe('Phase 2: employee punch-correction flow', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const other = await newUser('other');
    const businessId = await makeBusiness(owner, `Phase 2 Correct ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, employee);
    await addMember(businessId, owner, other);
    F = { owner, employee, other, businessId };
  });

  test('a pending request changes nothing until a manager approves it', async () => {
    const app = appFor(F.employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    const entryId = inRes.body.id;
    const { rows: [row] } = await pool.query(
      'SELECT clock_in_at FROM business_time_entries WHERE id = $1', [entryId]
    );
    const clockIn = new Date(row.clock_in_at);
    const fixedOut = new Date(clockIn.getTime() + 2 * 3600 * 1000).toISOString();

    const noReason = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/corrections`)
      .send({ clock_out_at: fixedOut });
    expect(noReason.status).toBe(400);

    const created = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/corrections`)
      .send({ clock_out_at: fixedOut, reason: 'Forgot to clock out at close' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('pending');
    F.correctionId = created.body.id;
    F.entryId = entryId;

    // Hours are untouched while pending: the punch is still open.
    const { rows: [stillOpen] } = await pool.query(
      'SELECT clock_out_at, hours_worked FROM business_time_entries WHERE id = $1', [entryId]
    );
    expect(stillOpen.clock_out_at).toBeNull();
    expect(stillOpen.hours_worked).toBeNull();
    const mine = await request(app)
      .get(`/api/businesses/${F.businessId}/staff/time-entry-corrections/mine`);
    expect(mine.status).toBe(200);
    expect(mine.body.some((c) => c.id === F.correctionId && c.status === 'pending')).toBe(true);

    // A second pending correction for the same punch is a 409.
    const dup = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/corrections`)
      .send({ clock_out_at: fixedOut, reason: 'Again' });
    expect(dup.status).toBe(409);

    // Another employee cannot request for this punch; an employee cannot decide.
    const stranger = await request(appFor(F.other, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/corrections`)
      .send({ clock_out_at: fixedOut, reason: 'Not mine' });
    expect(stranger.status).toBe(403);
    const selfDecide = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/time-entry-corrections/${F.correctionId}/decide`)
      .send({ decision: 'approved' });
    expect(selfDecide.status).toBe(403);

    // Manager approval applies the change with the audit trail.
    const decided = await request(appFor(F.owner, 'owner'))
      .post(`/api/businesses/${F.businessId}/staff/time-entry-corrections/${F.correctionId}/decide`)
      .send({ decision: 'approved' });
    expect(decided.status).toBe(200);
    expect(decided.body.correction.status).toBe('approved');
    expect(Number(decided.body.entry.hours_worked)).toBe(2);
    expect(decided.body.entry.clock_out_at).toBe(fixedOut);

    const { rows: edits } = await pool.query(
      `SELECT * FROM business_time_entry_edits WHERE entry_id = $1 AND field = 'clock_out_at'`,
      [entryId]
    );
    expect(edits.length).toBe(1);
    expect(edits[0].editor_user_id).toBe(F.employee);
    expect(edits[0].approved_by).toBe(F.owner);
    expect(edits[0].reason).toBe('Forgot to clock out at close');

    // Deciding twice is a 409.
    const twice = await request(appFor(F.owner, 'owner'))
      .post(`/api/businesses/${F.businessId}/staff/time-entry-corrections/${F.correctionId}/decide`)
      .send({ decision: 'approved' });
    expect(twice.status).toBe(409);
  });

  test('a rejected correction leaves the punch untouched', async () => {
    const app = appFor(F.employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    const entryId = inRes.body.id;
    const created = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/corrections`)
      .send({ description: 'Worked the bar, not the floor', reason: 'Wrong station note' });
    expect(created.status).toBe(201);
    const rejected = await request(appFor(F.owner, 'owner'))
      .post(`/api/businesses/${F.businessId}/staff/time-entry-corrections/${created.body.id}/decide`)
      .send({ decision: 'rejected', reason: 'Station is set by the schedule, not the punch' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.correction.status).toBe('rejected');
    const { rows: [row] } = await pool.query(
      'SELECT description, clock_out_at FROM business_time_entries WHERE id = $1', [entryId]
    );
    expect(row.description).toBeNull();
    expect(row.clock_out_at).toBeNull();
    await request(app).post(`/api/businesses/${F.businessId}/staff/clock-out/${entryId}`).send({});
  });
});

ddescribe('Phase 2: finding 10 — no self-approval on punch edits or corrections', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const manager2 = await newUser('manager2');
    const employee = await newUser('employee');
    const businessId = await makeBusiness(owner, `Phase 2 SelfApproval ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, employee);
    F = { owner, manager2, employee, businessId };
  });

  async function insertClosedPunch(userId) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, hours_worked)
       VALUES ($1, $2, '2026-10-06'::date, '2026-10-06T13:00:00Z'::timestamptz, '2026-10-06T21:00:00Z'::timestamptz, 8)
       RETURNING id`,
      [F.businessId, userId]
    );
    return Number(row.id);
  }

  test('a manager editing their own punch files a correction request instead of self-approving', async () => {
    const entryId = await insertClosedPunch(F.owner);
    const routed = await request(appFor(F.owner, 'owner'))
      .patch(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}`)
      .send({ clock_out_at: '2026-10-06T22:00:00Z', reason: 'Stayed an hour late' });
    expect(routed.status).toBe(201);
    expect(routed.body.status).toBe('pending');
    expect(routed.body.requester_user_id).toBe(F.owner);
    expect(Number(routed.body.entry_id)).toBe(entryId);
    // The entry is untouched and carries no self-approval stamp.
    const { rows: [untouched] } = await pool.query(
      'SELECT clock_out_at, hours_worked, approved_by FROM business_time_entries WHERE id = $1', [entryId]
    );
    expect(new Date(untouched.clock_out_at).toISOString()).toBe('2026-10-06T21:00:00.000Z');
    expect(Number(untouched.hours_worked)).toBe(8);
    expect(untouched.approved_by).toBeNull();
    const { rows: edits } = await pool.query(
      'SELECT * FROM business_time_entry_edits WHERE entry_id = $1', [entryId]
    );
    expect(edits).toHaveLength(0);
    // A second self-edit while one is pending is a 409, not a new request.
    const dup = await request(appFor(F.owner, 'owner'))
      .patch(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}`)
      .send({ clock_out_at: '2026-10-06T22:30:00Z', reason: 'Again' });
    expect(dup.status).toBe(409);
    // A different manager decides it, and the change lands with the
    // requester as editor and the decider as approver.
    const decided = await request(appFor(F.manager2, 'manager'))
      .post(`/api/businesses/${F.businessId}/staff/time-entry-corrections/${routed.body.id}/decide`)
      .send({ decision: 'approved' });
    expect(decided.status).toBe(200);
    expect(decided.body.correction.status).toBe('approved');
    expect(Number(decided.body.entry.hours_worked)).toBe(9);
    const { rows: [edit] } = await pool.query(
      `SELECT * FROM business_time_entry_edits WHERE entry_id = $1 AND field = 'clock_out_at'`, [entryId]
    );
    expect(edit.editor_user_id).toBe(F.owner);
    expect(edit.approved_by).toBe(F.manager2);
  });

  test('a manager cannot decide their own correction request', async () => {
    const entryId = await insertClosedPunch(F.manager2);
    const created = await request(appFor(F.manager2, 'manager'))
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/corrections`)
      .send({ clock_out_at: '2026-10-06T22:00:00Z', reason: 'Stayed late' });
    expect(created.status).toBe(201);
    const selfDecide = await request(appFor(F.manager2, 'manager'))
      .post(`/api/businesses/${F.businessId}/staff/time-entry-corrections/${created.body.id}/decide`)
      .send({ decision: 'approved' });
    expect(selfDecide.status).toBe(409);
    expect(String(selfDecide.body.error)).toContain('own punch correction');
    const decided = await request(appFor(F.owner, 'owner'))
      .post(`/api/businesses/${F.businessId}/staff/time-entry-corrections/${created.body.id}/decide`)
      .send({ decision: 'approved' });
    expect(decided.status).toBe(200);
    expect(decided.body.correction.status).toBe('approved');
  });

  test('a manager editing another employee punch still applies directly', async () => {
    const entryId = await insertClosedPunch(F.employee);
    const edited = await request(appFor(F.owner, 'owner'))
      .patch(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}`)
      .send({ description: 'Covered the bar', reason: 'Fix the station note' });
    expect(edited.status).toBe(200);
    expect(edited.body.description).toBe('Covered the bar');
    const { rows: [edit] } = await pool.query(
      `SELECT * FROM business_time_entry_edits WHERE entry_id = $1 AND field = 'description'`, [entryId]
    );
    expect(edit.editor_user_id).toBe(F.owner);
    expect(edit.approved_by).toBe(F.owner);
  });
});

ddescribe('Phase 2: DST-boundary punch computes real elapsed hours', () => {
  test('22:00 EST to 06:00 EDT on spring-forward night is 7 hours, not 8', async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    // America/New_York: 2026-03-08 02:00 EST jumps to 03:00 EDT.
    const businessId = await makeBusiness(owner, `Phase 2 DST ${crypto.randomUUID().slice(0, 8)}`, 'America/New_York');
    await addMember(businessId, owner, employee);
    const app = appFor(employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    const entryId = inRes.body.id;
    await pool.query(
      `UPDATE business_time_entries
          SET clock_in_at = '2026-03-07T22:00:00-05:00', entry_date = '2026-03-07'::date
        WHERE id = $1`,
      [entryId]
    );
    const created = await request(app)
      .post(`/api/businesses/${businessId}/staff/time-entries/${entryId}/corrections`)
      .send({ clock_out_at: '2026-03-08T06:00:00-04:00', reason: 'Forgot to clock out after the DST night' });
    expect(created.status).toBe(201);
    const decided = await request(appFor(owner, 'owner'))
      .post(`/api/businesses/${businessId}/staff/time-entry-corrections/${created.body.id}/decide`)
      .send({ decision: 'approved' });
    expect(decided.status).toBe(200);
    // Wall-clock subtraction would say 8 hours; epoch arithmetic says 7.
    expect(Number(decided.body.entry.hours_worked)).toBe(7);
    // The work date stays the business-local day of the clock-in.
    expect(String(decided.body.entry.entry_date).slice(0, 10)).toBe('2026-03-07');
  });
});

ddescribe('Phase 2: geofence and staff-PIN proof are opt-in per location', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const farEmployee = await newUser('far');
    const noCoordEmployee = await newUser('nocoord');
    const pinEmployee = await newUser('pin');
    const businessId = await makeBusiness(owner, `Phase 2 Proof ${crypto.randomUUID().slice(0, 8)}`);
    for (const u of [employee, farEmployee, noCoordEmployee, pinEmployee]) {
      await addMember(businessId, owner, u);
    }
    const restaurantId = await addRestaurant(businessId, owner);
    // Store with coordinates: geofence enforced. Store without: not enforced.
    const geoLocationId = await addLocation(restaurantId, { latitude: 40.7128, longitude: -74.006 });
    const plainLocationId = await addLocation(restaurantId, {});
    // pinEmployee holds an active PIN of their own at the geofenced store.
    const pinHash = await bcrypt.hash('1234', 4);
    await pool.query(
      `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, staff_label, location_id, pin_hash, is_active)
       VALUES ($1, $2, 'PIN User', $3, $4, TRUE)`,
      [restaurantId, pinEmployee, geoLocationId, pinHash]
    );
    F = { owner, employee, farEmployee, noCoordEmployee, pinEmployee, businessId, restaurantId, geoLocationId, plainLocationId };
  });

  test('a punch at the store is accepted; a punch 100 km away is refused and creates nothing', async () => {
    const atStore = await request(appFor(F.employee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.geoLocationId, latitude: 40.7128, longitude: -74.006 });
    expect(atStore.status).toBe(201);
    expect(atStore.body.punch_meta.geofence.checked).toBe(true);
    expect(atStore.body.punch_meta.geofence.within).toBe(true);
    await request(appFor(F.employee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${atStore.body.id}`).send({});

    const far = await request(appFor(F.farEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.geoLocationId, latitude: 41.0, longitude: -74.006 });
    expect(far.status).toBe(403);
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM business_time_entries WHERE business_id = $1 AND user_id = $2',
      [F.businessId, F.farEmployee]
    );
    expect(rows[0].n).toBe(0);
  });

  test('no coordinates on the punch is never blocked, and a store with no coordinates enforces nothing', async () => {
    const noCoords = await request(appFor(F.noCoordEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.geoLocationId });
    expect(noCoords.status).toBe(201);
    expect(noCoords.body.punch_meta.geofence.checked).toBe(false);
    expect(noCoords.body.punch_meta.geofence.reason).toBe('no_coordinates');
    await request(appFor(F.noCoordEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${noCoords.body.id}`).send({});

    const plain = await request(appFor(F.noCoordEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.plainLocationId, latitude: 41.0, longitude: -74.006 });
    expect(plain.status).toBe(201);
    expect(plain.body.punch_meta.geofence.checked).toBe(false);
    expect(plain.body.punch_meta.geofence.reason).toBe('not_configured');
    await request(appFor(F.noCoordEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${plain.body.id}`).send({});
  });

  test('where a PIN is configured, clock-in requires the employee’s own PIN', async () => {
    const noPin = await request(appFor(F.pinEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.geoLocationId, latitude: 40.7128, longitude: -74.006 });
    expect(noPin.status).toBe(401);

    const wrongPin = await request(appFor(F.pinEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.geoLocationId, latitude: 40.7128, longitude: -74.006, staff_pin: '9999' });
    expect(wrongPin.status).toBe(401);

    const good = await request(appFor(F.pinEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.geoLocationId, latitude: 40.7128, longitude: -74.006, staff_pin: '1234' });
    expect(good.status).toBe(201);
    expect(good.body.punch_meta.staff_pin_verified).toBe(true);
    await request(appFor(F.pinEmployee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${good.body.id}`).send({});
  });

  test('where no PIN is configured, clock-in works exactly as before', async () => {
    const res = await request(appFor(F.employee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.geoLocationId, latitude: 40.7128, longitude: -74.006 });
    expect(res.status).toBe(201);
    expect(res.body.punch_meta.staff_pin_verified).toBeUndefined();
    await request(appFor(F.employee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${res.body.id}`).send({});
  });
});

ddescribe('Phase 7: unscheduled minor clock-in surfaces the shift cap (finding 49)', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const minor = await newUser('minor');
    const businessId = await makeBusiness(owner, `Phase 7 Minor Cap ${crypto.randomUUID().slice(0, 8)}`);
    await addMember(businessId, owner, minor);
    const restaurantId = await addRestaurant(businessId, owner);
    const locationId = await addLocation(restaurantId, {});
    const { rows: [{ id: membershipId }] } = await pool.query(
      'SELECT id FROM business_members WHERE business_id = $1 AND member_id = $2',
      [businessId, minor]
    );
    await pool.query(
      `INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status)
       VALUES ($1, $2, $3, 'active')`,
      [restaurantId, locationId, membershipId]
    );
    await pool.query(
      `INSERT INTO restaurant_labor_jurisdictions (restaurant_id, location_id, jurisdiction_code)
       VALUES ($1, $2, 'US-CA')`,
      [restaurantId, locationId]
    );
    await pool.query(
      `INSERT INTO business_staff_labor_profiles (business_id, user_id, minor_band, minor_until)
       VALUES ($1, $2, 'age_16_17', '2030-01-01')`,
      [businessId, minor]
    );
    F = { owner, minor, businessId, restaurantId, locationId };
  });

  test('clock-in with no published shift is allowed and capped at the CA 8h daily minor limit', async () => {
    const res = await request(appFor(F.minor, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-in`)
      .send({ locationId: F.locationId });
    expect(res.status).toBe(201);
    // No hours worked today, CA minor max daily is 8h: the cap is 8.
    expect(res.body.minor_shift_cap).toBe(8);
    expect(res.body.punch_meta.minor_flag.shift_cap_hours).toBe(8);
    expect(res.body.punch_meta.minor_flag.warnings.map((w) => w.rule)).toContain('minor_no_shift');
    await request(appFor(F.minor, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${res.body.id}`).send({});
  });
});
