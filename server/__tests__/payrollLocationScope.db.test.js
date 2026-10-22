'use strict';

/**
 * Payroll location scoping against the real migrated schema (auth-audit
 * finding 22).
 *
 * Verifies the cash-tip path end to end: declareCashTip stamps location_id
 * (migration 1100), and getDeclaredCashTips excludes unattributable
 * (NULL-location) rows for location-scoped viewers while unscoped viewers
 * still see the whole restaurant.
 *
 * Runs against the disposable credit_statement_test database; skipped
 * without STATEMENT_TEST_DATABASE_URL.
 */

const crypto = require('crypto');

const { disposableDatabaseOptIn, isDisposableDatabase } = require('./helpers/statementTestDatabase');
const RAW_URL = disposableDatabaseOptIn('PAYROLL_SCOPE_TEST_DATABASE_URL');
const CAN_RUN_DB = isDisposableDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}
jest.unmock('pg');
jest.unmock('../db');

const pool = require('../db');
const payroll = require('../services/restaurantPayrollService');

const tag = crypto.randomBytes(4).toString('hex');
let userA; let userB; let businessId; let restaurantId; let loc1; let loc2;

async function newUser(email) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Scope', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, email]
  );
  return id;
}

ddescribe('finding 22: declared cash tips are store-attributed', () => {
  beforeAll(async () => {
    userA = await newUser(`scope-staff-${tag}@example.invalid`);
    userB = await newUser(`scope-declarer-${tag}@example.invalid`);
    ({ rows: [{ id: businessId }] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [userB, `Scope Diner ${tag}`]
    ));
    ({ rows: [{ id: restaurantId }] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [businessId, userB, `Scope Diner ${tag}`]
    ));
    // A trigger (restaurant_default_store_created) auto-creates the
    // primary location on restaurant insert; adopt it as Store A.
    ({ rows: [{ id: loc1 }] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE`,
      [restaurantId]
    ));
    await pool.query(`UPDATE restaurant_locations SET name = 'Store A' WHERE id = $1`, [loc1]);
    ({ rows: [{ id: loc2 }] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Store B') RETURNING id`,
      [restaurantId]
    ));
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM restaurant_declared_cash_tips WHERE restaurant_id = $1`, [restaurantId]);
    await pool.query(`DELETE FROM restaurant_locations WHERE restaurant_id = $1`, [restaurantId]);
    // NOTE: food_restaurants / businesses / users rows cannot be deleted:
    // the food_customer_wallet_ledger append-only rewrite rule rejects
    // deletes schema-wide (known open issue). Fixtures are uniquely tagged
    // per run and harmless in the disposable database.
    await pool.end();
  });

  test('declareCashTip stamps the store', async () => {
    const row = await payroll.declareCashTip(restaurantId, {
      staffUserId: userA,
      businessDate: '2026-10-20',
      amountCents: 500,
      declaredBy: userB,
      locationId: loc1,
    });
    expect(Number(row.location_id)).toBe(Number(loc1));
  });

  test('scoped viewers see only their store; NULL-location rows are excluded', async () => {
    await payroll.declareCashTip(restaurantId, {
      staffUserId: userA, businessDate: '2026-10-20', amountCents: 300, declaredBy: userB, locationId: loc2,
    });
    await payroll.declareCashTip(restaurantId, {
      staffUserId: userA, businessDate: '2026-10-20', amountCents: 200, declaredBy: userB,
    });

    const scoped = await payroll.getDeclaredCashTips(restaurantId, '2026-10-20', '2026-10-20', {
      mode: 'assigned', location_ids: [loc1], assignments: [],
    });
    expect(scoped).toHaveLength(1);
    expect(Number(scoped[0].tips_cents)).toBe(500);

    const scopedB = await payroll.getDeclaredCashTips(restaurantId, '2026-10-20', '2026-10-20', {
      mode: 'assigned', location_ids: [loc2], assignments: [],
    });
    expect(scopedB).toHaveLength(1);
    expect(Number(scopedB[0].tips_cents)).toBe(300);

    // Unscoped viewers keep the whole-restaurant view (back-compat).
    const all = await payroll.getDeclaredCashTips(restaurantId, '2026-10-20', '2026-10-20', null);
    const total = all.reduce((sum, r) => sum + Number(r.tips_cents), 0);
    expect(total).toBe(1000);
  });
});
