'use strict';

// Money flows W7: the retention sweep is unbounded, and the audit-log
// name scrub runs per person per restaurant: anonymizeFormerStaff
// scans the whole business's audit log for every person in every
// restaurant, so cost grows with headcount times audit-log size
// times restaurant count.
//
// The LIMIT batching half is already covered by Domain 9 item 4 on
// draft PR #782 (commit 709f4e19a: LIMIT 200 + FOR UPDATE SKIP LOCKED
// on both due selects). The remainder built here is the scrub: the
// audit log is business-scoped, so it is scrubbed once per business
// per person (in anonymizePerson, after the restaurant loop) instead
// of once per restaurant, and in a single combined UPDATE instead of
// one pass per name needle.
//
// Repro-first: a person with two restaurants in one business. Before
// the fix the audit-log UPDATE runs once per name needle per
// restaurant (6 times for 3 needles x 2 restaurants); after the fix
// it runs exactly once, the names are still replaced, and the
// outcome still reports the scrubbed count.
//
// DB: disposable credit_statement_test only, migrated first:
//   DATABASE_URL=<redacted> npm run migrate
//   STATEMENT_TEST_DATABASE_URL=<redacted>
//     npx jest __tests__/moneyFlowsW7AuditScrub.db.test.js

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
const { anonymizePerson } = require('../jobs/restaurantRetentionJob');

ddescribe('Money flows W7: audit-log scrub runs once per business', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const ownerId = crypto.randomUUID();
  const staffId = crypto.randomUUID();
  const otherOwnerId = crypto.randomUUID();
  let businessId;
  let otherBusinessId;
  let restaurantA;
  let restaurantB;

  beforeAll(async () => {
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15)',
      [ownerId, `w7-owner-${suffix}@example.com`, 'test-hash', 'W7', 'Owner',
       staffId, `w7-staff-${suffix}@example.com`, 'test-hash', 'W7First', 'W7Last',
       otherOwnerId, `w7-other-${suffix}@example.com`, 'test-hash', 'W7', 'Other'],
    );
    ({ rows: [{ id: businessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `W7 Audit Scrub ${suffix}`],
    ));
    businessId = Number(businessId);
    ({ rows: [{ id: otherBusinessId }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [otherOwnerId, `W7 Audit Scrub Other ${suffix}`],
    ));
    otherBusinessId = Number(otherBusinessId);
    ({ rows: [{ id: restaurantA }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `W7 Store A ${suffix}`],
    ));
    restaurantA = Number(restaurantA);
    ({ rows: [{ id: restaurantB }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
       VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
      [businessId, ownerId, `W7 Store B ${suffix}`],
    ));
    restaurantB = Number(restaurantB);
    // Two audit rows naming the person (free-text full name, and a
    // quoted first name as a JSON string value), one row naming
    // someone else in the same business, and one row naming the
    // person in a different business (different business_id, so it
    // must not be touched).
    await pool.query(
      `INSERT INTO business_audit_log (business_id, actor_user_id, action, after_state)
       VALUES ($1, $2, 'w7.note', '{"note": "W7First W7Last did the count"}'::jsonb),
              ($1, $2, 'w7.name', '{"first_name": "W7First"}'::jsonb),
              ($1, $2, 'w7.other', '{"note": "Somebody Else did the count"}'::jsonb),
              ($3, $2, 'w7.foreign', '{"note": "W7First W7Last did the count"}'::jsonb)`,
      [businessId, staffId, otherBusinessId],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM food_restaurants WHERE id IN ($1, $2)', [restaurantA, restaurantB]).catch(() => {});
    await pool.query('DELETE FROM businesses WHERE id IN ($1, $2)', [businessId, otherBusinessId]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id IN ($1, $2, $3)', [ownerId, staffId, otherOwnerId]).catch(() => {});
    await pool.end();
  });

  test('one audit-log pass per business, names still replaced', async () => {
    let auditUpdates = 0;
    const countingDb = {
      query: async (text, params) => {
        if (/UPDATE business_audit_log/.test(String(text))) auditUpdates += 1;
        return pool.query(text, params);
      },
    };
    const outcome = await anonymizePerson(countingDb, {
      businessId, userId: staffId, retainUntil: '2020-01-01',
    });
    expect(outcome.skipped).toBe(false);
    expect(auditUpdates).toBe(1);
    expect(outcome.audit_names_scrubbed).toBe(2);
    const { rows } = await pool.query(
      `SELECT action, after_state FROM business_audit_log
        WHERE business_id = $1 ORDER BY action`,
      [businessId],
    );
    expect(rows).toHaveLength(3);
    const byAction = Object.fromEntries(rows.map((row) => [row.action, row.after_state]));
    expect(byAction['w7.note']).toEqual({ note: 'Former staff did the count' });
    expect(byAction['w7.name']).toEqual({ first_name: 'Former staff' });
    expect(byAction['w7.other']).toEqual({ note: 'Somebody Else did the count' });
    const { rows: foreign } = await pool.query(
      `SELECT after_state FROM business_audit_log WHERE business_id = $1`,
      [otherBusinessId],
    );
    expect(foreign).toHaveLength(1);
    expect(foreign[0].after_state).toEqual({ note: 'W7First W7Last did the count' });
  });
});
