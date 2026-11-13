'use strict';

// Domain 8 #16: food_customer_wallet_operator_audit_events is append-only
// (migration 348 installs DO INSTEAD NOTHING rules on UPDATE/DELETE), so
// its four ON DELETE SET NULL FKs (business_id, wallet_account_id,
// customer_id, operator_user_id) can never be honored. Postgres detects
// the rule-rewritten nulling UPDATE and the parent delete fails outright
// with "referential integrity query ... gave unexpected result" instead of
// removing anything (reproduced live against credit_statement_test before
// this fix: even a user with no audit rows at all could not be deleted,
// because the RI probe fires on every parent delete). Dropping the four
// FKs keeps the historical ids without enforcement, exactly as 91426 did
// for the wallet ledger. The restaurant_id FK is NOT dropped: migration
// 624 converted it to RESTRICT, which fails closed with 23503 as designed.
//
// The user-delete behavioral test runs inside a scratch transaction that
// transiently drops the sibling rule-guarded FKs to users (helper-history
// helper_id, partner funding actor, payment-request actor — other Domain 8
// items' scope, dropped here only inside the transaction and rolled back,
// so concurrent transactions never observe the drop). Without that
// isolation the delete would still trip the first sibling FK and the test
// could not observe this table's own fix. The wallet-account delete needs
// no isolation: it is not a user delete.

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

