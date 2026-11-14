'use strict';

/**
 * Domain 8 #22: scheduled-reports head-of-line blocking by persistently
 * failing schedules.
 *
 * runDueScheduledReports caps a run at MAX_SCHEDULES_PER_RUN (100) due
 * schedules, and the header comment documented that a schedule whose
 * build keeps failing stays due and occupies a slot, so 100 failing
 * schedules block all others. Bounded, but starvation by design.
 *
 * Fix: schedules track consecutive failures; at the threshold (5)
 * they are skipped by the due select until a success resets the
 * counter (success is only reachable again via a manual send, which
 * resets the counter, or an operator clearing the failure).
 *
 * Against the real migrated schema (builders mocked so the runs stay
 * fast; the select, claim, delivery ledger and counter updates all
 * run for real):
 *   - a schedule that fails 5 runs in a row stops being due on the
 *     6th run and its counter stops growing;
 *   - a schedule that fails once then succeeds resets its counter to
 *     0 and advances;
 *   - a healthy schedule is unaffected by the failing ones.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * The test database must be migrated first.
 */
jest.unmock('pg');
jest.unmock('../db');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({})),
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn(async () => ({})),
}));
jest.mock('../services/restaurantPayrollService', () => ({
  computeLabor: jest.fn(async ({ restaurant }) => {
    const cfg = globalThis.__failureSkip || {};
    if (Number(restaurant.id) === cfg.failingId) throw new Error('build boom');
    if (Number(restaurant.id) === cfg.flakyId) {
      cfg.flakyCalls = (cfg.flakyCalls || 0) + 1;
      if (cfg.flakyCalls === 1) throw new Error('flaky first build boom');
    }
    return {
      from_date: '2026-11-05',
      to_date: '2026-11-05',
      timezone: 'UTC',
      currency: 'USD',
      currency_minor_unit_decimals: 2,
      total_hours: 8,
      labor_cost_cents: 10000,
      labor_percent: 20,
    };
  }),
  computeExceptions: jest.fn(async () => ({
    from_date: '2026-11-05',
    to_date: '2026-11-05',
    timezone: 'UTC',
    employees: [],
  })),
}));
jest.mock('../controllers/restaurantReportsController', () => ({
  _computeDailyClose: jest.fn(async () => ({
    business_date: '2026-11-05',
    timezone: 'UTC',
    locations: [],
    brand_totals: [{ currency: 'USD', totals: { revenue_cents: 12345 } }],
  })),
}));

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
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'scheduled-reports-failure-skip-test-secret';
}

const pool = require('../db');
const scheduledReports = require('../services/restaurantScheduledReports');
const { CONSECUTIVE_FAILURES_SKIP_THRESHOLD } = scheduledReports;

jest.setTimeout(60000);

const NOW = new Date('2026-11-06T10:00:00Z');
const BUSINESS_DATE = '2026-11-05';

ddescribe('Domain 8 #22: persistently failing schedules stop blocking the run', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let failingId;
  let flakyId;
  let goodId;

  beforeAll(async () => {
    const { rows: [column] } = await pool.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_name = 'restaurant_scheduled_reports' AND column_name = 'consecutive_failures'`,
    );
    if (!column) {
      throw new Error('Scheduled-report table is missing consecutive_failures: migrate credit_statement_test before running this test');
    }
    expect(CONSECUTIVE_FAILURES_SKIP_THRESHOLD).toBe(5);
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `skip-owner-${suffix}@example.com`, 'test-hash', 'Skip', 'Owner',
       staffId, `skip-staff-${suffix}@example.com`, 'test-hash', 'Skip', 'Staff'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Scheduled Reports Failure Skip ${suffix}`],
    ));
    businessId = Number(businessId);
    async function makeRestaurant(tag) {
      const { rows: [{ id }] } = await pool.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
         VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
        [businessId, ownerId, `Failure Skip ${tag} ${suffix}`],
      );
      return Number(id);
    }
    failingId = await makeRestaurant('Failing');
    flakyId = await makeRestaurant('Flaky');
    goodId = await makeRestaurant('Good');
    globalThis.__failureSkip = { failingId, flakyId, flakyCalls: 0 };
    for (const restaurantId of [failingId, flakyId, goodId]) {
      await pool.query(
        `INSERT INTO restaurant_scheduled_reports
           (restaurant_id, report_type, frequency, delivery_channel, recipients, created_by)
         VALUES ($1, 'labor', 'daily', 'in_app', $2::jsonb, $3)`,
        [restaurantId, JSON.stringify([{ user_id: staffId }]), ownerId],
      );
    }
  });

  afterAll(async () => {
    delete globalThis.__failureSkip;
    await pool.query('DELETE FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id IN (SELECT id FROM restaurant_scheduled_reports WHERE restaurant_id = ANY($1::bigint[]))', [[failingId, flakyId, goodId]]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_reports WHERE restaurant_id = ANY($1::bigint[])', [[failingId, flakyId, goodId]]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE id = ANY($1::bigint[])', [[failingId, flakyId, goodId]]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, staffId]]).catch(() => {});
    await pool.end().catch(() => {});
  });

  async function scheduleState(restaurantId) {
    const { rows: [row] } = await pool.query(
      `SELECT consecutive_failures, last_business_date FROM restaurant_scheduled_reports
        WHERE restaurant_id = $1`,
      [restaurantId],
    );
    return row;
  }

  test('five consecutive failures skip the schedule; a flaky schedule recovers and resets', async () => {
    // Run 1: failing + flaky fail, good sends.
    const first = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(first).toMatchObject({ due: 3, sent: 1, failed: 2 });
    expect(Number((await scheduleState(failingId)).consecutive_failures)).toBe(1);
    expect(Number((await scheduleState(flakyId)).consecutive_failures)).toBe(1);

    // Run 2: flaky succeeds and resets; failing fails again.
    const second = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(second).toMatchObject({ due: 2, sent: 1, failed: 1 });
    const flakyAfter = await scheduleState(flakyId);
    expect(Number(flakyAfter.consecutive_failures)).toBe(0);
    expect(flakyAfter.last_business_date.toISOString().slice(0, 10)).toBe(BUSINESS_DATE);
    expect(Number((await scheduleState(failingId)).consecutive_failures)).toBe(2);

    // Runs 3-5: the failing schedule fails three more times, reaching 5.
    for (let run = 3; run <= 5; run += 1) {
      const result = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
      expect(result).toMatchObject({ due: 1, sent: 0, failed: 1 });
      expect(Number((await scheduleState(failingId)).consecutive_failures)).toBe(run);
    }

    // Run 6: the failing schedule is skipped by the threshold, so the
    // run is empty and the counter stops growing.
    const sixth = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(sixth).toMatchObject({ due: 0, sent: 0, failed: 0 });
    expect(Number((await scheduleState(failingId)).consecutive_failures)).toBe(5);
  });
});
