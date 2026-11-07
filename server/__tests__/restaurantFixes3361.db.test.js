'use strict';

/**
 * DB tests: design-review items 33, 55, 61 (goal goal_a0fc7c0f0394)
 * against a real migrated database.
 *
 * Proves:
 *   - item 55: getMyPay/getMyTips compute the caller's single-employee
 *     slice directly, and the slice equals the row the whole-restaurant
 *     computation returns for that employee (labor row and tip
 *     currencies, for both employees);
 *   - item 33: the payroll exceptions report carries a
 *     punch_enforcement section listing, per location in scope,
 *     whether geofence coordinates are configured and how many roster
 *     staff at that store hold no active PIN there (a restaurant-wide
 *     PIN counts everywhere; a PIN scoped to another store does not);
 *   - item 61: deleteShift soft-deletes (row survives with
 *     cancelled_at, Fair Workweek before_state survives, a second
 *     delete behaves like the not-found path), and cancelled shifts
 *     disappear from listings, conflict validation, the forecast,
 *     copy-week and publishing.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantFixes3361.db.test.js
 * Without it, the DB describes skip (fail closed), same pattern as
 * staffSchedulePublishing.db.test.js.
 */
function staffDbOptIn() {
  const value = process.env.STATEMENT_TEST_DATABASE_URL || '';
  if (!value) {
    if (process.env.STATEMENT_REQUIRE_DB_TESTS === 'true') {
      throw new Error('STATEMENT_TEST_DATABASE_URL is required when STATEMENT_REQUIRE_DB_TESTS=<redacted>');
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

const crypto = require('crypto');

const pool = require('../db');
const payroll = require('../services/restaurantPayrollService');
const scheduleCtrl = require('../controllers/businessStaffScheduleController');
const { validateShift } = require('../services/shiftConflictValidation');
const { computeScheduleForecast } = require('../services/scheduleForecast');

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
const rid = crypto.randomBytes(2).toString('hex');
const uid = (tail) => `c0000000-0000-4000-8000-${rid}${tail}`;

async function insertUser(id, email, firstName) {
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active)
     VALUES ($1, $2, 'x', $3, 'Test', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [id, email, firstName]
  );
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

async function addMember(businessId, ownerId, userId, { jobRole = null, wage = null } = {}) {
  const { rows: [m] } = await pool.query(
    `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, job_role, hourly_wage_cents)
     VALUES ($1, $2, $3, 'employee', $4, 'active', $5, $6) RETURNING id`,
    [businessId, ownerId, userId, `member-${userId.slice(0, 8)}@example.invalid`, jobRole, wage]
  );
  return m.id;
}

function restaurantOf(restaurantId, businessId) {
  return { id: restaurantId, business_id: businessId, currency_code: 'USD', timezone: 'America/New_York' };
}

suite('design-review items 33/55/61 (DB)', () => {
  afterAll(async () => { await pool.end().catch(() => {}); });

  // ── Item 55: single-employee slice equals the whole-restaurant row ──
  describe('item 55: getMyPay/getMyTips single-employee slice', () => {
    const OWNER = uid('11111111');
    const EMP_A = uid('22222222');
    const EMP_B = uid('33333333');
    let businessId;
    let restaurantId;
    const FROM = '2026-10-05';
    const TO = '2026-10-11';

    beforeAll(async () => {
      await insertUser(OWNER, `fix55-owner-${stamp}@example.invalid`, 'Olga');
      await insertUser(EMP_A, `fix55-a-${stamp}@example.invalid`, 'Ana');
      await insertUser(EMP_B, `fix55-b-${stamp}@example.invalid`, 'Ben');
      businessId = await makeBusiness(OWNER, `Fix55 Biz ${stamp}`);
      restaurantId = await makeRestaurant(businessId, OWNER, `Fix55 ${stamp}`);
      await addMember(businessId, OWNER, EMP_A, { jobRole: 'Server', wage: 2000 });
      await addMember(businessId, OWNER, EMP_B, { jobRole: 'Cook', wage: 2500 });
      // Recorded hours: Ana 8h, Ben 6h on 2026-10-06.
      for (const [userId, hours] of [[EMP_A, 8], [EMP_B, 6]]) {
        await pool.query(
          `INSERT INTO business_time_entries (business_id, user_id, entry_date, hours_worked)
           VALUES ($1, $2, '2026-10-06', $3)`,
          [businessId, userId, hours]
        );
      }
      // Published shifts, so scheduled hours are in the slice too.
      for (const [userId, start, end] of [[EMP_A, '09:00', '17:00'], [EMP_B, '10:00', '15:00']]) {
        await pool.query(
          `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, restaurant_id, published_at)
           VALUES ($1, $2, '2026-10-06', $3, $4, 'Server', $5, NOW())`,
          [businessId, userId, start, end, restaurantId]
        );
      }
      // Order tips via the POS-shift fallback attribution (same path
      // the payroll tips suite uses): Ana 2000, Ben 1000, both
      // collected, so both land in net tips.
      for (const [userId, tip, total] of [[EMP_A, 2000, 48000], [EMP_B, 1000, 24000]]) {
        const { rows: [posShift] } = await pool.query(
          `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status)
           VALUES ($1, $2, 'closed') RETURNING id`,
          [restaurantId, userId]
        );
        const { rows: [order] } = await pool.query(
          `INSERT INTO food_orders
             (restaurant_id, business_id, guest_name, fulfillment_type, order_source,
              status, payment_status, subtotal_cents, discount_cents, tax_cents,
              tip_cents, total_cents, currency_code, queue_number, metadata, created_at)
           VALUES ($1, $2, 'Guest', 'pickup', 'counter', 'completed', 'paid',
                   $3, 0, 2000, $4, $5, 'USD', 1, $6::jsonb, '2026-10-06T16:00:00Z') RETURNING id`,
          [restaurantId, businessId, total - tip - 2000, tip, total, JSON.stringify({ shiftId: posShift.id })]
        );
        await pool.query(
          `INSERT INTO restaurant_pos_payments (restaurant_id, food_order_id, payment_type, amount_cents, status, created_at)
           VALUES ($1, $2, 'cash', $3, 'recorded', '2026-10-06T16:00:00Z')`,
          [restaurantId, order.id, total]
        );
      }
      // A confirmed declared cash tip for Ana only.
      await pool.query(
        `INSERT INTO restaurant_declared_cash_tips (restaurant_id, staff_user_id, business_date, amount_cents, status)
         VALUES ($1, $2, '2026-10-06', 500, 'confirmed')`,
        [restaurantId, EMP_A]
      );
    });

    test('getMyPay equals the whole-restaurant row for each employee', async () => {
      const restaurant = restaurantOf(restaurantId, businessId);
      const whole = await payroll.computeLabor({ restaurant, fromDate: FROM, toDate: TO });
      // The roster includes the owner (no hours, no tips); the two
      // employees with work in the period are Ana and Ben.
      expect(whole.employees.map((e) => e.user_id)).toEqual(expect.arrayContaining([EMP_A, EMP_B]));
      for (const userId of [EMP_A, EMP_B]) {
        const mine = await payroll.getMyPay({ restaurant, fromDate: FROM, toDate: TO, userId });
        const expected = whole.employees.find((e) => e.user_id === userId);
        expect(expected).toBeDefined();
        expect(mine.employee).toEqual(expected);
      }
    });

    test('getMyTips equals the whole-restaurant tip currencies for each employee', async () => {
      const restaurant = restaurantOf(restaurantId, businessId);
      const whole = await payroll.computeTipAllocations({ restaurant, fromDate: FROM, toDate: TO });
      for (const userId of [EMP_A, EMP_B]) {
        const mine = await payroll.getMyTips({ restaurant, fromDate: FROM, toDate: TO, userId });
        const expected = [];
        for (const bucket of whole.currencies) {
          const entry = (bucket.employees || []).find((e) => e.user_id === userId);
          if (!entry) continue;
          expected.push({
            currency: bucket.currency,
            pooling_enabled: bucket.pooling_enabled,
            gross_tips_cents: entry.gross_tips_cents,
            tip_out_cents: entry.tip_out_cents,
            tip_in_cents: entry.tip_in_cents,
            net_tips_cents: entry.net_tips_cents,
          });
        }
        expect(mine.currencies).toEqual(expected);
      }
      // Ana's confirmed cash tip is visible on her own tips view.
      const ana = await payroll.getMyTips({ restaurant, fromDate: FROM, toDate: TO, userId: EMP_A });
      expect(ana.cash_tips.map((t) => t.amount_cents)).toEqual([500]);
      const ben = await payroll.getMyTips({ restaurant, fromDate: FROM, toDate: TO, userId: EMP_B });
      expect(ben.cash_tips).toEqual([]);
    });

    test('pooled periods fall back to whole-restaurant math (exact shares)', async () => {
      // Coordinator fix: pooled tip-out/in shares are whole-restaurant
      // math, so a single-employee slice must NOT recompute the pool
      // over one employee. With pooling on, getMyTips/getMyPay must
      // still equal the whole-restaurant computation for each employee.
      await pool.query(
        `INSERT INTO restaurant_tip_pool_settings (restaurant_id, pooling_enabled, tip_out_rules, updated_by)
         VALUES ($1, TRUE, $2::jsonb, $3)
         ON CONFLICT (restaurant_id) DO UPDATE
           SET pooling_enabled = TRUE, tip_out_rules = EXCLUDED.tip_out_rules`,
        [restaurantId, JSON.stringify([{ target_type: 'role', target_key: 'Cook', percent_bps: 1000, weight_basis: 'equal' }]), OWNER]
      );
      try {
        const restaurant = restaurantOf(restaurantId, businessId);
        const wholeTips = await payroll.computeTipAllocations({ restaurant, fromDate: FROM, toDate: TO });
        expect(wholeTips.currencies[0].pooling_enabled).toBe(true);
        for (const userId of [EMP_A, EMP_B]) {
          const mine = await payroll.getMyTips({ restaurant, fromDate: FROM, toDate: TO, userId });
          const bucket = wholeTips.currencies[0];
          const entry = (bucket.employees || []).find((e) => e.user_id === userId);
          expect(entry).toBeDefined();
          expect(mine.currencies).toEqual([{
            currency: bucket.currency,
            pooling_enabled: true,
            gross_tips_cents: entry.gross_tips_cents,
            tip_out_cents: entry.tip_out_cents,
            tip_in_cents: entry.tip_in_cents,
            net_tips_cents: entry.net_tips_cents,
          }]);
        }
        const wholeLabor = await payroll.computeLabor({ restaurant, fromDate: FROM, toDate: TO });
        for (const userId of [EMP_A, EMP_B]) {
          const mine = await payroll.getMyPay({ restaurant, fromDate: FROM, toDate: TO, userId });
          const expected = wholeLabor.employees.find((e) => e.user_id === userId);
          expect(expected).toBeDefined();
          expect(mine.employee).toEqual(expected);
        }
      } finally {
        await pool.query('DELETE FROM restaurant_tip_pool_settings WHERE restaurant_id = $1', [restaurantId]);
      }
    });
  });

  // ── Item 33: punch-enforcement nudge in the exceptions report ──
  describe('item 33: punch_enforcement in the exceptions report', () => {
    const OWNER = uid('44444444');
    const EMP_A = uid('55555555');
    const EMP_B = uid('66666666');
    const EMP_C = uid('77777777');
    let businessId;
    let restaurantId;
    let locDowntown;
    let locUptown;

    beforeAll(async () => {
      await insertUser(OWNER, `fix33-owner-${stamp}@example.invalid`, 'Olga');
      await insertUser(EMP_A, `fix33-a-${stamp}@example.invalid`, 'Ana');
      await insertUser(EMP_B, `fix33-b-${stamp}@example.invalid`, 'Ben');
      await insertUser(EMP_C, `fix33-c-${stamp}@example.invalid`, 'Cat');
      businessId = await makeBusiness(OWNER, `Fix33 Biz ${stamp}`);
      restaurantId = await makeRestaurant(businessId, OWNER, `Fix33 ${stamp}`);
      const { rows: [l1] } = await pool.query(
        `INSERT INTO restaurant_locations (restaurant_id, name, latitude, longitude, timezone)
         VALUES ($1, 'Downtown', 40.7, -74.0, 'America/New_York') RETURNING id`,
        [restaurantId]
      );
      const { rows: [l2] } = await pool.query(
        `INSERT INTO restaurant_locations (restaurant_id, name, latitude, longitude, timezone)
         VALUES ($1, 'Uptown', NULL, NULL, 'America/New_York') RETURNING id`,
        [restaurantId]
      );
      locDowntown = Number(l1.id);
      locUptown = Number(l2.id);
      for (const userId of [EMP_A, EMP_B, EMP_C]) {
        const membershipId = await addMember(businessId, OWNER, userId, { jobRole: 'Server', wage: 2000 });
        for (const locId of [locDowntown, locUptown]) {
          await pool.query(
            `INSERT INTO restaurant_location_memberships (membership_id, restaurant_id, location_id, status)
             VALUES ($1, $2, $3, 'active')`,
            [membershipId, restaurantId, locId]
          );
        }
      }
      // Ana holds a restaurant-wide PIN (counts at both stores);
      // Cat holds a PIN scoped to Downtown only; Ben holds none.
      await pool.query(
        `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, pin_hash, is_active, location_id)
         VALUES ($1, $2, 'wide', TRUE, NULL)`,
        [restaurantId, EMP_A]
      );
      await pool.query(
        `INSERT INTO restaurant_staff_pins (restaurant_id, staff_user_id, pin_hash, is_active, location_id)
         VALUES ($1, $2, 'downtown', TRUE, $3)`,
        [restaurantId, EMP_C, locDowntown]
      );
    });

    test('reports geofence setup and PIN-less counts per location', async () => {
      const restaurant = restaurantOf(restaurantId, businessId);
      const report = await payroll.computeExceptions({ restaurant, fromDate: '2026-10-05', toDate: '2026-10-11' });
      // Creating the restaurant auto-creates its primary location
      // (restaurant_default_store_created trigger), named after the
      // restaurant, with no coordinates and no roster: it is a real
      // location in scope, so the nudge lists it too.
      const primary = report.punch_enforcement.locations.find(
        (l) => l.location_name === `Fix33 ${stamp}`
      );
      expect(primary).toEqual({
        location_id: expect.any(Number),
        location_name: `Fix33 ${stamp}`,
        geofence_configured: false,
        staff_total: 0,
        staff_without_pin: 0,
      });
      expect(report.punch_enforcement.locations.filter((l) => l.location_name !== `Fix33 ${stamp}`)).toEqual([
        { location_id: locDowntown, location_name: 'Downtown', geofence_configured: true, staff_total: 3, staff_without_pin: 1 },
        { location_id: locUptown, location_name: 'Uptown', geofence_configured: false, staff_total: 3, staff_without_pin: 2 },
      ]);
    });

    test('a single-store scope lists only that store', async () => {
      const restaurant = restaurantOf(restaurantId, businessId);
      const report = await payroll.computeExceptions({
        restaurant, fromDate: '2026-10-05', toDate: '2026-10-11', locationIds: [locUptown],
      });
      expect(report.punch_enforcement.locations).toEqual([
        { location_id: locUptown, location_name: 'Uptown', geofence_configured: false, staff_total: 3, staff_without_pin: 2 },
      ]);
    });
  });

  // ── Item 61: soft-delete shifts ──
  describe('item 61: deleteShift soft-deletes', () => {
    const OWNER = uid('88888888');
    const EMP_A = uid('99999999');
    const EMP_B = uid('aaaaaaaa');
    let businessId;
    let shiftA;
    let shiftB;
    let draftA;
    let draftB;
    const asOwner = () => ({ user: { id: OWNER }, businessRole: 'owner', params: { businessId: String(businessId) } });

    beforeAll(async () => {
      await insertUser(OWNER, `fix61-owner-${stamp}@example.invalid`, 'Olga');
      await insertUser(EMP_A, `fix61-a-${stamp}@example.invalid`, 'Ana');
      await insertUser(EMP_B, `fix61-b-${stamp}@example.invalid`, 'Ben');
      businessId = await makeBusiness(OWNER, `Fix61 Biz ${stamp}`);
      await addMember(businessId, OWNER, EMP_A, { jobRole: 'Server', wage: 2000 });
      await addMember(businessId, OWNER, EMP_B, { jobRole: 'Server', wage: 2000 });
      const insert = async (userId, date, published) => {
        const { rows: [row] } = await pool.query(
          `INSERT INTO business_staff_shifts (business_id, user_id, shift_date, start_time, end_time, role_label, published_at)
           VALUES ($1, $2, $3, '09:00', '17:00', 'Server', $4) RETURNING id`,
          [businessId, userId, date, published ? new Date().toISOString() : null]
        );
        return Number(row.id);
      };
      shiftA = await insert(EMP_A, '2026-11-08', true);
      shiftB = await insert(EMP_B, '2026-11-09', true);
      draftA = await insert(EMP_A, '2026-11-16', false);
      draftB = await insert(EMP_B, '2026-11-17', false);
    });

    test('a cancelled shift stops conflicting, and the row survives', async () => {
      const overlapping = await validateShift(pool, {
        businessId, userId: EMP_A, shiftDate: '2026-11-08', startTime: '10:00', endTime: '12:00',
      });
      expect(overlapping.violations.map((v) => v.code)).toContain('shift_overlap');

      const del = await call(scheduleCtrl.deleteShift, {
        ...asOwner(), params: { businessId: String(businessId), shiftId: String(shiftA) }, body: {},
      });
      expect(del.error).toBeNull();
      expect(del.res.statusCode).toBe(200);
      expect(del.res.body.success).toBe(true);
      expect(del.res.body.schedule_change).toBeDefined();

      const { rows: [row] } = await pool.query(
        'SELECT cancelled_at FROM business_staff_shifts WHERE id = $1', [shiftA]
      );
      expect(row.cancelled_at).not.toBeNull();
      const { rows: [change] } = await pool.query(
        `SELECT change_type, before_state, after_state FROM business_staff_schedule_changes
          WHERE business_id = $1 AND shift_id = $2 ORDER BY id DESC LIMIT 1`,
        [businessId, shiftA]
      );
      expect(change.change_type).toBe('deleted');
      expect(change.before_state.shift_date).toBe('2026-11-08');
      expect(change.after_state).toBeNull();

      const cleared = await validateShift(pool, {
        businessId, userId: EMP_A, shiftDate: '2026-11-08', startTime: '10:00', endTime: '12:00',
      });
      expect(cleared.violations).toEqual([]);
    });

    test('a second delete behaves like the not-found path', async () => {
      const again = await call(scheduleCtrl.deleteShift, {
        ...asOwner(), params: { businessId: String(businessId), shiftId: String(shiftA) }, body: {},
      });
      expect(again.error).toBeNull();
      expect(again.res.statusCode).toBe(200);
      expect(again.res.body).toEqual({ success: true });
    });

    test('cancelled shifts disappear from listings and cannot be edited', async () => {
      const listed = await call(scheduleCtrl.listShifts, {
        ...asOwner(), params: { businessId: String(businessId) }, query: {},
      });
      expect(listed.error).toBeNull();
      const ids = listed.res.body.map((s) => Number(s.id));
      expect(ids).toContain(shiftB);
      expect(ids).not.toContain(shiftA);

      const edited = await call(scheduleCtrl.updateShift, {
        ...asOwner(),
        params: { businessId: String(businessId), shiftId: String(shiftA) },
        body: { role: 'Host' },
      });
      expect(edited.error).toBeNull();
      expect(edited.res.statusCode).toBe(404);
    });

    test('forecast and copy-week skip cancelled shifts', async () => {
      const before = await computeScheduleForecast(pool, { businessId, from: '2026-11-16', to: '2026-11-16' });
      expect(before.draft_shift_count).toBe(1);
      expect(before.total_hours).toBe(8);
      await pool.query('UPDATE business_staff_shifts SET cancelled_at = NOW() WHERE id = $1', [draftA]);
      const after = await computeScheduleForecast(pool, { businessId, from: '2026-11-16', to: '2026-11-16' });
      expect(after.draft_shift_count).toBe(0);
      expect(after.total_hours).toBe(0);

      const copied = await call(scheduleCtrl.copyWeek, {
        ...asOwner(),
        params: { businessId: String(businessId) },
        body: { source_week_start: '2026-11-08', target_week_start: '2026-11-15' },
      });
      expect(copied.error).toBeNull();
      expect(copied.res.statusCode).toBe(200);
      expect(copied.res.body.created).toHaveLength(1);
      expect(copied.res.body.created[0].user_id).toBe(EMP_B);
      const copiedDate = copied.res.body.created[0].shift_date;
      const copiedIso = copiedDate instanceof Date ? copiedDate.toISOString().slice(0, 10) : String(copiedDate).slice(0, 10);
      expect(copiedIso).toBe('2026-11-16');
    });

    test('publishing skips a cancelled draft', async () => {
      await pool.query('UPDATE business_staff_shifts SET cancelled_at = NOW() WHERE id = $1', [draftB]);
      const pub = await call(scheduleCtrl.publishShifts, {
        ...asOwner(),
        params: { businessId: String(businessId) },
        body: { from: '2026-11-17', to: '2026-11-17' },
      });
      expect(pub.error).toBeNull();
      expect(pub.res.statusCode).toBe(200);
      expect(pub.res.body.published).toBe(0);
      expect(pub.res.body.shift_ids).toEqual([]);
    });
  });
});
