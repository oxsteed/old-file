'use strict';

// Money flows W4 (scheduled-reports half): runDueScheduledReports
// re-asserts the lease before each schedule's build, but the build
// itself can be long (daily close / labor / digests), and nothing
// re-checks the lease between the build and the send. A lease lost
// mid-build therefore still sends the report through the raw pool,
// and only the delivery-ledger update afterwards throws.
//
// Repro-first: a fence whose assertActive passes before the build
// and throws before the send. Before the fix the report is sent
// (sendNotification called, delivery marked sent); after the fix
// the run rejects with LeaseLostError, nothing is sent, the claimed
// row stays pending, and last_business_date does not advance.
//
// DB: disposable credit_statement_test only; the suite skips otherwise.
// The test database must be migrated first:
//   DATABASE_URL=<redacted> npm run migrate
//   STATEMENT_TEST_DATABASE_URL=<redacted>
//     npx jest __tests__/moneyFlowsW4ScheduledReportsFence.db.test.js

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
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'money-flows-w4-test-secret';
}

const pool = require('../db');
const scheduledReports = require('../services/restaurantScheduledReports');
const { LeaseLostError } = require('../jobs/jobLockingService');
const { sendNotification } = require('../services/notificationService');

const NOW = new Date('2026-11-06T10:00:00Z');
const BUSINESS_DATE = '2026-11-05';

ddescribe('Money flows W4: scheduled reports stop sending after lease loss', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let restaurantId;
  let scheduleId;

  beforeAll(async () => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `w4-owner-${suffix}@example.com`, 'test-hash', 'W4', 'Owner',
       staffId, `w4-staff-${suffix}@example.com`, 'test-hash', 'W4', 'Staff'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `W4 Scheduled Reports ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `W4 Scheduled Reports ${suffix}`],
    ));
    restaurantId = Number(restaurantId);
    ({ rows: [{ id: scheduleId }] } = await pool.query(
      `INSERT INTO restaurant_scheduled_reports
         (restaurant_id, report_type, frequency, delivery_channel, recipients, last_business_date, created_by)
       VALUES ($1, 'labor', 'daily', 'in_app', $2::jsonb, NULL, $3) RETURNING id`,
      [restaurantId, JSON.stringify([{ user_id: staffId }]), ownerId],
    ));
    scheduleId = Number(scheduleId);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id = $1', [scheduleId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_reports WHERE id = $1', [scheduleId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, staffId]).catch(() => {});
    await pool.end().catch(() => {});
  });

  test('a lease lost between build and send aborts before any send', async () => {
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
    // The build ran, but the send never did: a lost lease must not
    // deliver through the raw pool.
    expect(sendNotification.mock.calls.length - sentBefore).toBe(0);
    const { rows: [delivery] } = await pool.query(
      `SELECT status, recipient_count FROM restaurant_scheduled_report_deliveries
        WHERE scheduled_report_id = $1 AND business_date = $2::date`,
      [scheduleId, BUSINESS_DATE],
    );
    expect(delivery.status).toBe('pending');
    expect(Number(delivery.recipient_count)).toBe(0);
    const { rows: [schedule] } = await pool.query(
      'SELECT last_business_date FROM restaurant_scheduled_reports WHERE id = $1',
      [scheduleId],
    );
    expect(schedule.last_business_date).toBeNull();
  }, 60000);
});
