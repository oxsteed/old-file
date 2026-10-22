'use strict';

// DB-backed tests for F-02 phase 2 brand menu publishing (migrations 99920/99921).
// Runs against the real migrated schema of the disposable statement test
// database (never CI's default suite without STATEMENT_TEST_DATABASE_URL).
// Everything runs inside one rolled-back transaction, so no fixture rows
// survive (restaurant deletes are blocked schema-wide by the wallet ledger
// append-only rule).

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Brand publish fixtures require the disposable statement test database');
  }
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const brand = require('../services/restaurantBrandService');

const describeDb = url ? describe : describe.skip;
const TAG = 'BrandPubTest';

describeDb('brand menu publishing (migrations 99920/99921)', () => {
  let client;
  let ownerId;
  let sourceRestaurant; let targetRestaurant; let outsiderRestaurant;
  let brandId;
  let sourceItemIds = [];
  let targetStoreIds = [];

  const publish = (request) => brand.publishBrandMenu(client, request);

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    ownerId = (await client.query('SELECT id FROM users LIMIT 1')).rows[0].id;
    const mkBusiness = async (name) =>
      (await client.query(`INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id`, [`${TAG} ${name}`, ownerId])).rows[0].id;
    const businessA = await mkBusiness('Biz A');
    const businessB = await mkBusiness('Biz B');
    const businessC = await mkBusiness('Biz C');
    const mkRestaurant = async (businessId, name) =>
      (await client.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, $3) RETURNING id, brand_id`,
        [businessId, ownerId, `${TAG} ${name}`]
      )).rows[0];
    const src = await mkRestaurant(businessA, 'Source Diner');
    const tgt = await mkRestaurant(businessC, 'Target Diner');
    const out = await mkRestaurant(businessB, 'Outsider Diner');
    // The auto-brand trigger runs BEFORE INSERT (migration 99920), so
    // RETURNING carries brand_id; re-read anyway to stay robust.
    const brandOf = async (id) =>
      (await client.query('SELECT brand_id FROM food_restaurants WHERE id = $1', [id])).rows[0].brand_id;
    sourceRestaurant = src.id;
    targetRestaurant = tgt.id;
    outsiderRestaurant = out.id;
    // Merge source + target into one brand (each business got its own brand).
    brandId = await brandOf(sourceRestaurant);
    await client.query('UPDATE food_restaurants SET brand_id = $1 WHERE id = $2', [brandId, targetRestaurant]);
    // The default-store trigger gave each restaurant one store; add a second
    // store to the target restaurant for multi-store fan-out.
    targetStoreIds = (await client.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id`, [targetRestaurant]
    )).rows.map((r) => r.id);
    const extra = (await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone) VALUES ($1, $2, 'UTC') RETURNING id`,
      [targetRestaurant, `${TAG} Second Store`]
    )).rows[0].id;
    targetStoreIds.push(extra);
    // Source menu: one category, two published items.
    const categoryId = (await client.query(
      `INSERT INTO food_menu_categories (restaurant_id, name) VALUES ($1, $2) RETURNING id`,
      [sourceRestaurant, `${TAG} Mains`]
    )).rows[0].id;
    for (const [name, price] of [['Burger', 1299], ['Fries', 499]]) {
      const item = (await client.query(
        `INSERT INTO food_menu_items (restaurant_id, category_id, name, price_cents)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [sourceRestaurant, categoryId, `${TAG} ${name}`, price]
      )).rows[0];
      sourceItemIds.push(item.id);
    }
  }, 30000);

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await db.end();
  });

  test('brand linkage: every restaurant belongs to exactly one brand', async () => {
    const { rows: [row] } = await client.query(
      `SELECT COUNT(*)::int AS total, COUNT(brand_id)::int AS linked FROM food_restaurants`
    );
    expect(row.total).toBeGreaterThan(0);
    expect(row.linked).toBe(row.total);
  });

  test('publish fans out per item per store and links target copies', async () => {
    const result = await publish({
      brandId,
      sourceRestaurantId: sourceRestaurant,
      targetRestaurantIds: [targetRestaurant],
      idempotencyKey: `${TAG}-key-1`,
      actorUserId: ownerId,
    });
    expect(result.synced).toBe(sourceItemIds.length * targetStoreIds.length);
    expect(result.failed).toBe(0);
    expect(result.idempotentReplay).toBe(false);

    // One target copy per source item, linked back to the source.
    const { rows: copies } = await client.query(
      `SELECT id, brand_source_item_id, name, price_cents
         FROM food_menu_items
        WHERE restaurant_id = $1 AND brand_source_item_id IS NOT NULL`,
      [targetRestaurant]
    );
    expect(copies).toHaveLength(sourceItemIds.length);
    expect(new Set(copies.map((c) => Number(c.brand_source_item_id)))).toEqual(new Set(sourceItemIds.map(Number)));

    // One publication row per (item, store), all synced.
    const { rows: pubs } = await client.query(
      `SELECT status, COUNT(*)::int AS n FROM brand_menu_publications
        WHERE batch_id = $1 GROUP BY status`,
      [result.batchId]
    );
    expect(pubs).toEqual([{ status: 'synced', n: sourceItemIds.length * targetStoreIds.length }]);

    // Per-store overrides exist for every target copy at every target store.
    const { rows: [ov] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_store_menu_overrides WHERE restaurant_id = $1`,
      [targetRestaurant]
    );
    expect(ov.n).toBe(sourceItemIds.length * targetStoreIds.length);
  });

  test('replayed idempotency key returns the stored result without duplicating', async () => {
    const before = await client.query(
      `SELECT COUNT(*)::int AS n FROM food_menu_items WHERE restaurant_id = $1 AND brand_source_item_id IS NOT NULL`,
      [targetRestaurant]
    );
    const result = await publish({
      brandId,
      sourceRestaurantId: sourceRestaurant,
      targetRestaurantIds: [targetRestaurant],
      idempotencyKey: `${TAG}-key-1`,
      actorUserId: ownerId,
    });
    expect(result.idempotentReplay).toBe(true);
    expect(result.synced).toBe(sourceItemIds.length * targetStoreIds.length);
    const after = await client.query(
      `SELECT COUNT(*)::int AS n FROM food_menu_items WHERE restaurant_id = $1 AND brand_source_item_id IS NOT NULL`,
      [targetRestaurant]
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  test('re-publish with a new key updates copies instead of duplicating them', async () => {
    const result = await publish({
      brandId,
      sourceRestaurantId: sourceRestaurant,
      sourceMenuItemIds: [sourceItemIds[0]],
      targetRestaurantIds: [targetRestaurant],
      priceCents: 999,
      isAvailable: false,
      idempotencyKey: `${TAG}-key-2`,
      actorUserId: ownerId,
    });
    expect(result.synced).toBe(targetStoreIds.length);
    const { rows: copies } = await client.query(
      `SELECT id, price_cents FROM food_menu_items
        WHERE restaurant_id = $1 AND brand_source_item_id = $2`,
      [targetRestaurant, sourceItemIds[0]]
    );
    expect(copies).toHaveLength(1);
    expect(copies[0].price_cents).toBe(999);
    const { rows: overrides } = await client.query(
      `SELECT DISTINCT is_available FROM restaurant_store_menu_overrides
        WHERE restaurant_id = $1 AND menu_item_id = $2`,
      [targetRestaurant, copies[0].id]
    );
    expect(overrides).toEqual([{ is_available: false }]);
  });

  test('cross-brand publish is rejected', async () => {
    await expect(publish({
      brandId,
      sourceRestaurantId: sourceRestaurant,
      targetRestaurantIds: [outsiderRestaurant],
      idempotencyKey: `${TAG}-key-3`,
      actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'brand_tenancy_violation' });
  });

  test('publishing from a foreign source brand is rejected', async () => {
    await expect(publish({
      brandId,
      sourceRestaurantId: outsiderRestaurant,
      targetRestaurantIds: [targetRestaurant],
      idempotencyKey: `${TAG}-key-4`,
      actorUserId: ownerId,
    })).rejects.toMatchObject({ code: 'brand_tenancy_violation' });
  });
});
