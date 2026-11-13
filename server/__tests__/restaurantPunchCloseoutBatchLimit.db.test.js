'use strict';

/**
 * DB tests: background-jobs audit #48 — the punch-closeout sweep is
 * bounded per run.
 *
 * Proves, against a real migrated database:
 *   - the stale-entries select is capped at CLOSEOUT_BATCH_LIMIT (500)
 *     per run: with 501 stale entries one run closes exactly 500
 *     (the oldest), leaves the newest open, and the next run closes
 *     the remainder — repeated runs make forward progress through the
 *     backlog instead of re-processing the same rows forever;
 *   - the missing-punch shift select is capped the same way: with 501
 *     missing shifts for yesterday one run flags exactly 500, in a
 *     deterministic order (a second run with notify:false reports the
 *     same 500, because nothing was notified).
 *
 * Notifications are mocked out and the sweep runs with notify:false,
 * so the test measures the selects, not notification fan-out.
 *
 * Run with:
 *   NODE_ENV=test STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/restaurantPunchCloseoutBatchLimit.db.test.js --forceExit
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPunchIntegrityPhase2.db.test.js.
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
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'batch-limit-test-secret';
}

const pool = require('../db');
const { closeStalePunches, CLOSEOUT_BATCH_LIMIT } = require('../services/restaurantPunchCloseout');
const { sendNotification } = require('../services/notificationService');

jest.setTimeout(120000);

const RUN = crypto.randomUUID().slice(0, 8);
const USER_COUNT = 501;

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'BatchLimit', $3, 'customer', TRUE, TRUE)`,
    [id, `cap-${label}-${id}@example.invalid`, label]
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

async function openEntryCount(businessId) {
  const { rows: [row] } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM business_time_entries
      WHERE business_id = $1 AND clock_in_at IS NOT NULL
        AND clock_out_at IS NULL AND voided_at IS NULL`,
    [businessId]
  );
  return row.n;
}

ddescribe('Background-jobs audit #48: the closeout sweep is bounded per run', () => {
  let ownerA;
  let ownerB;
  let businessA;
  let businessB;
  let userIds;
  let anchor;
  let entryDate;
  let yesterday;

  beforeAll(async () => {
    expect(CLOSEOUT_BATCH_LIMIT).toBe(500);
    ownerA = await newUser(`owner-a-${RUN}`);
    ownerB = await newUser(`owner-b-${RUN}`);
    businessA = await makeBusiness(ownerA, `Batch Limit A ${RUN}`);
    businessB = await makeBusiness(ownerB, `Batch Limit B ${RUN}`);

    // 501 distinct users: the one-open-punch unique index
    // (uq_bte_one_open_punch) allows only one open entry per
    // (business, user), so a 501-entry backlog needs 501 users.
    const { rows } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       SELECT gen_random_uuid(), 'cap-user-${RUN}-' || g || '@example.invalid',
              'x', 'BatchLimit', 'User', 'customer', TRUE, TRUE
         FROM generate_series(1, $1) g
       RETURNING id`,
      [USER_COUNT]
    );
    expect(rows).toHaveLength(USER_COUNT);
    userIds = rows.map((r) => r.id);

    // Stale entries in business A: clock-ins staggered one minute
    // apart, three days ago around midday UTC, so every entry is
    // past its close time (clock-in + 12h, no shifts) plus the
    // 30-minute grace. All share one entry_date.
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
      [businessA, entryDate, anchor.toISOString(), userIds]
    );
    expect(await openEntryCount(businessA)).toBe(USER_COUNT);

    // Missing shifts in business B: one published shift per user for
    // yesterday, with no time entry for that date at all.
    const y = new Date();
    y.setUTCHours(12, 0, 0, 0);
    y.setUTCDate(y.getUTCDate() - 1);
    yesterday = y.toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO business_staff_shifts
         (business_id, user_id, shift_date, start_time, end_time, published_at)
       SELECT $1::int, u.id, $2::date, '08:00'::time, '16:00'::time, NOW()
         FROM users u WHERE u.id = ANY($3::uuid[])`,
      [businessB, yesterday, userIds]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM business_time_entry_edits WHERE business_id IN ($1, $2)', [businessA, businessB]);
    await pool.query('DELETE FROM business_time_entries WHERE business_id IN ($1, $2)', [businessA, businessB]);
    await pool.query('DELETE FROM business_staff_shifts WHERE business_id IN ($1, $2)', [businessA, businessB]);
    // The seeded businesses and users are left behind, same as the
    // Phase 2 tests: deleting a business fails in this database
    // because food_customer_wallet_operator_audit_events carries
    // ON DELETE/UPDATE DO INSTEAD NOTHING rules, which break the
    // ON DELETE SET NULL action of its business_id FK ("referential
    // integrity query ... gave unexpected result"). The disposable
    // test database tolerates the leftovers; every run uses a unique
    // suffix, so they never collide.
    await pool.end();
  });

  test('one run closes at most 500 stale entries, and the next run closes the rest', async () => {
    const first = await closeStalePunches({ businessId: businessA, db: pool, notify: false, now: new Date() });
    expect(first.errors).toEqual([]);
    expect(first.closed).toHaveLength(CLOSEOUT_BATCH_LIMIT);
    expect(first.missing).toHaveLength(0);
    expect(sendNotification).not.toHaveBeenCalled();

    // Exactly one entry is still open, and it is the newest: the
    // cap takes the 500 oldest first, so the run closed the backlog
    // head instead of an arbitrary 500.
    expect(await openEntryCount(businessA)).toBe(1);
    const { rows: [open] } = await pool.query(
      `SELECT clock_in_at FROM business_time_entries
        WHERE business_id = $1 AND clock_out_at IS NULL AND voided_at IS NULL`,
      [businessA]
    );
    expect(new Date(open.clock_in_at).getTime()).toBe(anchor.getTime());

    // Forward progress: the second run does not re-process the 500
    // already closed (they left the open set) — it closes the one
    // remainder and then finds nothing open.
    const second = await closeStalePunches({ businessId: businessA, db: pool, notify: false, now: new Date() });
    expect(second.errors).toEqual([]);
    expect(second.closed).toHaveLength(1);
    expect(await openEntryCount(businessA)).toBe(0);
  });

  test('the missing-punch select flags at most 500 shifts per run, in a deterministic order', async () => {
    const first = await closeStalePunches({ businessId: businessB, db: pool, notify: false, now: new Date() });
    expect(first.errors).toEqual([]);
    expect(first.closed).toHaveLength(0);
    expect(first.missing).toHaveLength(CLOSEOUT_BATCH_LIMIT);
    expect(first.missing.every((m) => m.shiftDate === yesterday)).toBe(true);
    expect(sendNotification).not.toHaveBeenCalled();

    // Deterministic order: a second run reports the same 500 shifts
    // in the same order. (With notify:false nothing was notified, so
    // re-selection is correct here. With notify:true each notified
    // shift is stamped missing_punch_notified_at — Domain 8 #11 —
    // so the next run flags the tail instead of re-reporting the
    // same oldest 500; see
    // restaurantPunchCloseoutMissingPunchFlag.db.test.js.)
    const second = await closeStalePunches({ businessId: businessB, db: pool, notify: false, now: new Date() });
    expect(second.missing).toHaveLength(CLOSEOUT_BATCH_LIMIT);
    expect(second.missing.map((m) => m.shiftId))
      .toEqual(first.missing.map((m) => m.shiftId));
  });
});
