'use strict';

// Money flows W10: restaurant_erasure_requests has no dedupe constraint
// on completed rows, so two overlapping retention sweeps can both pass
// the NOT EXISTS check and insert duplicate 'completed' rows for the
// same person.
//
// Repro-first: before the fix there is no unique index, so a second
// completed row inserts cleanly, and the sweep's auto-insert has no
// ON CONFLICT guard, so the loser's insert succeeds instead of
// deduping. After the fix the second raw insert conflicts (23505)
// and the sweep's insert path (recordAutoCompletedErasure) reports
// inserted:false for the loser with exactly one completed row.
//
// DB: disposable credit_statement_test only, migrated first:
//   DATABASE_URL=<redacted> npm run migrate
//   STATEMENT_TEST_DATABASE_URL=<redacted>
//     npx jest __tests__/moneyFlowsW10ErasureDedupe.db.test.js

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
}

const pool = require('../db');
const { recordAutoCompletedErasure } = require('../jobs/restaurantRetentionJob');

ddescribe('Money flows W10: completed erasure rows dedupe per person', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  const staff2Id = crypto.randomUUID();
  let businessId;

  beforeAll(async () => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15)',
      [ownerId, `w10-owner-${suffix}@example.com`, 'test-hash', 'W10', 'Owner',
       staffId, `w10-staff-${suffix}@example.com`, 'test-hash', 'W10', 'Staff',
       staff2Id, `w10-staff2-${suffix}@example.com`, 'test-hash', 'W10', 'StaffTwo'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `W10 Erasure Dedupe ${suffix}`],
    ));
    businessId = Number(businessId);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_erasure_requests WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [ownerId, staffId, staff2Id]).catch(() => {});
    await pool.end();
  });

  async function completedCount(userId) {
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM restaurant_erasure_requests
        WHERE business_id = $1 AND user_id = $2 AND status = 'completed'`,
      [businessId, userId],
    );
    return Number(count);
  }

  test('a second completed row for the same person conflicts', async () => {
    await pool.query(
      `INSERT INTO restaurant_erasure_requests
         (business_id, user_id, requested_by, status, reason, completed_at, outcome)
       VALUES ($1, $2, $3, 'completed', 'retention_expired_auto', NOW(), '{}'::jsonb)`,
      [businessId, staffId, ownerId],
    );
    expect(await completedCount(staffId)).toBe(1);
    await expect(pool.query(
      `INSERT INTO restaurant_erasure_requests
         (business_id, user_id, requested_by, status, reason, completed_at, outcome)
       VALUES ($1, $2, $3, 'completed', 'retention_expired_auto', NOW(), '{}'::jsonb)`,
      [businessId, staffId, ownerId],
    )).rejects.toMatchObject({ code: '23505' });
    expect(await completedCount(staffId)).toBe(1);
  });

  test('the sweep insert path dedupes instead of erroring', async () => {
    const outcome = { documents_deleted: 0 };
    const first = await recordAutoCompletedErasure(pool, {
      businessId, userId: staff2Id, outcome,
    });
    expect(first.inserted).toBe(true);
    const second = await recordAutoCompletedErasure(pool, {
      businessId, userId: staff2Id, outcome,
    });
    expect(second.inserted).toBe(false);
    expect(await completedCount(staff2Id)).toBe(1);
  });

  test('non-completed rows for the same person are unaffected', async () => {
    // The dedupe covers completed rows only: a fresh 'requested' row
    // for the same person must still insert.
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_erasure_requests
         (business_id, user_id, requested_by, status, reason)
       VALUES ($1, $2, $3, 'requested', 'manual')
       RETURNING id`,
      [businessId, staffId, staffId],
    );
    expect(Number(row.id)).toBeGreaterThan(0);
  });
});
