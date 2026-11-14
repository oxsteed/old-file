'use strict';

// Domain 8 #5 (F-13): the original PaymentIntent migration skipped its
// unique index when duplicates existed and left only a RAISE WARNING with
// no durable record. The follow-up migration (20261114010200) writes a
// dedupe-keyed open incident_log row when duplicates exist and creates the
// index once the count is zero; migrate.js now captures migration notices.
// This file proves both branches against the real tables, plus the notice
// handler against a real pg client.
//
// The test drops the F-13 index in the disposable test database and
// recreates it before finishing, so the shared test schema is left exactly
// as the repair migration leaves it.

jest.unmock('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const { attachMigrationNoticeHandler } = require('../migrate');

const database = disposableDatabaseOptIn('STATEMENT_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.STATEMENT_TEST_DATABASE_URL = database;
}
const describeDatabase = database ? describe : describe.skip;

jest.setTimeout(180000);

test('F-13 repair test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('F-13 PaymentIntent index repair (Domain 8 #5)', () => {
  let pool;
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261114010200_f13_payment_intent_index_repair.sql'),
    'utf8'
  );
  const intent = `pi_f13_test_${crypto.randomUUID()}`;
  const created = { users: [], businesses: [], restaurants: [], orders: [] };

  async function indexPresent() {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uq_food_orders_stripe_payment_intent'`
    );
    return rows.length > 0;
  }

  async function openIncident() {
    const { rows } = await pool.query(
      `SELECT id, type, severity, details, occurrence_count FROM incident_log
        WHERE dedupe_key = 'f13-payment-intent-duplicates' AND resolved_at IS NULL`
    );
    return rows[0] || null;
  }

  async function makeDuplicateOrders() {
    const userId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', 'F13', 'Test', 'customer', 'US', 'en')`,
      [userId, `f13-${userId}@example.invalid`]
    );
    created.users.push(userId);
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, 'F-13 test business') RETURNING id`,
      [userId]
    );
    created.businesses.push(business.id);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'F-13 test restaurant') RETURNING id`,
      [business.id, userId]
    );
    created.restaurants.push(restaurant.id);
    for (let queue = 1; queue <= 2; queue += 1) {
      const { rows: [order] } = await pool.query(
        `INSERT INTO food_orders (restaurant_id, business_id, queue_number, stripe_payment_intent_id)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [restaurant.id, business.id, queue, intent]
      );
      created.orders.push(order.id);
    }
  }

  async function cleanupFixtures() {
    // Resolve the incident first: it must not survive the test even if a
    // fixture delete below fails.
    try {
      await pool.query(
        `UPDATE incident_log SET resolved_at = NOW(), resolution_notes = 'F-13 repair test cleanup'
          WHERE dedupe_key = 'f13-payment-intent-duplicates' AND resolved_at IS NULL`
      );
    } catch (error) {
      // Best effort; the next run's beforeAll resolves it instead.
    }
    // Teardown runs with replication role replica: deleting the business
    // otherwise trips the food_customer_wallet_operator_audit_events FK
    // trigger (operator-audit rows written by the order deletes reference
    // it). This is the same teardown pattern the credit DB tests use.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      if (created.orders.length > 0) {
        await client.query(`DELETE FROM food_orders WHERE id = ANY($1::bigint[])`, [created.orders]);
        created.orders = [];
      }
      if (created.restaurants.length > 0) {
        await client.query(`DELETE FROM food_restaurants WHERE id = ANY($1::bigint[])`, [created.restaurants]);
        created.restaurants = [];
      }
      if (created.businesses.length > 0) {
        await client.query(`DELETE FROM businesses WHERE id = ANY($1::bigint[])`, [created.businesses]);
        created.businesses = [];
      }
      if (created.users.length > 0) {
        await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [created.users]);
        created.users = [];
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: database });
    // Start clean: no stale open F-13 incident from an aborted run.
    await pool.query(
      `UPDATE incident_log SET resolved_at = NOW(), resolution_notes = 'F-13 repair test setup'
        WHERE dedupe_key = 'f13-payment-intent-duplicates' AND resolved_at IS NULL`
    );
  });

  afterAll(async () => {
    if (pool) {
      try {
        await cleanupFixtures();
        // Leave the schema as the repair migration leaves it: index present.
        await pool.query(migrationSql);
      } catch (error) {
        // Never fail the suite in teardown; the next run's beforeAll
        // resolves a stale incident and the migration recreates the index.
        // eslint-disable-next-line no-console
        console.error('F-13 repair test teardown failed:', error.message);
      } finally {
        await pool.end();
      }
    }
  });

  test('duplicates write a durable open incident and the index stays absent', async () => {
    await pool.query(`DROP INDEX IF EXISTS uq_food_orders_stripe_payment_intent`);
    expect(await indexPresent()).toBe(false);
    await makeDuplicateOrders();
    await pool.query(migrationSql);
    expect(await indexPresent()).toBe(false);
    const incident = await openIncident();
    expect(incident).toMatchObject({ type: 'f13_payment_intent_duplicates', severity: 'warning' });
    expect(incident.details.duplicate_intent_count).toBe(1);
    expect(String(incident.details.sample_intents)).toContain(intent);
    await cleanupFixtures();
  });

  test('with no duplicates the migration creates the index', async () => {
    expect(await indexPresent()).toBe(false);
    await pool.query(migrationSql);
    expect(await indexPresent()).toBe(true);
    expect(await openIncident()).toBeNull();
  });

  test('migration notices are captured by the migrate.js handler', async () => {
    const client = new Client({ connectionString: database });
    const seen = [];
    const fakeLog = { warn: jest.fn((message, fields) => seen.push({ message, fields })) };
    await client.connect();
    try {
      const detach = attachMigrationNoticeHandler(client, 'test-migration.sql', fakeLog);
      await client.query(`DO $$ BEGIN RAISE WARNING 'F-13 probe warning'; END $$;`);
      expect(fakeLog.warn).toHaveBeenCalledWith(
        'Migration notice',
        expect.objectContaining({ filename: 'test-migration.sql', severity: 'WARNING', message: 'F-13 probe warning' })
      );
      expect(seen[0].fields.message).toBe('F-13 probe warning');
      // Detaching must stop logging: without it, the pooled client kept
      // every migration's handler, so one notice re-logged under hundreds
      // of stale filenames and the rehearsal's log capture overflowed
      // (PR #783 CI, run 43483058186).
      detach();
      const callsAfterDetach = fakeLog.warn.mock.calls.length;
      await client.query(`DO $$ BEGIN RAISE WARNING 'F-13 second warning'; END $$;`);
      expect(fakeLog.warn.mock.calls.length).toBe(callsAfterDetach);
    } finally {
      await client.end();
    }
  });
});
