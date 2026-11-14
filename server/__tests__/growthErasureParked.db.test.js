'use strict';

/**
 * Domain 8 #17: parked growth-erasure rows have no operator reset path.
 *
 * Against the real migrated schema in a disposable schema:
 *   - listParked returns only 'parked' rows, with a pagination total;
 *   - resetParked flips a parked row back to 'pending', zeroes the
 *     verification attempt count, and clears the parked flag from the
 *     verification JSON, so the hourly worker picks it up again;
 *   - resetParked on a non-parked row (or an unknown id) returns null
 *     and changes nothing.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 */
const crypto = require('crypto');

const schema = `growth_parked_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Disposable database required');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const { listParked, resetParked } = require('../services/growthErasureParkedService');

(url ? describe : describe.skip)('growth erasure parked queue: operator reset path', () => {
  let parkedId;
  let pendingId;

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.growth_erasure_queue (LIKE public.growth_erasure_queue INCLUDING ALL)`);
    const subjectA = 'a'.repeat(64);
    const subjectB = 'b'.repeat(64);
    const subjectC = 'c'.repeat(64);
    ({ rows: [{ id: parkedId }] } = await db.query(
      `INSERT INTO growth_erasure_queue (subject_key, device_keys, reason, status, verification_attempts,
          verification, requested_at)
       VALUES ($1, '{}', 'account_erasure', 'parked', 3,
          '{"method":"synchronous_mutation_all_replicas","error":"growth_erasure_verification_failed","table":"activity_events","parked":true}'::jsonb,
          NOW() - INTERVAL '2 hours') RETURNING id`,
      [subjectA],
    ));
    await db.query(
      `INSERT INTO growth_erasure_queue (subject_key, device_keys, reason, status, verification_attempts,
          verification, requested_at)
       VALUES ($1, '{}', 'account_erasure', 'parked', 3,
          '{"method":"synchronous_mutation_all_replicas","error":"growth_erasure_verification_failed","table":"subject_activity_daily","parked":true}'::jsonb,
          NOW() - INTERVAL '1 hour') RETURNING id`,
      [subjectB],
    );
    ({ rows: [{ id: pendingId }] } = await db.query(
      `INSERT INTO growth_erasure_queue (subject_key, device_keys, reason, status, verification_attempts, requested_at)
       VALUES ($1, '{}', 'account_erasure', 'pending', 0, NOW()) RETURNING id`,
      [subjectC],
    ));
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
    await db.end();
  });

  test('listParked returns only parked rows, oldest first, with a total', async () => {
    const { rows, pagination } = await listParked(db, { limit: 25, offset: 0 });
    expect(rows.map((r) => Number(r.id))).toEqual([Number(parkedId), expect.any(Number)]);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(parkedId);
    expect(rows.every((r) => r.status === 'parked')).toBe(true);
    expect(pagination).toMatchObject({ limit: 25, offset: 0, total: 2, hasMore: false });
  });

  test('resetParked returns a parked row to pending and clears the park flag', async () => {
    const result = await resetParked(db, { id: parkedId });
    expect(result).not.toBeNull();
    expect(result.row.status).toBe('pending');
    expect(Number(result.row.verification_attempts)).toBe(0);
    expect(result.row.verification.parked).toBeUndefined();
    const { rows: [after] } = await db.query(
      'SELECT status, verification_attempts, verification FROM growth_erasure_queue WHERE id = $1',
      [parkedId],
    );
    expect(after.status).toBe('pending');
    expect(Number(after.verification_attempts)).toBe(0);
    expect(after.verification.parked).toBeUndefined();
  });

  test('resetParked on a pending row or an unknown id returns null and changes nothing', async () => {
    expect(await resetParked(db, { id: pendingId })).toBeNull();
    expect(await resetParked(db, { id: 987654321 })).toBeNull();
    const { rows: [still] } = await db.query(
      'SELECT status FROM growth_erasure_queue WHERE id = $1',
      [pendingId],
    );
    expect(still.status).toBe('pending');
  });
});
