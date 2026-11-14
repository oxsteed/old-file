'use strict';

// Domain 8 #14: helper_payment_policy_history is append-only (migration 579
// installs DO INSTEAD NOTHING rules on UPDATE/DELETE), so its helper_id
// REFERENCES users(id) ON DELETE CASCADE can never be honored. Postgres
// detects the rule-rewritten cascade DELETE and the helper delete fails
// outright with "referential integrity query ... gave unexpected result"
// instead of removing anything (reproduced live against
// credit_statement_test before this fix: even a helper with no other
// references could not be deleted). Dropping the FK keeps the historical
// helper id without enforcement, exactly as 088b did for platform_ledger.
//
// The behavioral test deletes a helper inside a scratch transaction that
// transiently drops the sibling rule-guarded FKs to users (operator-audit
// customer/operator, partner funding actor, payment-request actor — other
// Domain 8 items' scope, dropped here only inside the transaction and
// rolled back, so concurrent transactions never observe the drop). Without
// that isolation the delete would still trip the first sibling FK and the
// test could not observe this table's own fix.

jest.unmock('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('STATEMENT_TEST_DATABASE_URL');
if (database) {
  process.env.DATABASE_URL = database;
  process.env.STATEMENT_TEST_DATABASE_URL = database;
}
const describeDatabase = database ? describe : describe.skip;

jest.setTimeout(180000);

test('Domain 8 #14 test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('Domain 8 #14: helper_payment_policy_history FK drop', () => {
  let pool;
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261113184000_helper_payment_policy_history_fk_drop.sql'),
    'utf8'
  );
  const created = { users: [], historyHelperIds: [] };

  async function fkExists() {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'helper_payment_policy_history_helper_id_fkey'`
    );
    return rows.length > 0;
  }

  async function makeHelperWithHistory() {
    const helperId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', 'D8', 'Fourteen', 'helper', 'US', 'en')`,
      [helperId, `d8-14-${helperId}@example.invalid`]
    );
    created.users.push(helperId);
    await pool.query(
      `INSERT INTO helper_payment_policy_history (helper_id, changes) VALUES ($1, '[]'::jsonb)`,
      [helperId]
    );
    created.historyHelperIds.push(helperId);
    return helperId;
  }

  async function cleanupFixtures() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      if (created.historyHelperIds.length > 0) {
        await client.query(
          `DELETE FROM helper_payment_policy_history WHERE helper_id = ANY($1::uuid[])`,
          [created.historyHelperIds]
        );
        created.historyHelperIds = [];
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
  });

  afterAll(async () => {
    if (pool) {
      try {
        await cleanupFixtures();
        // Leave the schema as the migration leaves it: FK dropped.
        await pool.query(migrationSql);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Domain 8 #14 test teardown failed:', error.message);
      } finally {
        await pool.end();
      }
    }
  });

  test('the migration drops the helper_id FK', async () => {
    await pool.query(migrationSql);
    expect(await fkExists()).toBe(false);
  });

  test('deleting a helper succeeds and keeps the history row with its historical helper id', async () => {
    await pool.query(migrationSql);
    const helperId = await makeHelperWithHistory();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Isolate this table's fix from sibling broken FKs (see file header).
      await client.query(`ALTER TABLE food_customer_wallet_operator_audit_events DROP CONSTRAINT IF EXISTS food_customer_wallet_operator_audit_events_customer_id_fkey`);
      await client.query(`ALTER TABLE food_customer_wallet_operator_audit_events DROP CONSTRAINT IF EXISTS food_customer_wallet_operator_audit_event_operator_user_id_fkey`);
      await client.query(`ALTER TABLE oxsteed_credit_partner_funding_records DROP CONSTRAINT IF EXISTS oxsteed_credit_partner_funding_records_actor_user_id_fkey`);
      await client.query(`ALTER TABLE main_app_payment_request_events DROP CONSTRAINT IF EXISTS main_app_payment_request_events_actor_user_id_fkey`);
      await client.query(`DELETE FROM users WHERE id = $1`, [helperId]);
      const { rows: [user] } = await client.query(`SELECT 1 AS gone FROM users WHERE id = $1`, [helperId]);
      expect(user).toBeUndefined();
      const { rows: [history] } = await client.query(
        `SELECT helper_id FROM helper_payment_policy_history WHERE helper_id = $1`,
        [helperId]
      );
      expect(history).toBeDefined();
      expect(history.helper_id).toBe(helperId);
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    // The rollback above restored the fixture, so the helper still exists
    // for afterAll cleanup; the assertions inside the transaction proved
    // the delete succeeds and the history row is kept.
  });

  test('the append-only rules still guard the history table after the FK drop', async () => {
    await pool.query(migrationSql);
    const helperId = await makeHelperWithHistory();
    const updated = await pool.query(
      `UPDATE helper_payment_policy_history SET changes = '[{"kind":"probe"}]'::jsonb WHERE helper_id = $1`,
      [helperId]
    );
    expect(updated.rowCount).toBe(0);
    const { rows: [row] } = await pool.query(
      `SELECT changes FROM helper_payment_policy_history WHERE helper_id = $1`,
      [helperId]
    );
    expect(row.changes).toEqual([]);
  });
});
