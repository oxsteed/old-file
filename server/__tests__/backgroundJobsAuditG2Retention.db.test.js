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
    // The pool is ended by the file-level afterAll below, not here:
    // a second describe in this file still needs it.
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

ddescribe('Domain 9 (2026-11-13) item 4: the scrub runs one pass per table, not one per name part', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  let businessId;
  let restaurantId;
  let entryId;
  let editId;
  let auditId;

  beforeAll(async () => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)',
      [ownerId, `d9-owner-${suffix}@example.com`, 'test-hash', 'Domain', 'Nine',
       staffId, `d9-staff-${suffix}@example.com`, 'test-hash', 'Anonym', 'Checkerson'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Domain 9 Scrub ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `Domain 9 Scrub ${suffix}`],
    ));
    restaurantId = Number(restaurantId);
    ({ rows: [{ id: entryId }] } = await pool.query(
      `INSERT INTO business_time_entries
         (business_id, user_id, entry_date, clock_in_at, clock_out_at, description)
       VALUES ($1, $2, '2020-01-02', '2020-01-02 08:00:00+00', '2020-01-02 16:00:00+00', 'plain note')
       RETURNING id`,
      [businessId, staffId],
    ));
    entryId = Number(entryId);
    ({ rows: [{ id: editId }] } = await pool.query(
      `INSERT INTO business_time_entry_edits
         (entry_id, business_id, editor_user_id, field, old_value, new_value, reason)
       VALUES ($1, $2, $3, 'clock_out_at', 'Anonym', 'Anonym Checkerson', 'Fix for Anonym Checkerson')
       RETURNING id`,
      [entryId, businessId, ownerId],
    ));
    editId = Number(editId);
    ({ rows: [{ id: auditId }] } = await pool.query(
      `INSERT INTO business_audit_log
         (business_id, actor_user_id, action, before_state, after_state, metadata)
       VALUES ($1, $2, 'staff_note',
               '{"note": "Anonym Checkerson was here", "first_name": "Anonym"}'::jsonb,
               '{}'::jsonb, '{}'::jsonb)
       RETURNING id`,
      [businessId, ownerId],
    ));
    auditId = Number(auditId);
    // Three live docs: the old per-row loop deleted them one UPDATE
    // at a time and the orphaned-keys recovery then re-collected the
    // same keys, so each key was returned (and enqueued) twice.
    await pool.query(
      `INSERT INTO restaurant_staff_documents
         (restaurant_id, user_id, doc_type, title, storage_key)
       VALUES ($1, $2, 'other', 'd1', $3), ($1, $2, 'other', 'd2', $4), ($1, $2, 'other', 'd3', $5)`,
      [restaurantId, staffId, `d9-scrub-doc-1-${suffix}`, `d9-scrub-doc-2-${suffix}`, `d9-scrub-doc-3-${suffix}`],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM business_time_entry_edits WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM business_time_entries WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM business_audit_log WHERE business_id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM restaurant_staff_documents WHERE restaurant_id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM food_restaurants WHERE id = $1', [restaurantId]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id = $1', [businessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [ownerId, staffId]).catch(() => {});
  });

  test('one UPDATE per scrubbed table, same rows scrubbed, each doc key returned once', async () => {
    const updateCounts = { audit: 0, edits: 0, docs: 0 };
    const countingDb = {
      query: async (text, params) => {
        const sql = String(text);
        if (sql.includes('UPDATE business_audit_log')) updateCounts.audit += 1;
        if (sql.includes('UPDATE business_time_entry_edits')) updateCounts.edits += 1;
        if (sql.includes('UPDATE restaurant_staff_documents')) updateCounts.docs += 1;
        return pool.query(text, params);
      },
    };
    const outcome = await anonymizeFormerStaff(countingDb, {
      businessId, restaurantId, userId: staffId, retainUntil: '2020-01-01',
    });
    expect(outcome.skipped).toBe(false);
    // One combined pass per table: three name parts / three needles
    // used to mean up to three UPDATEs on each table.
    expect(updateCounts).toEqual({ audit: 1, edits: 1, docs: 1 });
    expect(outcome.time_entry_edits_scrubbed).toBe(1);
    expect(outcome.audit_names_scrubbed).toBe(1);
    expect(outcome.documents_deleted).toBe(3);
    expect(outcome.storageKeysToDelete).toHaveLength(3);
    expect(outcome.storageKeysToDelete).toEqual(expect.arrayContaining([
      `d9-scrub-doc-1-${suffix}`, `d9-scrub-doc-2-${suffix}`, `d9-scrub-doc-3-${suffix}`,
    ]));

    // The scrubbed content is the same as the per-part passes
    // produced: the full name, then the quoted first/last names.
    const { rows: [edit] } = await pool.query(
      'SELECT reason, old_value, new_value FROM business_time_entry_edits WHERE id = $1',
      [editId]
    );
    expect(edit.reason).toBe('Fix for Former staff');
    expect(edit.old_value).toBe('Former staff');
    expect(edit.new_value).toBe('Former staff');
    const { rows: [audit] } = await pool.query(
      'SELECT before_state::text AS text FROM business_audit_log WHERE id = $1',
      [auditId]
    );
    expect(audit.text).not.toContain('Anonym');
    expect(audit.text).not.toContain('Checkerson');
    expect(audit.text).toContain('Former staff');
    // The JSON is still valid after the quoted-needle replacement.
    expect(() => JSON.parse(audit.text)).not.toThrow();
  });
});

// One pool for the whole file: the describes above end after their
// own tests, and a pool.end() in the first describe's afterAll
// would break the second describe's beforeAll.
afterAll(async () => {
  await pool.end();
});
