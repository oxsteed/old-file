'use strict';

// DB-backed tests for F-02 phase 2 brand tenancy (migrations 99920).
// Verifies the per-brand/per-store model replaced the one-restaurant-per-
// business index: multiple restaurants per business share the business's
// brand, brand_id is NOT NULL, brands with restaurants cannot be deleted,
// and store_code is unique per restaurant.

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Brand tenancy fixtures require the disposable statement test database');
  }
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');

const describeDb = url ? describe : describe.skip;
const TAG = 'BrandTenancyTest';

describeDb('brand tenancy (migrations 99920)', () => {
  let client;
  let ownerId;
  let businessId;
  let firstRestaurant;
  let secondRestaurant;
  let brandId;

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    ownerId = (await client.query('SELECT id FROM users LIMIT 1')).rows[0].id;
    businessId = (await client.query(
      `INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id`,
      [`${TAG} Biz`, ownerId]
    )).rows[0].id;
    const mkRestaurant = async (name) =>
      (await client.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
         VALUES ($1, $2, $3) RETURNING id, brand_id`,
        [businessId, ownerId, `${TAG} ${name}`]
      )).rows[0];
    // The BEFORE INSERT trigger assigns brand_id, so RETURNING carries it.
    firstRestaurant = await mkRestaurant('Concept One');
    secondRestaurant = await mkRestaurant('Concept Two');
    brandId = firstRestaurant.brand_id;
  }, 30000);

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await db.end();
  });

  test('two restaurants for one business share the business brand', async () => {
    expect(firstRestaurant.brand_id).toBeTruthy();
    expect(secondRestaurant.brand_id).toBe(firstRestaurant.brand_id);
    const { rows: [brand] } = await client.query(
      `SELECT id, slug, status FROM restaurant_brands WHERE id = $1`, [brandId]
    );
    expect(brand.slug).toBe(`brand-${businessId}`);
    expect(brand.status).toBe('active');
  });

  test('the one-restaurant-per-business unique index is gone', async () => {
    const { rows } = await client.query(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'food_restaurants'
          AND indexname = 'idx_food_restaurants_business_unique'`
    );
    expect(rows).toHaveLength(0);
    const { rows: [count] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM food_restaurants WHERE business_id = $1`, [businessId]
    );
    expect(count.n).toBe(2);
  });

  test('brand_id is NOT NULL on food_restaurants', async () => {
    const { rows: [col] } = await client.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'food_restaurants' AND column_name = 'brand_id'`
    );
    expect(col.is_nullable).toBe('NO');
  });

  test('a brand with restaurants cannot be deleted', async () => {
    // The expected FK failure aborts the transaction, so probe inside a
    // savepoint and roll back to it.
    await client.query('SAVEPOINT brand_delete_probe');
    await expect(
      client.query(`DELETE FROM restaurant_brands WHERE id = $1`, [brandId])
    ).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT brand_delete_probe');
    await client.query('RELEASE SAVEPOINT brand_delete_probe');
    const { rows: [brand] } = await client.query(
      `SELECT id FROM restaurant_brands WHERE id = $1`, [brandId]
    );
    expect(brand.id).toBeTruthy();
  });

  test('store_code is unique per restaurant', async () => {
    const storeA = (await client.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id LIMIT 1`,
      [firstRestaurant.id]
    )).rows[0].id;
    await client.query(`UPDATE restaurant_locations SET store_code = 'S001' WHERE id = $1`, [storeA]);
    const storeB = (await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone) VALUES ($1, $2, 'UTC') RETURNING id`,
      [firstRestaurant.id, `${TAG} Second Store`]
    )).rows[0].id;
    await client.query('SAVEPOINT store_code_probe');
    await expect(
      client.query(`UPDATE restaurant_locations SET store_code = 'S001' WHERE id = $1`, [storeB])
    ).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK TO SAVEPOINT store_code_probe');
    await client.query('RELEASE SAVEPOINT store_code_probe');
    // The same code is fine at a different restaurant (per-restaurant scope).
    const otherStore = (await client.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id LIMIT 1`,
      [secondRestaurant.id]
    )).rows[0].id;
    await client.query(`UPDATE restaurant_locations SET store_code = 'S001' WHERE id = $1`, [otherStore]);
    const { rows: [check] } = await client.query(
      `SELECT store_code FROM restaurant_locations WHERE id = $1`, [otherStore]
    );
    expect(check.store_code).toBe('S001');
  });
});