test('Domain 8 #16 test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('Domain 8 #16: food_customer_wallet_operator_audit_events FK drop', () => {
  let pool;
  const migrationSql = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '20261113184100_food_customer_wallet_operator_audit_fk_drop.sql'),
    'utf8'
  );
  const SET_NULL_FKS = [
    'food_customer_wallet_operator_audit_events_business_id_fkey',
    'food_customer_wallet_operator_audit_even_wallet_account_id_fkey',
    'food_customer_wallet_operator_audit_events_customer_id_fkey',
    'food_customer_wallet_operator_audit_event_operator_user_id_fkey',
  ];
  const created = { users: [], businesses: [], restaurants: [], walletAccounts: [], auditIds: [] };

  async function fkExists(conname) {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1`,
      [conname]
    );
    return rows.length > 0;
  }

  async function makeUser(emailPrefix) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, preferred_language)
       VALUES ($1, $2, 'synthetic-unusable', 'D8', 'Sixteen', 'customer', 'US', 'en')`,
      [id, `d8-16-${emailPrefix}-${id}@example.invalid`]
    );
    created.users.push(id);
    return id;
  }

  async function makeFixture() {
    const owner = await makeUser('owner');
    const customer = await makeUser('customer');
    const operator = await makeUser('operator');
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, 'D8-16 test business') RETURNING id`,
      [owner]
    );
    created.businesses.push(business.id);
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'D8-16 test restaurant') RETURNING id`,
      [business.id, owner]
    );
    created.restaurants.push(restaurant.id);
    const { rows: [account] } = await pool.query(
      `INSERT INTO food_customer_wallet_accounts (restaurant_id, customer_id, currency_code) VALUES ($1, $2, 'USD') RETURNING id`,
      [restaurant.id, customer]
    );
    created.walletAccounts.push(account.id);
    const { rows: [audit] } = await pool.query(
      `INSERT INTO food_customer_wallet_operator_audit_events (restaurant_id, business_id, wallet_account_id, customer_id, operator_user_id, action_type)
       VALUES ($1, $2, $3, $4, $5, 'd8_16_probe') RETURNING id`,
      [restaurant.id, business.id, account.id, customer, operator]
    );
    created.auditIds.push(audit.id);
    return { owner, customer, operator, businessId: business.id, restaurantId: restaurant.id, accountId: account.id, auditId: audit.id };
  }

  async function auditRow(auditId) {
    const { rows } = await pool.query(
      `SELECT restaurant_id, business_id, wallet_account_id, customer_id, operator_user_id
         FROM food_customer_wallet_operator_audit_events WHERE id = $1`,
      [auditId]
    );
    return rows[0];
  }

  async function cleanupFixtures() {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL session_replication_role = replica');
      if (created.auditIds.length > 0) {
        await client.query(`DELETE FROM food_customer_wallet_operator_audit_events WHERE id = ANY($1::bigint[])`, [created.auditIds]);
        created.auditIds = [];
      }
      if (created.walletAccounts.length > 0) {
        await client.query(`DELETE FROM food_customer_wallet_accounts WHERE id = ANY($1::bigint[])`, [created.walletAccounts]);
        created.walletAccounts = [];
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
  });

  afterAll(async () => {
    if (pool) {
      try {
        await cleanupFixtures();
        // Leave the schema as the migration leaves it: the four SET NULL
        // FKs dropped, the restaurant_id RESTRICT FK kept.
        await pool.query(migrationSql);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Domain 8 #16 test teardown failed:', error.message);
      } finally {
        await pool.end();
      }
    }
  });

  test('the migration drops the four SET NULL FKs and keeps the restaurant_id RESTRICT FK', async () => {
    await pool.query(migrationSql);
    for (const conname of SET_NULL_FKS) {
      expect(await fkExists(conname)).toBe(false);
    }
    expect(await fkExists('food_customer_wallet_operator_audit_events_restaurant_id_fkey')).toBe(true);
    const { rows: [def] } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'food_customer_wallet_operator_audit_events_restaurant_id_fkey'`
    );
    expect(def.def).toContain('ON DELETE RESTRICT');
  });

  test('deleting a wallet account succeeds and the audit row keeps its historical wallet_account_id', async () => {
    await pool.query(migrationSql);
    const fixture = await makeFixture();
    await pool.query(`DELETE FROM food_customer_wallet_accounts WHERE id = $1`, [fixture.accountId]);
    const { rows } = await pool.query(
      `SELECT 1 AS gone FROM food_customer_wallet_accounts WHERE id = $1`,
      [fixture.accountId]
    );
    expect(rows.length).toBe(0);
    const row = await auditRow(fixture.auditId);
    expect(row).toBeDefined();
    expect(row.wallet_account_id).toBe(String(fixture.accountId));
  });

  test('deleting the customer and operator users succeeds and the audit row keeps their historical ids', async () => {
    await pool.query(migrationSql);
    const fixture = await makeFixture();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Isolate this table's fix from sibling broken FKs (see file header).
      await client.query(`ALTER TABLE helper_payment_policy_history DROP CONSTRAINT IF EXISTS helper_payment_policy_history_helper_id_fkey`);
      await client.query(`ALTER TABLE oxsteed_credit_partner_funding_records DROP CONSTRAINT IF EXISTS oxsteed_credit_partner_funding_records_actor_user_id_fkey`);
      await client.query(`ALTER TABLE main_app_payment_request_events DROP CONSTRAINT IF EXISTS main_app_payment_request_events_actor_user_id_fkey`);
      await client.query(`DELETE FROM users WHERE id = $1`, [fixture.customer]);
      await client.query(`DELETE FROM users WHERE id = $1`, [fixture.operator]);
      const { rows: gone } = await client.query(
        `SELECT id FROM users WHERE id = ANY($1::uuid[])`,
        [[fixture.customer, fixture.operator]]
      );
      expect(gone.length).toBe(0);
      const { rows: [row] } = await client.query(
        `SELECT customer_id, operator_user_id FROM food_customer_wallet_operator_audit_events WHERE id = $1`,
        [fixture.auditId]
      );
      expect(row).toBeDefined();
      expect(row.customer_id).toBe(fixture.customer);
      expect(row.operator_user_id).toBe(fixture.operator);
      await client.query('ROLLBACK');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    // The rollback above restored the fixture users, so they still exist
    // for afterAll cleanup; the assertions inside the transaction proved
    // the deletes succeed and the audit row keeps the historical ids.
    // (No business-delete check: deleting the business is blocked by the
    // restaurant_id RESTRICT FK through the restaurant regardless of this
    // fix, which is the intended fail-closed behavior.)
  });

  test('the append-only rules still guard the audit table after the FK drop', async () => {
    await pool.query(migrationSql);
    const fixture = await makeFixture();
    const updated = await pool.query(
      `UPDATE food_customer_wallet_operator_audit_events SET action_type = 'd8_16_probe_mutated' WHERE id = $1`,
      [fixture.auditId]
    );
    expect(updated.rowCount).toBe(0);
    const row = await auditRow(fixture.auditId);
    expect(row).toBeDefined();
  });
});
