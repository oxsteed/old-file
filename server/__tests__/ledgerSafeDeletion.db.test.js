'use strict';

// Ledger-safe deletion (recommendation track 10): the food_customer_wallet_ledger
// no-delete / no-update rules are append-only by design. A hard DELETE of a
// user or restaurant with any ledger history fails schema-wide because the
// ON DELETE CASCADE is rewritten to NOTHING and the referential-integrity
// check then fails. The ledger-safe completion is anonymization (users) and
// suspension (restaurants), never removal. These tests run against the
// disposable credit_statement_test database only, use synthetic rows, and
// never hard-delete anything in cleanup.

jest.unmock('pg');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');
const database = disposableDatabaseOptIn('STATEMENT_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ledger-safe-deletion-test-secret';
const describeDatabase = database ? describe : describe.skip;

const crypto = require('crypto');
const pool = require('../db');
const { finalizeScheduledDeletions } = require('../services/privacyRetentionService');
const { suspendRestaurantsForBusiness } = require('../services/restaurantTombstoneService');

jest.setTimeout(120000);

test('ledger-safe deletion DB tests require an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('append-only ledger delete block', () => {
  const prevFlag = process.env.FEATURE_PRIVACY_RETENTION;
  const createdUsers = [];
  const createdBusinesses = [];
  const createdRestaurants = [];

  beforeAll(() => {
    process.env.FEATURE_PRIVACY_RETENTION = 'true';
  });

  afterAll(async () => {
    // Cleanup without hard deletes: anonymize users, suspend restaurants,
    // close wallet accounts. Ledger rows stay, as the rules require.
    if (createdUsers.length) {
      await pool.query(
        `UPDATE users SET first_name = 'Deleted', last_name = 'User',
           email = 'erased-' || id::text || '@invalid.oxsteed.com',
           phone = NULL, deleted_at = COALESCE(deleted_at, NOW())
         WHERE id = ANY($1::uuid[])`,
        [createdUsers]
      ).catch(() => {});
      await pool.query(
        `UPDATE food_customer_wallet_accounts SET status = 'closed'
          WHERE customer_id = ANY($1::uuid[]) AND balance_cents = 0 AND reserved_cents = 0`,
        [createdUsers]
      ).catch(() => {});
    }
    if (createdRestaurants.length) {
      await pool.query(
        `UPDATE food_restaurants SET status = 'suspended',
           accepts_online_orders = FALSE, accepts_in_store_orders = FALSE
         WHERE id = ANY($1::bigint[])`,
        [createdRestaurants]
      ).catch(() => {});
    }
    if (prevFlag === undefined) delete process.env.FEATURE_PRIVACY_RETENTION;
    else process.env.FEATURE_PRIVACY_RETENTION = prevFlag;
    await pool.end().catch(() => {});
  });

  async function makeUser({ emailPrefix = 'ledger' } = {}) {
    const id = crypto.randomUUID();
    const email = `${emailPrefix}-${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, phone)
       VALUES ($1, $2, 'synthetic-unusable', 'Ledger', 'User', 'customer', TRUE, TRUE, '+15550000000')`,
      [id, email]
    );
    createdUsers.push(id);
    return { id, email };
  }

  async function makeBusiness(ownerId) {
    const { rows } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `ledger-biz-${Date.now()}-${Math.floor(Math.random() * 1e6)}`]
    );
    createdBusinesses.push(rows[0].id);
    return rows[0].id;
  }

  async function makeRestaurant(businessId, ownerId, status = 'active') {
    const { rows } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, 'Ledger Restaurant', $3) RETURNING id`,
      [businessId, ownerId, status]
    );
    createdRestaurants.push(rows[0].id);
    return rows[0].id;
  }

  async function makeWalletWithLedger(restaurantId, customerId, balanceAfter = 100) {
    const { rows: acct } = await pool.query(
      `INSERT INTO food_customer_wallet_accounts (restaurant_id, customer_id, balance_cents, status)
       VALUES ($1, $2, 0, 'active') RETURNING id`,
      [restaurantId, customerId]
    );
    const { rows: led } = await pool.query(
      `INSERT INTO food_customer_wallet_ledger
         (account_id, restaurant_id, customer_id, entry_type, amount_cents, balance_after_cents)
       VALUES ($1, $2, $3, 'credit', $4, $4) RETURNING id`,
      [acct[0].id, restaurantId, customerId, balanceAfter]
    );
    return { accountId: acct[0].id, ledgerId: led[0].id };
  }

  async function ledgerRow(ledgerId) {
    const { rows } = await pool.query(
      `SELECT * FROM food_customer_wallet_ledger WHERE id = $1`, [ledgerId]
    );
    return rows[0];
  }

  test('direct DELETE on a ledger row is swallowed by the rule: row remains', async () => {
    const owner = await makeUser({ emailPrefix: 'ledger-owner' });
    const businessId = await makeBusiness(owner.id);
    const restaurantId = await makeRestaurant(businessId, owner.id);
    const customer = await makeUser({ emailPrefix: 'ledger-cust' });
    const { ledgerId } = await makeWalletWithLedger(restaurantId, customer.id);

    const del = await pool.query(`DELETE FROM food_customer_wallet_ledger WHERE id = $1`, [ledgerId]);
    expect(del.rowCount).toBe(0);
    expect(await ledgerRow(ledgerId)).toBeTruthy();
  });

  test('hard DELETE of a user with ledger history fails schema-wide', async () => {
    const owner = await makeUser({ emailPrefix: 'ledger-owner' });
    const businessId = await makeBusiness(owner.id);
    const restaurantId = await makeRestaurant(businessId, owner.id);
    const customer = await makeUser({ emailPrefix: 'ledger-cust' });
    await makeWalletWithLedger(restaurantId, customer.id);

    let caught = null;
    try {
      await pool.query(`DELETE FROM users WHERE id = $1`, [customer.id]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('XX000');
    expect(caught.message).toMatch(/food_customer_wallet_ledger_customer_id_fkey/);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM users WHERE id = $1`, [customer.id]);
    expect(rows[0].n).toBe(1);
  });

  test('hard DELETE of a restaurant with ledger history fails schema-wide', async () => {
    const owner = await makeUser({ emailPrefix: 'ledger-owner' });
    const businessId = await makeBusiness(owner.id);
    const restaurantId = await makeRestaurant(businessId, owner.id);
    const customer = await makeUser({ emailPrefix: 'ledger-cust' });
    await makeWalletWithLedger(restaurantId, customer.id);

    let caught = null;
    try {
      await pool.query(`DELETE FROM food_restaurants WHERE id = $1`, [restaurantId]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeTruthy();
    expect(caught.code).toBe('XX000');
    expect(caught.message).toMatch(/food_customer_wallet_ledger_restaurant_id_fkey/);
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM food_restaurants WHERE id = $1`, [restaurantId]);
    expect(rows[0].n).toBe(1);
  });

  test('finalize anonymizes a due schedule, closes the wallet, keeps ledger bytes identical', async () => {
    const owner = await makeUser({ emailPrefix: 'ledger-owner' });
    const businessId = await makeBusiness(owner.id);
    const restaurantId = await makeRestaurant(businessId, owner.id);
    const customer = await makeUser({ emailPrefix: 'ledger-cust' });
    const { accountId, ledgerId } = await makeWalletWithLedger(restaurantId, customer.id);
    const before = await ledgerRow(ledgerId);
    expect(before).toBeTruthy();

    await pool.query(
      `UPDATE users SET is_active = FALSE, deleted_at = NOW() - INTERVAL '31 days',
         deletion_scheduled_at = NOW() - INTERVAL '1 day', deletion_type = 'admin'
       WHERE id = $1`,
      [customer.id]
    );

    const result = await finalizeScheduledDeletions(20, { userIds: [customer.id] });
    expect(result).toEqual({ finalized: 1, blocked: 0, errored: 0 });

    const { rows: users } = await pool.query(
      `SELECT first_name, last_name, email, phone, pseudonymized_at,
              deletion_scheduled_at, deletion_finalized_at, deleted_at, is_active
         FROM users WHERE id = $1`,
      [customer.id]
    );
    const u = users[0];
    expect(u.first_name).toBe('Deleted');
    expect(u.last_name).toBe('User');
    expect(u.email).toBe(`erased+${customer.id}@invalid.oxsteed.com`);
    expect(u.phone).toBeNull();
    expect(u.pseudonymized_at).toBeTruthy();
    expect(u.deletion_finalized_at).toBeTruthy();
    expect(u.deletion_scheduled_at).toBeNull();
    expect(u.deleted_at).toBeTruthy();
    expect(u.is_active).toBe(false);

    const { rows: accts } = await pool.query(
      `SELECT status FROM food_customer_wallet_accounts WHERE id = $1`, [accountId]
    );
    expect(accts[0].status).toBe('closed');

    const after = await ledgerRow(ledgerId);
    expect(after).toEqual(before);
  });

  test('finalize fails closed on a positive wallet balance: schedule intact, user untouched', async () => {
    const owner = await makeUser({ emailPrefix: 'ledger-owner' });
    const businessId = await makeBusiness(owner.id);
    const restaurantId = await makeRestaurant(businessId, owner.id);
    const customer = await makeUser({ emailPrefix: 'ledger-cust' });
    const { accountId } = await makeWalletWithLedger(restaurantId, customer.id);
    // Positive balance blocks finalize (never forfeit money to delete).
    await pool.query(
      `UPDATE food_customer_wallet_accounts SET balance_cents = 500 WHERE id = $1`, [accountId]
    );
    await pool.query(
      `UPDATE users SET is_active = FALSE, deleted_at = NOW() - INTERVAL '31 days',
         deletion_scheduled_at = NOW() - INTERVAL '1 day', deletion_type = 'admin'
       WHERE id = $1`,
      [customer.id]
    );

    const result = await finalizeScheduledDeletions(20, { userIds: [customer.id] });
    expect(result).toEqual({ finalized: 0, blocked: 1, errored: 0 });

    const { rows } = await pool.query(
      `SELECT email, deletion_scheduled_at, deletion_finalized_at FROM users WHERE id = $1`,
      [customer.id]
    );
    expect(rows[0].email).toBe(customer.email);
    expect(rows[0].deletion_scheduled_at).toBeTruthy();
    expect(rows[0].deletion_finalized_at).toBeNull();

    // Unblock the synthetic row so it finalizes and leaves no residue.
    await pool.query(
      `UPDATE food_customer_wallet_accounts SET balance_cents = 0 WHERE id = $1`, [accountId]
    );
    const again = await finalizeScheduledDeletions(20, { userIds: [customer.id] });
    expect(again.finalized).toBe(1);
  });

  test('suspendRestaurantsForBusiness suspends live restaurants, leaves drafts alone', async () => {
    const owner = await makeUser({ emailPrefix: 'ledger-owner' });
    const businessId = await makeBusiness(owner.id);
    const activeId = await makeRestaurant(businessId, owner.id, 'active');
    const pausedId = await makeRestaurant(businessId, owner.id, 'paused');
    const draftId = await makeRestaurant(businessId, owner.id, 'draft');

    const suspended = await suspendRestaurantsForBusiness(pool, businessId);
    expect(suspended.map(String).sort()).toEqual([String(activeId), String(pausedId)].sort());

    const { rows } = await pool.query(
      `SELECT id, status, accepts_online_orders, accepts_in_store_orders
         FROM food_restaurants WHERE id = ANY($1::bigint[]) ORDER BY id`,
      [[activeId, pausedId, draftId]]
    );
    const byId = Object.fromEntries(rows.map((r) => [String(r.id), r]));
    expect(byId[String(activeId)].status).toBe('suspended');
    expect(byId[String(activeId)].accepts_online_orders).toBe(false);
    expect(byId[String(activeId)].accepts_in_store_orders).toBe(false);
    expect(byId[String(pausedId)].status).toBe('suspended');
    expect(byId[String(draftId)].status).toBe('draft');
  });
});
