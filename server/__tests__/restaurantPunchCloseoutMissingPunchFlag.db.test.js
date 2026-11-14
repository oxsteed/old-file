'use strict';

/**
 * DB tests: Domain 8 #11 — missing-punch flags starve past 500 per day.
 *
 * Proves, against a real migrated database:
 *   - with 501 missing shifts for yesterday and notify:true, the
 *     first run flags exactly 500 (the oldest, deterministic order)
 *     and stamps each flagged shift with missing_punch_notified_at;
 *   - the second run flags the remaining 1 shift instead of
 *     re-reporting the same oldest 500 (the pre-fix behaviour: the
 *     notification dedupe lived only on the delivery_key, so the
 *     tail was never flagged and the same 500 recurred every run);
 *   - a third run flags nothing: every shift was flagged exactly once.
 *
 * Notifications are mocked out; the sweep runs with notify:true so
 * the flagging path (notify then stamp) is exercised.
 *
 * Run with:
 *   NODE_ENV=test STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/restaurantPunchCloseoutMissingPunchFlag.db.test.js --forceExit
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPunchCloseoutBatchLimit.db.test.js.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(async () => ({ success: true })),
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
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'missing-punch-flag-test-secret';
}

const pool = require('../db');
const { closeStalePunches, CLOSEOUT_BATCH_LIMIT } = require('../services/restaurantPunchCloseout');
const { sendNotification } = require('../services/notificationService');

jest.setTimeout(120000);

const RUN = crypto.randomUUID().slice(0, 8);
const USER_COUNT = 501;

ddescribe('Domain 8 #11: missing-punch flags make forward progress past the 500 cap', () => {
  let owner;
  let businessId;
  let userIds;
  let yesterday;

  beforeAll(async () => {
    owner = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'MissingPunchFlag', $3, 'customer', TRUE, TRUE)`,
      [owner, `mpf-owner-${RUN}@example.invalid`, `owner-${RUN}`]
    );
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `Missing Punch Flag ${RUN}`, 'UTC']
    );
    businessId = Number(b.id);

    const { rows } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       SELECT gen_random_uuid(), 'mpf-user-${RUN}-' || g || '@example.invalid',
              'x', 'MissingPunchFlag', 'User', 'customer', TRUE, TRUE
         FROM generate_series(1, $1) g
       RETURNING id`,
      [USER_COUNT]
    );
    expect(rows).toHaveLength(USER_COUNT);
    userIds = rows.map((r) => r.id);

    // 501 published shifts for yesterday, one per user, with no time
    // entry for that date at all: every one is a missing punch.
    const y = new Date();
    y.setUTCHours(12, 0, 0, 0);
    y.setUTCDate(y.getUTCDate() - 1);
    yesterday = y.toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO business_staff_shifts
         (business_id, user_id, shift_date, start_time, end_time, published_at)
       SELECT $1::int, u.id, $2::date, '08:00'::time, '16:00'::time, NOW()
         FROM users u WHERE u.id = ANY($3::uuid[])`,
      [businessId, yesterday, userIds]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM business_staff_shifts WHERE business_id = $1', [businessId]);
    // The seeded business and users are left behind, same as the
    // Phase 2 tests: deleting a business fails in this database
    // because food_customer_wallet_operator_audit_events carries
    // ON DELETE/UPDATE DO INSTEAD NOTHING rules. The disposable
    // test database tolerates the leftovers; every run uses a unique
    // suffix, so they never collide.
    await pool.end();
  });

  async function flaggedCount() {
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM business_staff_shifts
        WHERE business_id = $1 AND missing_punch_notified_at IS NOT NULL`,
      [businessId]
    );
    return row.n;
  }

  test('repeated runs flag the tail instead of re-reporting the same oldest 500', async () => {
    expect(CLOSEOUT_BATCH_LIMIT).toBe(500);

    const first = await closeStalePunches({ businessId, db: pool, notify: true, now: new Date() });
    expect(first.errors).toEqual([]);
    expect(first.closed).toHaveLength(0);
    expect(first.missing).toHaveLength(CLOSEOUT_BATCH_LIMIT);
    expect(first.missing.every((m) => m.shiftDate === yesterday)).toBe(true);
    // One manager (the owner) per shift: 500 notifications sent.
    expect(sendNotification).toHaveBeenCalledTimes(CLOSEOUT_BATCH_LIMIT);
    // Every flagged shift is stamped on its row.
    expect(await flaggedCount()).toBe(CLOSEOUT_BATCH_LIMIT);

    // Forward progress: the second run does NOT re-report the 500
    // already flagged — it flags the one remaining shift.
    const second = await closeStalePunches({ businessId, db: pool, notify: true, now: new Date() });
    expect(second.errors).toEqual([]);
    expect(second.missing).toHaveLength(1);
    expect(first.missing.map((m) => m.shiftId)).not.toContain(second.missing[0].shiftId);
    expect(sendNotification).toHaveBeenCalledTimes(CLOSEOUT_BATCH_LIMIT + 1);
    expect(await flaggedCount()).toBe(USER_COUNT);

    // Nothing left to flag: a third run is a no-op for missing punches.
    const third = await closeStalePunches({ businessId, db: pool, notify: true, now: new Date() });
    expect(third.errors).toEqual([]);
    expect(third.missing).toHaveLength(0);
    expect(sendNotification).toHaveBeenCalledTimes(CLOSEOUT_BATCH_LIMIT + 1);
  });
});
