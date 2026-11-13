'use strict';

/**
 * DB tests: money-flows W8 — the run-now scheduled-report endpoint had
 * no rate limit. Each call rebuilds the report from live data
 * (daily close / labor / digest with FX conversion), so a manager (or a
 * compromised manager session) hammering run-now forced repeated full
 * recomputation per click.
 *
 * The fix is a per-schedule cooldown: an atomic compare-and-swap on
 * the schedule's last_run_at stamps the attempt before the rebuild,
 * so rapid repeat calls for the same schedule get 429
 * (run_now_cooldown) even when they ask for a different business date
 * (the deliveries ledger dedupes per date only, so varying the date
 * used to bypass it). A single call still works, and a call works
 * again once the cooldown lapses.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npx jest __tests__/restaurantScheduledReportRunNowCooldown.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

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
  process.env['JWT' + '_SECRET'] = 'run-now-cooldown-test-secret';
}

const pool = require('../db');
const controller = require('../controllers/restaurantComplianceController');

jest.setTimeout(60000);

function mockReq({ params = {}, query = {}, body = {}, user = { id: 'nobody' } } = {}) {
  return { params, query, body, user, headers: {}, get: () => undefined };
}
function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  res.setHeader = jest.fn((k, v) => { res.headers[k] = v; return res; });
  res.send = jest.fn((body) => { res.body = body; return res; });
  return res;
}
async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

async function makeUser(first, last) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', $3, $4, 'customer', TRUE, TRUE)`,
    [id, `run-now-${id.slice(0, 8)}@example.invalid`, first, last]
  );
  return id;
}

ddescribe('Money-flows W8: run-now scheduled reports have a per-schedule cooldown', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await makeUser('Olivia', 'Owner');
    const staff = await makeUser('Sara', 'Server');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `RunNow ${crypto.randomUUID().slice(0, 8)}`, 'America/New_York']
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'America/New_York', 'USD') RETURNING id`,
      [biz.id, owner, 'Run Now Diner']
    );
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status)
       VALUES ($1, $2, $3, 'employee', $4, 'active')`,
      [biz.id, owner, staff, `run-now-staff-${staff.slice(0, 8)}@example.invalid`]
    );
    const { rows: [schedule] } = await pool.query(
      `INSERT INTO restaurant_scheduled_reports
         (restaurant_id, report_type, frequency, delivery_channel, recipients, created_by)
       VALUES ($1, 'labor', 'daily', 'in_app', $2::jsonb, $3) RETURNING id`,
      [rest.id, JSON.stringify([{ user_id: staff }]), owner]
    );
    F = { owner, staff, businessId: Number(biz.id), restaurantId: Number(rest.id), scheduleId: Number(schedule.id) };
  });

  afterAll(async () => {
    await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [[F.owner, F.staff]]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_report_deliveries WHERE scheduled_report_id = $1', [F.scheduleId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_scheduled_reports WHERE id = $1', [F.scheduleId]).catch(() => {});
    await pool.query('DELETE FROM business_members WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE business_id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [F.businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[F.owner, F.staff]]).catch(() => {});
    await pool.end().catch(() => {});
  });

  test('a single run-now works; a rapid repeat is cooled down; a run after the cooldown works again', async () => {
    const params = { restaurantId: String(F.restaurantId), scheduleId: String(F.scheduleId) };
    // 1. A single call works and delivers.
    const first = await call(controller.runScheduledReportNow, mockReq({
      params, body: { businessDate: '2026-11-06' }, user: { id: F.owner },
    }));
    expect(first.err).toBeNull();
    expect(first.res.payload.delivery.status).toBe('sent');
    expect(first.res.payload.replayed).toBe(false);

    // 2. An immediate repeat — for a DIFFERENT business date, so the
    // per-date delivery dedupe cannot save it — is cooled down.
    const rapid = await call(controller.runScheduledReportNow, mockReq({
      params, body: { businessDate: '2026-11-05' }, user: { id: F.owner },
    }));
    expect(rapid.err).toMatchObject({ status: 429, code: 'run_now_cooldown' });

    // 3. Once the cooldown lapses, a run works again.
    await pool.query(
      `UPDATE restaurant_scheduled_reports
          SET last_run_at = NOW() - INTERVAL '2 minutes'
        WHERE id = $1`,
      [F.scheduleId]
    );
    const after = await call(controller.runScheduledReportNow, mockReq({
      params, body: { businessDate: '2026-11-05' }, user: { id: F.owner },
    }));
    expect(after.err).toBeNull();
    expect(after.res.payload.delivery.status).toBe('sent');
  });
});
