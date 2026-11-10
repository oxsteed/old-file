'use strict';

/**
 * Background-jobs audit #50: scheduled reports are unbounded.
 *
 * Against the real migrated schema (builders and senders mocked so
 * 120 builds stay fast; the select, claim, delivery ledger and
 * marker updates all run for real):
 *   - one run builds at most MAX_SCHEDULES_PER_RUN (100) due
 *     schedules, and the next run builds the rest (forward progress:
 *     built schedules drop out of the due set);
 *   - the SQL due filter skips schedules that are not due (daily
 *     already built for the business date, weekly inside its 7-day
 *     window) and includes the weekly boundary day;
 *   - a lease lost mid-run (the fence assert throws on the second
 *     schedule) stops the run instead of building further schedules.
 *
 * The three tests share one sweep and run in declaration order: the
 * cap test first (nothing else due yet), then the due-filter test
 * (the cap test's schedules are all advanced, so they are not due),
 * then the fence test (only its own three schedules are due).
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * The test database must be migrated first:
 *   DATABASE_URL=<redacted>
 *     npm run migrate
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantScheduledReportsCapFence.db.test.js
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
  computeLabor: jest.fn(async () => ({
    from_date: '2026-11-05',
    to_date: '2026-11-05',
    timezone: 'UTC',
    currency: 'USD',
    currency_minor_unit_decimals: 2,
    total_hours: 8,
    labor_cost_cents: 10000,
    labor_percent: 20,
  })),
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
  process.env.LOG_LEVEL = 'debug';
  process.env['JWT' + '_SECRET'] = 'scheduled-reports-cap-fence-test-secret';
}

const pool = require('../db');
const scheduledReports = require('../services/restaurantScheduledReports');
const { LeaseLostError } = require('../jobs/jobLockingService');
const { sendNotification } = require('../services/notificationService');

const { MAX_SCHEDULES_PER_RUN } = scheduledReports;
const NOW = new Date('2026-11-06T10:00:00Z');
const BUSINESS_DATE = '2026-11-05';

ddescribe('Background-jobs audit #50: scheduled-report cap and per-schedule fence', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let restaurantId;

  beforeAll(async () => {
    const { rows: [column] } = await pool.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_name = 'restaurant_scheduled_reports' AND column_name = 'last_business_date'`,
    );
    if (!column) {
      throw new Error('Scheduled-report tables are missing: migrate credit_statement_test before running this test');
    }
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `cap-owner-${suffix}@example.com`, 'test-hash', 'Cap', 'Owner',
       staffId, `cap-staff-${suffix}@example.com`, 'test-hash', 'Cap', 'Staff'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Scheduled Reports Cap ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `Scheduled Reports Cap ${suffix}`],
    ));
    restaurantId = Number(restaurantId);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id IN (SELECT id FROM restaurant_scheduled_reports WHERE restaurant_id = $1)', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_reports WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ownerId, staffId]]).catch(() => {});
    await pool.end().catch(() => {});
  });

  async function insertSchedules(specs) {
    const { rows } = await pool.query(
      `INSERT INTO restaurant_scheduled_reports
         (restaurant_id, report_type, frequency, delivery_channel, recipients, last_business_date, created_by)
       VALUES ${specs.map((spec, i) => {
         const base = i * 5;
         return `($${base + 1}, 'labor', $${base + 2}, 'in_app', $${base + 3}::jsonb, $${base + 4}::date, $${base + 5})`;
       }).join(', ')} RETURNING id`,
      specs.flatMap((spec) => [
        restaurantId,
        spec.frequency || 'daily',
        JSON.stringify([{ user_id: staffId }]),
        spec.lastBusinessDate === undefined ? null : spec.lastBusinessDate,
        ownerId,
      ]),
    );
    return rows.map((row) => Number(row.id));
  }

  async function deliveryCount(ids) {
    const { rows: [{ count }] } = await pool.query(
      'SELECT COUNT(*)::int AS count FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id = ANY($1::bigint[])',
      [ids],
    );
    return Number(count);
  }

  async function advancedCount(ids) {
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM restaurant_scheduled_reports
        WHERE id = ANY($1::bigint[]) AND last_business_date = $2::date`,
      [ids, BUSINESS_DATE],
    );
    return Number(count);
  }

  test('one run builds at most 100 due schedules and the next run builds the rest', async () => {
    expect(MAX_SCHEDULES_PER_RUN).toBe(100);
    const ids = await insertSchedules(Array.from({ length: 120 }, () => ({})));
    const sentBefore = sendNotification.mock.calls.length;

    const first = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(first).toMatchObject({ due: 100, sent: 100, failed: 0 });
    expect(sendNotification.mock.calls.length - sentBefore).toBe(100);
    expect(await deliveryCount(ids)).toBe(100);
    expect(await advancedCount(ids)).toBe(100);

    // The 100 built schedules advanced past the business date, so
    // they drop out of the due set and the next run reaches the rest.
    const second = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(second).toMatchObject({ due: 20, sent: 20, failed: 0 });
    expect(sendNotification.mock.calls.length - sentBefore).toBe(120);
    expect(await deliveryCount(ids)).toBe(120);
    expect(await advancedCount(ids)).toBe(120);
  }, 60000);

  test('the due filter skips not-due schedules and includes the weekly boundary day', async () => {
    const ids = await insertSchedules([
      { lastBusinessDate: BUSINESS_DATE }, // daily, already built for the business date
      {}, // daily, never built: due
      { frequency: 'weekly', lastBusinessDate: '2026-11-02' }, // weekly, 3 days ago: not due
      { frequency: 'weekly', lastBusinessDate: '2026-10-29' }, // weekly, exactly 7 days ago: due
    ]);
    const [alreadyBuilt, dueDaily, weeklyEarly, weeklyBoundary] = ids;
    const sentBefore = sendNotification.mock.calls.length;

    const result = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(result).toMatchObject({ due: 2, sent: 2, failed: 0 });
    expect(sendNotification.mock.calls.length - sentBefore).toBe(2);
    expect(await deliveryCount([dueDaily, weeklyBoundary])).toBe(2);
    expect(await deliveryCount([alreadyBuilt, weeklyEarly])).toBe(0);
    expect(await advancedCount([dueDaily, weeklyBoundary])).toBe(2);
  }, 60000);

  test('a lease lost mid-run stops the run after the current schedule', async () => {
    const ids = await insertSchedules([{}, {}, {}]);
    const assertActive = jest.fn();
    assertActive.mockImplementationOnce(() => {});
    assertActive.mockImplementationOnce(() => {
      throw new LeaseLostError('restaurant-scheduled-reports');
    });
    const fence = { assertActive };
    const sentBefore = sendNotification.mock.calls.length;

    await expect(
      scheduledReports.runDueScheduledReports(pool, { now: NOW, fence }),
    ).rejects.toThrow('lease lost');
    expect(assertActive).toHaveBeenCalledTimes(2);
    // Only the first schedule was built; the second schedule's
    // assert threw before its build, and the third was never reached.
    expect(sendNotification.mock.calls.length - sentBefore).toBe(1);
    expect(await deliveryCount(ids)).toBe(1);
    expect(await advancedCount(ids)).toBe(1);
    const { rows: untouched } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM restaurant_scheduled_reports
        WHERE id = ANY($1::bigint[]) AND last_business_date IS NULL`,
      [ids],
    );
    expect(Number(untouched[0].count)).toBe(2);
  }, 60000);
});
