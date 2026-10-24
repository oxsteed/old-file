'use strict';

/**
 * Staff remainders track W2 (S-14/S-17/S-18/S-19/S-20) against the real
 * migrated schema:
 *   - S-20: native labor-jurisdiction engine (evaluateSchedule pure rules,
 *     get/set endpoints, schedule version evidence on publish),
 *   - S-18: per-store pay rates preferred by the payroll roster,
 *   - S-17: crew task completion/review + training completion notifications,
 *   - S-19: server template interpolation with localized role names,
 *   - S-11: business_time_off_requests.user_id is SET NULL (migration 1510).
 *
 * Runs only against an explicitly opted-in disposable database:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/staffRemaindersW2.db.test.js
 */
function staffDbOptIn() {
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
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(),
}));

const db = require('../db');
const laborJurisdiction = require('../services/laborJurisdictionRules');
const scheduleCtrl = require('../controllers/businessStaffScheduleController');
const payroll = require('../services/restaurantPayrollService');
const appFlow = require('../controllers/restaurantAppFlowController');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const permissionsService = require('../services/permissionsService');
const { sendNotification } = require('../services/notificationService');
const { tNotif } = require('../utils/i18n');
const { staffRoleName } = require('../utils/staffNotificationTemplates');

const suite = url ? describe : describe.skip;

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
async function call(handler, req) {
  const res = mockRes();
  let error = null;
  await handler({ headers: {}, ...req }, res, (e) => { if (e) error = e; });
  return { res, error };
}

const stamp = `${Date.now()}`;
const rid = require('crypto').randomBytes(2).toString('hex');
const uid = (tail) => `c0000000-0000-4000-8000-${rid}${tail}`;
const OWNER = uid('11111111');
const MANAGER = uid('22222222');
const EMPLOYEE = uid('33333333');

let bizId, restaurantId, locationId;

async function insertUser(id, email, firstName) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active)
     VALUES ($1, $2, 'x', $3, 'Test', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [id, email, firstName]
  );
}

const asManager = () => ({ user: { id: MANAGER }, businessRole: 'manager', params: { businessId: String(bizId) } });

