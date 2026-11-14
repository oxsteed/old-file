'use strict';

/**
 * DB tests: Domain 9 (2026-11-13) item 7 — punch closeout.
 *
 * Proves, against a real migrated database:
 *   (a) missing-punch forward progress: a shift that already has a
 *       missing-punch notification (delivery_key
 *       `missing-punch:<shift>:<date>:<manager>`) is skipped by the
 *       next run, so a day with more than CLOSEOUT_BATCH_LIMIT
 *       missing shifts flags the next batch instead of the same
 *       oldest 500 forever;
 *   (b) the manager lookup is cached per business for the run: with
 *       three stale entries in one business and notify:true, the
 *       business_members lookup runs once, not once per entry.
 *
 * Run with:
 *   NODE_ENV=test STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/restaurantPunchCloseoutNotifiedSkip.db.test.js --forceExit
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
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'notified-skip-test-secret';
}

const pool = require('../db');
const { closeStalePunches } = require('../services/restaurantPunchCloseout');
const { sendNotification } = require('../services/notificationService');

jest.setTimeout(120000);

const RUN = crypto.randomUUID().slice(0, 8);

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'NotifiedSkip', $3, 'customer', TRUE, TRUE)`,
    [id, `skip-${label}-${id}@example.invalid`, label]
  );
  return id;
}

async function makeBusiness(owner, name) {
  const { rows: [b] } = await pool.query(
    'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
    [owner, name, 'UTC']
  );
  return Number(b.id);
}

ddescribe('Domain 9 item 7: punch closeout skips notified shifts and caches manager lookups', () => {
  let owner;
  let businessSkip;
  let businessCache;
  let yesterday;
  let shiftIds;
  let anchor;
  let entryDate;

  beforeAll(async () => {
    owner = await newUser(`owner-${RUN}`);
    businessSkip = await makeBusiness(owner, `Notified Skip ${RUN}`);
    businessCache = await makeBusiness(owner, `Manager Cache ${RUN}`);

    // Three users with one published shift each for yesterday in the
    // skip business, and no time entry for that date at all.
    const { rows: shiftUsers } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       SELECT gen_random_uuid(), 'skip-user-${RUN}-' || g || '@example.invalid',
              'x', 'NotifiedSkip', 'User', 'customer', TRUE, TRUE
         FROM generate_series(1, 3) g
       RETURNING id`,
      []
    );
    const y = new Date();
    y.setUTCHours(12, 0, 0, 0);
    y.setUTCDate(y.getUTCDate() - 1);
    yesterday = y.toISOString().slice(0, 10);
    const { rows: shifts } = await pool.query(
      `INSERT INTO business_staff_shifts
         (business_id, user_id, shift_date, start_time, end_time, published_at)
       SELECT $1::int, u.id, $2::date, '08:00'::time, '16:00'::time, NOW()
         FROM users u WHERE u.id = ANY($3::uuid[])
        ORDER BY u.id
       RETURNING id`,
      [businessSkip, yesterday, shiftUsers.map((r) => r.id)]
    );
    shiftIds = shifts.map((r) => Number(r.id));
    expect(shiftIds).toHaveLength(3);

    // Three users with one stale open entry each in the cache
    // business: clock-ins staggered one minute apart, three days ago
    // around midday UTC, so every entry is past its close time
    // (clock-in + 12h, no shifts) plus the 30-minute grace.
    const { rows: cacheUsers } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       SELECT gen_random_uuid(), 'cache-user-${RUN}-' || g || '@example.invalid',
              'x', 'ManagerCache', 'User', 'customer', TRUE, TRUE
         FROM generate_series(1, 3) g
       RETURNING id`,
      []
    );
    anchor = new Date();
    anchor.setUTCHours(12, 0, 0, 0);
    anchor.setUTCDate(anchor.getUTCDate() - 3);
    entryDate = anchor.toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, clock_in_at)
       SELECT $1::int, u.id, $2::date,
              $3::timestamptz - (u.rn - 1) * INTERVAL '1 minute'
         FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn
                 FROM users WHERE id = ANY($4::uuid[])) u`,
      [businessCache, entryDate, anchor.toISOString(), cacheUsers.map((r) => r.id)]
    );
  });

  afterAll(async () => {
    await pool.query(
      'DELETE FROM notifications WHERE delivery_key LIKE $1',
      [`missing-punch:%:${yesterday}:%`]
    ).catch(() => {});
    await pool.query('DELETE FROM business_time_entry_edits WHERE business_id IN ($1, $2)', [businessSkip, businessCache]);
    await pool.query('DELETE FROM business_time_entries WHERE business_id IN ($1, $2)', [businessSkip, businessCache]);
    await pool.query('DELETE FROM business_staff_shifts WHERE business_id IN ($1, $2)', [businessSkip, businessCache]);
    // Seeded businesses and users are left behind, same as the
    // Phase 2 and batch-limit tests: deleting a business fails in
    // this database because food_customer_wallet_operator_audit_events
    // carries ON DELETE/UPDATE DO INSTEAD NOTHING rules. The
    // disposable test database tolerates the leftovers; every run uses
    // a unique suffix, so they never collide.
    await pool.end();
  });

  test('(a) a shift with a missing-punch notification row is skipped on the next run', async () => {
    const first = await closeStalePunches({ businessId: businessSkip, db: pool, notify: false, now: new Date() });
    expect(first.errors).toEqual([]);
    expect(first.missing).toHaveLength(3);
    expect(first.missing.map((m) => m.shiftId).sort((a, b) => a - b))
      .toEqual([...shiftIds].sort((a, b) => a - b));

    // Simulate the first run having notified the first two shifts:
    // one delivery_key row per shift (the key is per manager; one
    // notified manager is enough for the shift to be skipped).
    for (const shiftId of shiftIds.slice(0, 2)) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, data, delivery_key)
         VALUES ($1, 'staff_time_entry_missing_punch', 't', 'b', '{}'::jsonb, $2)`,
        [owner, `missing-punch:${shiftId}:${yesterday}:${owner}`]
      );
    }

    const second = await closeStalePunches({ businessId: businessSkip, db: pool, notify: false, now: new Date() });
    expect(second.errors).toEqual([]);
    expect(second.missing).toHaveLength(1);
    expect(second.missing[0].shiftId).toBe(shiftIds[2]);

    // A notification row for a *different* shift does not hide this
    // one: the skip is keyed on this shift's id and date, not on the
    // business or the manager.
    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data, delivery_key)
       VALUES ($1, 'staff_time_entry_missing_punch', 't', 'b', '{}'::jsonb, $2)`,
      [owner, `missing-punch:${shiftIds[2]}:${yesterday}:${owner}`]
    );
    const third = await closeStalePunches({ businessId: businessSkip, db: pool, notify: false, now: new Date() });
    expect(third.missing).toHaveLength(0);
  });

  test('(b) the manager lookup runs once per business per run, not once per closed entry', async () => {
    let managerLookups = 0;
    const countingDb = {
      query: async (text, params) => {
        if (typeof text === 'string' && text.includes('business_members')) managerLookups += 1;
        return pool.query(text, params);
      },
      connect: () => pool.connect(),
    };
    sendNotification.mockClear();
    const result = await closeStalePunches({ businessId: businessCache, db: countingDb, notify: true, now: new Date() });
    expect(result.errors).toEqual([]);
    expect(result.closed).toHaveLength(3);
    expect(result.missing).toHaveLength(0);
    // Three entries closed, one manager (the business owner), one
    // lookup: the second and third closes reuse the cached managers.
    expect(managerLookups).toBe(1);
    // The cache does not suppress notifications: one per entry.
    expect(sendNotification).toHaveBeenCalledTimes(3);
  });
});
