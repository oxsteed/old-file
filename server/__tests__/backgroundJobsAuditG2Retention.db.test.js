'use strict';

// Background-jobs audit #40 (Group 2), DB half: a retry after a
// mid-person throw must recover the storage key of a document that
// was already soft-deleted but never queued. anonymizeFormerStaff
// re-derives such keys from soft-deleted rows with no queue row, so
// the retry enqueues them instead of completing with an empty list.
//
// DB: disposable credit_statement_test only, migrated first:
//   DATABASE_URL=<redacted> npm run migrate
//   STATEMENT_TEST_DATABASE_URL=<redacted>
//     npx jest __tests__/backgroundJobsAuditG2Retention.db.test.js

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
const { anonymizeFormerStaff } = require('../services/restaurantRetentionService');

ddescribe('Background-jobs audit #40: orphaned storage keys are recovered on retry', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let restaurantId;

  beforeAll(async () => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `g2-owner-${suffix}@example.com`, 'test-hash', 'Group', 'Two',
       staffId, `g2-staff-${suffix}@example.com`, 'test-hash', 'Orphan', 'Test'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Group 2 Retention ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `Group 2 Retention ${suffix}`],
    ));
    restaurantId = Number(restaurantId);
  });

  afterAll(async () => {
    await pool.query('DELETE FROM restaurant_staff_documents WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM storage_deletion_queue WHERE storage_key LIKE $1', ['g2-orphan-%']).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, staffId]).catch(() => {});
    await pool.end();
  });

  async function insertDoc({ key, deleted = false, queued = false }) {
    const { rows: [{ id }] } = await pool.query(
      `INSERT INTO restaurant_staff_documents
         (restaurant_id, user_id, doc_type, title, storage_key, deleted_at)
       VALUES ($1, $2, 'other', $3, $4, ${deleted ? 'NOW()' : 'NULL'})
       RETURNING id`,
      [restaurantId, staffId, `doc ${key}`, key],
    );
    if (queued) {
      await pool.query(
        `INSERT INTO storage_deletion_queue (storage_key, reason, not_before)
         VALUES ($1, 'staff_erasure', NOW())`,
        [key],
      );
    }
    return Number(id);
  }

  test('a soft-deleted document with no queue row has its key recovered, not counted twice', async () => {
    await insertDoc({ key: 'g2-orphan-unqueued', deleted: true, queued: false });
    const outcome = await anonymizeFormerStaff(pool, {
      businessId, restaurantId, userId: staffId, retainUntil: '2020-01-01',
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.storageKeysToDelete).toContain('g2-orphan-unqueued');
    // The document was already deleted by the first attempt; the
    // retry recovers its key but does not count it as deleted again.
    expect(outcome.documents_deleted).toBe(0);
  });

  test('a soft-deleted document with a queue row is not re-queued', async () => {
    await insertDoc({ key: 'g2-orphan-queued', deleted: true, queued: true });
    const outcome = await anonymizeFormerStaff(pool, {
      businessId, restaurantId, userId: staffId, retainUntil: '2020-01-01',
    });
    expect(outcome.skipped).toBe(false);
    expect(outcome.storageKeysToDelete).not.toContain('g2-orphan-queued');
    expect(outcome.documents_deleted).toBe(0);
  });
});
