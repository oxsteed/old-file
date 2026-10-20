'use strict';

/**
 * DB tests: the generic time clock (staff review S-05).
 *
 * The pre-S-05 clockIn/clockOut/listTimeEntries read and wrote columns
 * that do not exist on business_time_entries (clock_in, clock_out, notes,
 * updated_at vs the migration-238 schema), so every call 500'd against a
 * real database while the mocked unit suite stayed green. These tests
 * run the handlers against the real migrated st_t3 schema:
 *   - one punch model (clock_in_at / clock_out_at / breaks),
 *   - hours computed at clock-out, net of breaks,
 *   - clock-out ownership (owner or manager only),
 *   - append-only audited edits with a reason and manager approver,
 *   - voiding instead of hard deletes in BOTH time-entry APIs.
 *
 * Run with:
 *   ST_T3_TEST_DATABASE_URL=postgresql://.../st_t3 \
 *     npx jest __tests__/businessTimeClock.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.ST_T3_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/st_t3';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable st_t3 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'st-t3-test-secret';
}

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const scheduleCtrl = require('../controllers/businessStaffScheduleController');
const staffCtrl = require('../controllers/staffSchedulingController');

jest.setTimeout(60000);

// Minimal stand-in for requireAuth + requireBusinessAccess: the test
// supplies the user id and the role the middleware would have resolved.
function appFor(userId, businessRole) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'clock@example.com', role: 'customer' };
    req.businessRole = businessRole;
    next();
  });
  app.get('/api/businesses/:businessId/staff/time-entries', scheduleCtrl.listTimeEntries);
  app.post('/api/businesses/:businessId/staff/clock-in', scheduleCtrl.clockIn);
  app.post('/api/businesses/:businessId/staff/clock-out/:entryId', scheduleCtrl.clockOut);
  app.post('/api/businesses/:businessId/staff/time-entries/:entryId/break', scheduleCtrl.punchBreak);
  app.patch('/api/businesses/:businessId/staff/time-entries/:entryId', scheduleCtrl.editTimeEntry);
  app.post('/api/businesses/:businessId/staff/time-entries/:entryId/void', scheduleCtrl.voidTimeEntry);
  app.post('/api/businesses/:businessId/time-entries', staffCtrl.logHours);
  app.get('/api/businesses/:businessId/time-entries', staffCtrl.getTimeEntries);
  app.delete('/api/businesses/:businessId/time-entries/:id', staffCtrl.deleteTimeEntry);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Clock', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `time-clock-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('time clock punch model (S-05)', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const employee = await newUser('employee');
    const other = await newUser('other');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Time Clock ${crypto.randomUUID().slice(0, 8)}`]
    );
    for (const memberId of [employee, other]) {
      const { rows: [memberUser] } = await pool.query('SELECT email FROM users WHERE id = $1', [memberId]);
      await pool.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
         VALUES ($1, $2, $3, $4, 'employee', 'active')`,
        [biz.id, owner, memberId, memberUser.email]
      );
    }
    F = { owner, employee, other, businessId: biz.id };
  });

  test('clock-in creates an open punch on the real schema; double clock-in conflicts', async () => {
    const app = appFor(F.employee, 'employee');
    const res = await request(app).post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    expect(res.status).toBe(201);
    expect(res.body.clock_in_at).toBeTruthy();
    expect(res.body.clock_out_at).toBeNull();
    expect(res.body.hours_worked).toBeNull();
    F.openEntryId = res.body.id;

    const again = await request(app).post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    expect(again.status).toBe(409);
  });

  test('another employee cannot clock out the entry; the owner of the entry can', async () => {
    const intruder = await request(appFor(F.other, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${F.openEntryId}`)
      .send({});
    expect(intruder.status).toBe(403);

    // Backdate the punch two hours so the computed hours are meaningful.
    await pool.query(
      "UPDATE business_time_entries SET clock_in_at = NOW() - INTERVAL '2 hours' WHERE id = $1",
      [F.openEntryId]
    );
    const out = await request(appFor(F.employee, 'employee'))
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${F.openEntryId}`)
      .send({});
    expect(out.status).toBe(200);
    expect(out.body.clock_out_at).toBeTruthy();
    expect(Number(out.body.hours_worked)).toBeGreaterThan(1.9);
    expect(Number(out.body.hours_worked)).toBeLessThanOrEqual(2.1);
    F.closedEntryId = F.openEntryId;
  });

  test('breaks reduce the computed hours', async () => {
    const app = appFor(F.employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    expect(inRes.status).toBe(201);
    const entryId = inRes.body.id;
    await pool.query(
      "UPDATE business_time_entries SET clock_in_at = NOW() - INTERVAL '2 hours' WHERE id = $1",
      [entryId]
    );
    const breakStart = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/break`)
      .send({ action: 'start' });
    expect(breakStart.status).toBe(200);
    await pool.query(
      `UPDATE business_time_entries
          SET breaks = jsonb_build_array(jsonb_build_object(
            'started_at', (NOW() - INTERVAL '30 minutes')::text, 'ended_at', NULL))
        WHERE id = $1`,
      [entryId]
    );
    const breakEnd = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/break`)
      .send({ action: 'end' });
    expect(breakEnd.status).toBe(200);
    const out = await request(app)
      .post(`/api/businesses/${F.businessId}/staff/clock-out/${entryId}`)
      .send({});
    expect(out.status).toBe(200);
    expect(Number(out.body.hours_worked)).toBeGreaterThan(1.4);
    expect(Number(out.body.hours_worked)).toBeLessThan(1.6);
  });

  test('listTimeEntries returns punches (the endpoint that used to 500)', async () => {
    const res = await request(appFor(F.owner, 'owner'))
      .get(`/api/businesses/${F.businessId}/staff/time-entries`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const closed = res.body.find((e) => e.id === F.closedEntryId);
    expect(closed).toBeTruthy();
    expect(closed.clock_in).toBeTruthy(); // legacy alias for StaffScheduler
    expect(Number(closed.hours)).toBeGreaterThan(1.9);
  });

  test('manager edits are append-only audited and require a reason', async () => {
    const noReason = await request(appFor(F.owner, 'owner'))
      .patch(`/api/businesses/${F.businessId}/staff/time-entries/${F.closedEntryId}`)
      .send({ description: 'Front counter' });
    expect(noReason.status).toBe(400);

    const byEmployee = await request(appFor(F.employee, 'employee'))
      .patch(`/api/businesses/${F.businessId}/staff/time-entries/${F.closedEntryId}`)
      .send({ description: 'Front counter', reason: 'Forgot to note it' });
    expect(byEmployee.status).toBe(403);

    const edited = await request(appFor(F.owner, 'owner'))
      .patch(`/api/businesses/${F.businessId}/staff/time-entries/${F.closedEntryId}`)
      .send({ description: 'Front counter', reason: 'Employee confirmed duties' });
    expect(edited.status).toBe(200);
    expect(edited.body.description).toBe('Front counter');
    expect(edited.body.approved_by).toBe(F.owner);

    const { rows: edits } = await pool.query(
      'SELECT * FROM business_time_entry_edits WHERE entry_id = $1',
      [F.closedEntryId]
    );
    expect(edits.length).toBe(1);
    expect(edits[0].field).toBe('description');
    expect(edits[0].new_value).toBe('Front counter');
    expect(edits[0].reason).toBe('Employee confirmed duties');
  });

  test('voiding keeps the row, excludes it from lists, and writes an audit row', async () => {
    const app = appFor(F.employee, 'employee');
    const inRes = await request(app).post(`/api/businesses/${F.businessId}/staff/clock-in`).send({});
    const entryId = inRes.body.id;
    await request(app).post(`/api/businesses/${F.businessId}/staff/clock-out/${entryId}`).send({});

    const voided = await request(appFor(F.owner, 'owner'))
      .post(`/api/businesses/${F.businessId}/staff/time-entries/${entryId}/void`)
      .send({ reason: 'Duplicate punch' });
    expect(voided.status).toBe(200);
    expect(voided.body.voided_at).toBeTruthy();

    const { rows: [row] } = await pool.query('SELECT * FROM business_time_entries WHERE id = $1', [entryId]);
    expect(row).toBeTruthy();
    expect(row.void_reason).toBe('Duplicate punch');

    const list = await request(appFor(F.owner, 'owner'))
      .get(`/api/businesses/${F.businessId}/staff/time-entries`);
    expect(list.body.some((e) => e.id === entryId)).toBe(false);
  });

  test('the parallel scheduling API voids instead of hard-deleting, and manual logs carry an approver', async () => {
    const logged = await request(appFor(F.owner, 'owner'))
      .post(`/api/businesses/${F.businessId}/time-entries`)
      .send({ user_id: F.employee, hours_worked: 3.5, description: 'Deep clean' });
    expect(logged.status).toBe(201);
    const entryId = logged.body.entry.id;
    expect(logged.body.entry.approved_by).toBe(F.owner);

    const removed = await request(appFor(F.owner, 'owner'))
      .delete(`/api/businesses/${F.businessId}/time-entries/${entryId}`)
      .send({});
    expect(removed.status).toBe(200);
    expect(removed.body.voided).toBe(true);

    const { rows: [row] } = await pool.query('SELECT * FROM business_time_entries WHERE id = $1', [entryId]);
    expect(row).toBeTruthy();
    expect(row.voided_at).toBeTruthy();

    const list = await request(appFor(F.owner, 'owner'))
      .get(`/api/businesses/${F.businessId}/time-entries`);
    expect(list.status).toBe(200);
    expect(list.body.entries.some((e) => e.id === entryId)).toBe(false);
  });
});
