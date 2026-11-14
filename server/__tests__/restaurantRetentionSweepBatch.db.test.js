'use strict';

/**
 * DB tests: Domain 8 #12 — the retention sweep bounds its queries.
 *
 * Proves, against a real migrated database with the production batch
 * limit (200):
 *   - 201 approved due erasure requests are all completed by one
 *     sweep() call: the first batch takes 200 and the cursor-paged
 *     second batch takes the remaining 1, instead of one unbounded
 *     select materializing the whole backlog;
 *   - 201 due offboarded staff with no erasure request are all
 *     auto-anonymized the same way;
 *   - a clean sweep raises no incident.
 *
 * No food_restaurants rows are seeded, so anonymizePerson completes
 * each person with zero totals; the test measures the sweep's
 * batching, not anonymization.
 *
 * Run with:
 *   NODE_ENV=test STATEMENT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test \
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/restaurantRetentionSweepBatch.db.test.js --forceExit
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPunchCloseoutBatchLimit.db.test.js.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

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
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'retention-batch-test-secret';
}

const pool = require('../db');
const { sweep, SWEEP_BATCH_LIMIT } = require('../jobs/restaurantRetentionJob');

jest.setTimeout(180000);

const RUN = crypto.randomUUID().slice(0, 8);
const PERSON_COUNT = 201;

ddescribe('Domain 8 #12: the retention sweep pages a backlog larger than one batch', () => {
  let owner;
  let businessRequests;
  let businessStaff;
  let requestUserIds;
  let staffUserIds;

  beforeAll(async () => {
    expect(SWEEP_BATCH_LIMIT).toBe(200);
    owner = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'RetentionBatch', $3, 'customer', TRUE, TRUE)`,
      [owner, `ret-batch-owner-${RUN}@example.invalid`, `owner-${RUN}`]
    );
    const { rows: [b1] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `Retention Batch Requests ${RUN}`, 'UTC']
    );
    businessRequests = Number(b1.id);
    const { rows: [b2] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `Retention Batch Staff ${RUN}`, 'UTC']
    );
    businessStaff = Number(b2.id);

    // 201 users per half, each with a past-retention offboarding
    // record. The requests half additionally gets an approved
    // erasure request per user, with staggered requested_at so the
    // (requested_at, id) cursor order is deterministic.
    const { rows: reqUsers } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       SELECT gen_random_uuid(), 'ret-batch-req-${RUN}-' || g || '@example.invalid',
              'x', 'RetentionBatch', 'User', 'customer', TRUE, TRUE
         FROM generate_series(1, $1) g
       RETURNING id`,
      [PERSON_COUNT]
    );
    requestUserIds = reqUsers.map((r) => r.id);
    const { rows: staffUsers } = await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       SELECT gen_random_uuid(), 'ret-batch-staff-${RUN}-' || g || '@example.invalid',
              'x', 'RetentionBatch', 'User', 'customer', TRUE, TRUE
         FROM generate_series(1, $1) g
       RETURNING id`,
      [PERSON_COUNT]
    );
    staffUserIds = staffUsers.map((r) => r.id);

    await pool.query(
      `INSERT INTO staff_offboarding_records (business_id, user_id, retain_until)
       SELECT $1::int, u.id, '2020-01-01'::date FROM users u WHERE u.id = ANY($2::uuid[])`,
      [businessRequests, requestUserIds]
    );
    await pool.query(
      `INSERT INTO restaurant_erasure_requests (business_id, user_id, requested_by, status, reason, requested_at)
       SELECT $1::int, u.id, $3::uuid, 'approved', 'retention_expired_test',
              NOW() - (u.rn * INTERVAL '1 minute')
         FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn
                 FROM users WHERE id = ANY($2::uuid[])) u`,
      [businessRequests, requestUserIds, owner]
    );
    await pool.query(
      `INSERT INTO staff_offboarding_records (business_id, user_id, retain_until)
       SELECT $1::int, u.id, '2020-01-01'::date FROM users u WHERE u.id = ANY($2::uuid[])`,
      [businessStaff, staffUserIds]
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_erasure_requests WHERE business_id IN ($1, $2)', [businessRequests, businessStaff]);
    await pool.query('DELETE FROM staff_offboarding_records WHERE business_id IN ($1, $2)', [businessRequests, businessStaff]);
    // The seeded businesses and users are left behind, same as the
    // Phase 2 punch tests: deleting a business fails in this database
    // because food_customer_wallet_operator_audit_events carries
    // ON DELETE/UPDATE DO INSTEAD NOTHING rules. The disposable
    // test database tolerates the leftovers; every run uses a unique
    // suffix, so they never collide.
    await pool.end();
  });

  test('one sweep completes all 201 due requests and all 201 due staff', async () => {
    const result = await sweep(pool);
    expect(result.errors).toEqual([]);
    expect(result.incidentId).toBeNull();
    expect(result.completedRequests).toBe(PERSON_COUNT);
    expect(result.autoAnonymized).toBe(PERSON_COUNT);
    expect(result.skipped).toBe(0);

    const { rows: [completed] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_erasure_requests
        WHERE business_id = $1 AND status = 'completed'`,
      [businessRequests]
    );
    expect(completed.n).toBe(PERSON_COUNT);
    const { rows: [auto] } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_erasure_requests
        WHERE business_id = $1 AND status = 'completed' AND reason = 'retention_expired_auto'`,
      [businessStaff]
    );
    expect(auto.n).toBe(PERSON_COUNT);

    // A second sweep finds nothing due: no double-completion, no
    // re-insert of auto rows.
    const second = await sweep(pool);
    expect(second.completedRequests).toBe(0);
    expect(second.autoAnonymized).toBe(0);
    expect(second.errors).toEqual([]);
  });
});
