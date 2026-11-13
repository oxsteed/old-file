'use strict';

/**
 * DB test: money-flows audit R7 (2026-11-07) — a forgotten punch on
 * an overnight shift closes at the shift end, not the 12-hour cap.
 *
 * Repro: overnight shift 22:00-06:00, clock-in 22:00, forgotten
 * clock-out. The close must be 06:00 the next morning (8h), never
 * clock-in + 12h (10:00, 12h). At the f6f790662 base the containing
 * shift subquery already adds a day when end_time <= start_time
 * (background-jobs audit #44 / design-review item 28), so this test
 * pins the exact R7 scenario against the real SQL as a regression
 * guard; it is expected to pass without a production change.
 *
 * Run with:
 *   DATABASE_URL=STATEMENT_TEST_DATABASE_URL=STATEMENT_JOB_TEST_DATABASE_URL=STATEMENT_INVESTIGATION_TEST_DATABASE_URL=ADMIN_GRANT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/restaurantPunchCloseoutOvernightR7.db.test.js --runInBand --forceExit
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
  process.env.DATABASE_URL = process.env.STATEMENT_TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const { closeStalePunches } = require('../services/restaurantPunchCloseout');

jest.setTimeout(120000);

const RUN = crypto.randomUUID().slice(0, 8);

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'BatchLimit', $3, 'customer', TRUE, TRUE)`,
    [id, `r7-${label}-${id}@example.invalid`, label]
  );
  return id;
}

ddescribe('Money flows R7: overnight forgotten punch closes at shift end', () => {
  let businessId;
  let workerId;

  beforeAll(async () => {
    const owner = await newUser(`owner-${RUN}`);
    workerId = await newUser(`worker-${RUN}`);
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `R7 Bistro ${RUN}`, 'UTC']
    );
    businessId = Number(b.id);
    // Published overnight shift 22:00-06:00 on 2026-11-06.
    await pool.query(
      `INSERT INTO business_staff_shifts
         (business_id, user_id, shift_date, start_time, end_time, published_at)
       VALUES ($1, $2, '2026-11-06'::date, '22:00'::time, '06:00'::time, NOW())`,
      [businessId, workerId]
    );
    // Forgotten punch: clocked in 22:00, never clocked out.
    await pool.query(
      `INSERT INTO business_time_entries (business_id, user_id, entry_date, clock_in_at)
       VALUES ($1, $2, '2026-11-06'::date, '2026-11-06T22:00:00Z'::timestamptz)`,
      [businessId, workerId]
    );
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('closes at 06:00 next day (8h), not clock-in + 12h', async () => {
    const result = await closeStalePunches({
      businessId,
      db: pool,
      notify: false,
      now: new Date('2026-11-07T07:00:00Z'),
    });
    expect(result.errors).toEqual([]);
    expect(result.closed).toHaveLength(1);
    const [closed] = result.closed;
    expect(closed.close_reason).toBe('auto_close_shift_end');
    expect(new Date(closed.clock_out_at).toISOString()).toBe('2026-11-07T06:00:00.000Z');
    expect(Number(closed.hours_worked)).toBe(8);
    // The stored row agrees: 8h, flagged system-closed at shift end.
    const { rows: [row] } = await pool.query(
      `SELECT clock_out_at, hours_worked, system_closed_reason
         FROM business_time_entries
        WHERE business_id = $1 AND user_id = $2 AND entry_date = '2026-11-06'::date`,
      [businessId, workerId]
    );
    expect(new Date(row.clock_out_at).toISOString()).toBe('2026-11-07T06:00:00.000Z');
    expect(Number(row.hours_worked)).toBe(8);
    expect(row.system_closed_reason).toBe('auto_close_shift_end');
  });
});
