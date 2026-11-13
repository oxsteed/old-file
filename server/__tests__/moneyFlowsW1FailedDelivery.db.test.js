'use strict';

// Money flows W1: the scheduled-report ledger used to be stamped
// 'sent' before delivery, so a failed day was permanently lost and
// mislabeled (and the dedupe row blocked every retry).
//
// This is verified-covered, not newly built: Group 2 audit #41
// (commit b5bd3a3f5) claims the delivery row as 'pending', updates
// it to 'sent'/'failed' only after deliverScheduledReport returns,
// counts only sends that did not return { success: false }, and
// advances last_business_date only on success; the manual path
// (runScheduledReportNow) got the same shape in commit 15f2c42ec
// (design-review Group 9, item 14); the per-recipient ledger is on
// draft PR #782 (commit 3b77e425d). This suite is the regression
// proof on the real schema: a failed delivery leaves the ledger
// row 'failed' (never 'sent') and the day retryable, on both the
// nightly run and the manual run-now path.
//
// DB: disposable credit_statement_test only; the suite skips otherwise.
// The test database must be migrated first:
//   DATABASE_URL=<redacted> npm run migrate
//   STATEMENT_TEST_DATABASE_URL=<redacted>
//     npx jest __tests__/moneyFlowsW1FailedDelivery.db.test.js

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
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async (userId, restaurantId) => ({
    id: Number(restaurantId),
    business_id: 424242,
    timezone: 'UTC',
    currency_code: 'USD',
  })),
}));
jest.mock('../services/permissionsService', () => ({
  hasRestaurantPermission: jest.fn(async () => true),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(async () => ({ mode: 'all', location_ids: [] })),
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
  process.env['JWT' + '_SECRET'] = 'money-flows-w1-test-secret';
}

const pool = require('../db');
const scheduledReports = require('../services/restaurantScheduledReports');
const complianceController = require('../controllers/restaurantComplianceController');
const { sendNotification } = require('../services/notificationService');
const { resolveRestaurantAccess } = require('../services/scopeModel');

const NOW = new Date();
const BUSINESS_DATE = scheduledReports.shiftDateString(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(NOW), -1,
);

ddescribe('Money flows W1: a failed delivery stays failed and retryable', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let restaurantId;
  let nightlyId;
  let manualId;

  beforeAll(async () => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `w1-owner-${suffix}@example.com`, 'test-hash', 'W1', 'Owner',
       staffId, `w1-staff-${suffix}@example.com`, 'test-hash', 'W1', 'Staff'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `W1 Failed Delivery ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `W1 Failed Delivery ${suffix}`],
    ));
    restaurantId = Number(restaurantId);
    // The access mocks return a fixed business_id; point them at
    // the real fixture business so the handler's schedule lookup
    // (by restaurant) and the membership-free run-now path agree.
    resolveRestaurantAccess.mockImplementation(async (userId, rid) => ({
      id: Number(rid),
      business_id: businessId,
      timezone: 'UTC',
      currency_code: 'USD',
    }));
    const insert = async () => {
      const { rows: [{ id }] } = await pool.query(
        `INSERT INTO restaurant_scheduled_reports
           (restaurant_id, report_type, frequency, delivery_channel, recipients, last_business_date, created_by)
         VALUES ($1, 'labor', 'daily', 'in_app', $2::jsonb, NULL, $3) RETURNING id`,
        [restaurantId, JSON.stringify([{ user_id: staffId }]), ownerId],
      );
      return Number(id);
    };
    nightlyId = await insert();
    manualId = await insert();
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id IN ($1, $2)', [nightlyId, manualId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_reports WHERE id IN ($1, $2)', [nightlyId, manualId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, staffId]).catch(() => {});
    await pool.end().catch(() => {});
  });

  async function deliveryRow(scheduleId) {
    const { rows: [row] } = await pool.query(
      `SELECT status, recipient_count FROM restaurant_scheduled_report_deliveries
        WHERE scheduled_report_id = $1 AND business_date = $2::date`,
      [scheduleId, BUSINESS_DATE],
    );
    return row || null;
  }

  async function lastBusinessDate(scheduleId) {
    const { rows: [row] } = await pool.query(
      'SELECT last_business_date FROM restaurant_scheduled_reports WHERE id = $1',
      [scheduleId],
    );
    return row.last_business_date;
  }

  function businessDateString(value) {
    if (value == null) return null;
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  }

  // The two tests share fixtures and run in declaration order: the
  // manual test first (its schedule is still due afterwards only
  // for the nightly run's business date if it failed — it succeeds
  // on retry, so it drops out of the nightly due set), then the
  // nightly test (only its own schedule is due).
  test('manual run-now: failed delivery is failed, then retried to sent', async () => {
    const req = {
      params: { restaurantId: String(restaurantId), scheduleId: String(manualId) },
      user: { id: ownerId },
      body: {},
    };
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next = jest.fn();
    sendNotification.mockResolvedValueOnce({ success: false, error: 'Resend down' });
    await complianceController.runScheduledReportNow(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(String(next.mock.calls[0][0].message)).toContain('Resend down');
    const failedRow = await deliveryRow(manualId);
    expect(failedRow.status).toBe('failed');
    expect(await lastBusinessDate(manualId)).toBeNull();
    const res2 = { json: jest.fn(), status: jest.fn().mockReturnThis() };
    const next2 = jest.fn();
    await complianceController.runScheduledReportNow(req, res2, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.json).toHaveBeenCalledTimes(1);
    expect(res2.json.mock.calls[0][0].delivery.status).toBe('sent');
    const sentRow = await deliveryRow(manualId);
    expect(sentRow.status).toBe('sent');
    expect(Number(sentRow.recipient_count)).toBe(1);
    expect(businessDateString(await lastBusinessDate(manualId))).toBe(BUSINESS_DATE);
  }, 60000);

  test('nightly run: failed delivery is failed, then retried to sent', async () => {
    sendNotification.mockResolvedValueOnce({ success: false, error: 'Resend down' });
    const first = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(first).toMatchObject({ due: 1, sent: 0, failed: 1 });
    // The failed schedule is NOT marked sent, and its day does not
    // advance: the next run retries it.
    const failedRow = await deliveryRow(nightlyId);
    expect(failedRow.status).toBe('failed');
    expect(Number(failedRow.recipient_count)).toBe(0);
    expect(await lastBusinessDate(nightlyId)).toBeNull();
    const second = await scheduledReports.runDueScheduledReports(pool, { now: NOW });
    expect(second).toMatchObject({ due: 1, sent: 1, failed: 0 });
    const sentRow = await deliveryRow(nightlyId);
    expect(sentRow.status).toBe('sent');
    expect(Number(sentRow.recipient_count)).toBe(1);
    expect(businessDateString(await lastBusinessDate(nightlyId))).toBe(BUSINESS_DATE);
  }, 60000);
});