suite('W2 staff remainders (DB)', () => {
  beforeAll(async () => {
    await insertUser(OWNER, `w2-owner-${stamp}@example.com`, 'Olive');
    await insertUser(MANAGER, `w2-manager-${stamp}@example.com`, 'Moe');
    await insertUser(EMPLOYEE, `w2-employee-${stamp}@example.com`, 'Eli');
    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [OWNER, `W2 Biz ${stamp}`]
    );
    bizId = biz.id;
    for (const [id, role] of [[MANAGER, 'manager'], [EMPLOYEE, 'employee']]) {
      await db.query(
        `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW()) ON CONFLICT DO NOTHING`,
        [bizId, OWNER, id, role, `w2-${id.slice(-8)}@example.com`]
      );
    }
    const { rows: [rest] } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, currency_code)
       VALUES ($1, $2, $3, 'USD') RETURNING id`,
      [bizId, OWNER, `W2 Diner ${stamp}`]
    );
    restaurantId = rest.id;
    // A primary location may already exist (restaurant bootstrap); reuse it.
    const { rows: [existingLoc] } = await db.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary LIMIT 1`,
      [restaurantId]
    );
    if (existingLoc) {
      locationId = existingLoc.id;
    } else {
      const { rows: [loc] } = await db.query(
        `INSERT INTO restaurant_locations (restaurant_id, name, is_primary, timezone, status)
         VALUES ($1, $2, TRUE, 'America/New_York', 'active') RETURNING id`,
        [restaurantId, `W2 Store ${stamp}`]
      );
      locationId = loc.id;
    }
  }, 30000);

  beforeEach(() => {
    // The manager fixture has no store assignments, so its real rollout scope
    // is all stores. Initialize every test, including schedule publishing,
    // rather than relying on a later crew-notification test to set these mocks.
    resolveRestaurantAccess.mockResolvedValue({
      id: restaurantId,
      business_id: bizId,
      effective_role: 'manager',
    });
    getLocationScope.mockResolvedValue({ mode: 'all', location_ids: null });
    permissionsService.hasRestaurantPermission.mockResolvedValue(true);
  });

  afterAll(async () => { await db.end(); });

  test('S-20: evaluateSchedule flags CA daily overtime and clopening', () => {
    const rules = laborJurisdiction.resolveRules({ jurisdiction_code: 'US-CA' });
    expect(rules.daily_overtime_hours).toBe(8);
    const shifts = [
      { id: 1, user_id: EMPLOYEE, shift_date: '2026-10-26', start_time: '08:00', end_time: '14:00' }, // 6h
      { id: 2, user_id: EMPLOYEE, shift_date: '2026-10-26', start_time: '14:30', end_time: '18:30' }, // 4h, 0.5h rest
    ];
    const warnings = laborJurisdiction.evaluateSchedule(shifts, { rules });
    const kinds = warnings.map((w) => w.rule);
    expect(kinds).toContain('daily_overtime'); // 10h > 8h
    expect(kinds).toContain('min_rest_between_shifts'); // 0.5h < 10h
  });

  test('S-20: evaluateSchedule flags weekly overtime and schedule-notice', () => {
    const rules = laborJurisdiction.resolveRules({ jurisdiction_code: 'US-NYC' });
    const shifts = [];
    for (let d = 0; d < 6; d++) {
      shifts.push({
        id: 10 + d, user_id: EMPLOYEE,
        shift_date: `2026-10-${26 + d}`, start_time: '09:00', end_time: '17:00',
      });
    }
    const warnings = laborJurisdiction.evaluateSchedule(shifts, {
      rules, now: new Date('2026-10-20T12:00:00Z'),
    });
    const kinds = warnings.map((w) => w.rule);
    expect(kinds).toContain('weekly_overtime'); // 48h > 40h
    expect(kinds).toContain('schedule_notice'); // < 14 days notice
  });

  test('S-20: get/set labor jurisdiction round-trips per location', async () => {
    const setReq = asManager();
    setReq.body = {
      restaurant_id: restaurantId, location_id: locationId,
      jurisdiction_code: 'US-CA',
    };
    const { res: setRes, error: setErr } = await call(scheduleCtrl.setLaborJurisdiction, setReq);
    expect(setErr).toBeNull();
    expect(setRes.statusCode).toBe(201);
    expect(setRes.body.jurisdiction.jurisdiction_code).toBe('US-CA');
    expect(Number(setRes.body.jurisdiction.daily_overtime_hours)).toBe(8);

    const getReq = asManager();
    getReq.query = { restaurant_id: String(restaurantId), location_id: String(locationId) };
    const { res: getRes, error: getErr } = await call(scheduleCtrl.getLaborJurisdiction, getReq);
    expect(getErr).toBeNull();
    expect(getRes.body.configured).toBe(true);
    expect(Number(getRes.body.jurisdiction.min_rest_between_shifts_hours)).toBe(10);
  });

  test('S-20: publish writes a schedule version with rule warnings', async () => {
    // Draft shift that violates the CA clopening rule when published.
    const { rows: [s1] } = await db.query(
      `INSERT INTO business_staff_shifts
         (business_id, restaurant_id, location_id, user_id, shift_date, start_time, end_time, role_label)
       VALUES ($1, $2, $3, $4, '2026-10-27', '06:00', '14:00', 'Cook') RETURNING id`,
      [bizId, restaurantId, locationId, EMPLOYEE]
    );
    const { rows: [s2] } = await db.query(
      `INSERT INTO business_staff_shifts
         (business_id, restaurant_id, location_id, user_id, shift_date, start_time, end_time, role_label)
       VALUES ($1, $2, $3, $4, '2026-10-27', '14:30', '22:30', 'Cook') RETURNING id`,
      [bizId, restaurantId, locationId, EMPLOYEE]
    );
    const req = asManager();
    req.body = { shift_ids: [s1.id, s2.id], restaurant_id: restaurantId };
    const { res, error } = await call(scheduleCtrl.publishShifts, req);
    expect(error).toBeNull();
    expect(res.body.published).toBe(2);
    expect(Array.isArray(res.body.rule_warnings)).toBe(true);
    // 0.5h rest between the two shifts < 10h CA minimum.
    expect(res.body.rule_warnings.map((w) => w.rule)).toContain('min_rest_between_shifts');

    const { rows: [version] } = await db.query(
      `SELECT shift_count, rule_warnings FROM restaurant_schedule_versions
        WHERE business_id = $1 ORDER BY id DESC LIMIT 1`,
      [bizId]
    );
    expect(Number(version.shift_count)).toBe(2);
    expect(version.rule_warnings.length).toBeGreaterThan(0);
  });

  test('S-18: per-store pay rate overrides the business wage in the roster', async () => {
    const { rows: [membership] } = await db.query(
      `SELECT id FROM business_members WHERE business_id = $1 AND member_id = $2`,
      [bizId, EMPLOYEE]
    );
    await db.query(
      `UPDATE business_members SET hourly_wage_cents = 1500 WHERE id = $1`,
      [membership.id]
    );
    // Assign the employee to the store with a higher per-store rate.
    await db.query(
      `INSERT INTO restaurant_location_memberships
         (restaurant_id, location_id, membership_id, status, pay_rate_cents, pay_rate_period)
       VALUES ($1, $2, $3, 'active', 2200, 'hour')
       ON CONFLICT DO NOTHING`,
      [restaurantId, locationId, membership.id]
    );
    // Unscoped roster: business wage.
    const unscoped = await payroll.getRoster(bizId, null, restaurantId);
    const unscopedRow = unscoped.find((r) => String(r.user_id) === String(EMPLOYEE));
    expect(Number(unscopedRow.hourly_wage_cents)).toBe(1500);
    // Single-store roster: per-store rate wins.
    const scoped = await payroll.getRoster(bizId, [locationId], restaurantId);
    const scopedRow = scoped.find((r) => String(r.user_id) === String(EMPLOYEE));
    expect(Number(scopedRow.hourly_wage_cents)).toBe(2200);
  });

  test('S-11: business_time_off_requests.user_id is ON DELETE SET NULL (1510)', async () => {
    const { rows } = await db.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'business_time_off_requests'::regclass
          AND conname = 'business_time_off_requests_user_id_fkey'`
    );
    // confdeltype 'n' = SET NULL, 'c' = CASCADE.
    expect(rows[0].confdeltype).toBe('n');
    const { rows: [nullable] } = await db.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'business_time_off_requests' AND column_name = 'user_id'`
    );
    expect(nullable.is_nullable).toBe('YES');
  });

  test('S-19: staff templates interpolate with localized role names', () => {
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const { title, body } = tNotif('member_invite', lang, {
        businessName: 'Cafe Test', role: staffRoleName('manager', lang),
      });
      expect(title).toContain('Cafe Test');
      expect(body).toContain(staffRoleName('manager', lang));
      expect(body).not.toContain('{role}');
      expect(body).not.toContain('{businessName}');
    }
    expect(staffRoleName('manager', 'es')).toBe('gerente');
    expect(staffRoleName('employee', 'fr')).toBe('employé');
    const hired = tNotif('career_hired', 'en', {
      businessName: 'Cafe Test', openingTitle: 'Cook', role: staffRoleName('employee', 'en'),
    });
    expect(hired.body).toContain('Cook');
  });

  test('S-17: completing a crew task notifies the creator; review notifies the assignee', async () => {
    const restaurant = {
      id: restaurantId, business_id: bizId, display_name: `W2 Diner ${stamp}`,
      effective_role: 'manager',
    };
    resolveRestaurantAccess.mockResolvedValue(restaurant);
    getLocationScope.mockResolvedValue({ mode: 'all', location_ids: null });
    permissionsService.hasRestaurantPermission.mockResolvedValue(true);

    // Manager creates a task assigned to the employee (created_by = manager).
    const { rows: [task] } = await db.query(
      `INSERT INTO restaurant_crew_tasks
         (restaurant_id, location_id, assigned_to, title, status, created_by)
       VALUES ($1, $2, $3, 'Mop the floor', 'in_progress', $4)
       RETURNING *`,
      [restaurantId, locationId, EMPLOYEE, MANAGER]
    );
    sendNotification.mockClear();

    // Employee completes it: the creator (manager) is notified.
    const completeReq = {
      user: { id: EMPLOYEE }, params: { restaurantId: String(restaurantId), taskId: String(task.id) },
      body: { status: 'completed' },
    };
    const { res: completeRes, error: completeErr } = await call(appFlow.updateCrewTask, completeReq);
    expect(completeErr).toBeNull();
    expect(completeRes.body.task.status).toBe('completed');
    const completedCalls = sendNotification.mock.calls.filter((c) => c[0].type === 'crew_task_completed');
    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0][0].userId).toBe(MANAGER);
    expect(completedCalls[0][0].data.params.taskTitle).toBe('Mop the floor');

    // Manager approves (task needs_approval first): the assignee is notified.
    await db.query(
      `UPDATE restaurant_crew_tasks SET status = 'needs_approval', requires_approval = TRUE WHERE id = $1`,
      [task.id]
    );
    sendNotification.mockClear();
    const reviewReq = {
      user: { id: MANAGER }, params: { restaurantId: String(restaurantId), taskId: String(task.id) },
      body: { approved: true },
    };
    const { res: reviewRes, error: reviewErr } = await call(appFlow.reviewCrewTask, reviewReq);
    expect(reviewErr).toBeNull();
    expect(reviewRes.body.task.status).toBe('completed');
    const reviewedCalls = sendNotification.mock.calls.filter((c) => c[0].type === 'crew_task_reviewed');
    expect(reviewedCalls.length).toBe(1);
    expect(reviewedCalls[0][0].userId).toBe(EMPLOYEE);
    expect(reviewedCalls[0][0].data.params.approved).toBe(true);
  });
});
