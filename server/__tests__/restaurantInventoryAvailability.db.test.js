'use strict';

// Explicit loopback-only disposable DB. All fixtures use connection-local
// temporary tables; no persistent application tables are modified.
jest.unmock('pg');
const { Client } = require('pg');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');
const { applyOverride } = require('../services/restaurantStoreMenuService');
const rawUrl = process.env.INVENTORY_SCOPE_TEST_DATABASE_URL;
if (rawUrl) {
  const url = new URL(rawUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/inventory_scope_test') {
    throw new Error('Inventory scope tests require a loopback inventory_scope_test database');
  }
}

(rawUrl ? describe : describe.skip)('inventory availability with two populated stores (PostgreSQL)', () => {
  let db;
  beforeAll(async () => {
    db = new Client({ connectionString: rawUrl });
    await db.connect();
    await db.query(`
      CREATE TEMP TABLE food_menu_items (
        id BIGINT PRIMARY KEY, restaurant_id BIGINT, name TEXT,
        is_available BOOLEAN, manual_available BOOLEAN, inventory_available BOOLEAN,
        inventory_availability_state TEXT, updated_at TIMESTAMPTZ);
      CREATE TEMP TABLE restaurant_inventory_items (
        id BIGINT PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, name TEXT,
        quantity NUMERIC, low_stock_threshold NUMERIC, is_active BOOLEAN);
      CREATE TEMP TABLE restaurant_inventory_item_mappings (
        restaurant_id BIGINT, menu_item_id BIGINT, inventory_item_id BIGINT,
        auto_manage BOOLEAN, required_quantity NUMERIC);
      CREATE TEMP TABLE restaurant_inventory_order_reservations (
        restaurant_id BIGINT, location_id BIGINT, inventory_item_id BIGINT,
        quantity NUMERIC, status TEXT, expires_at TIMESTAMPTZ);
      CREATE TEMP TABLE restaurant_store_menu_overrides (
        restaurant_id BIGINT, location_id BIGINT, menu_item_id BIGINT,
        is_available BOOLEAN, available_again_at TIMESTAMPTZ,
        inventory_available BOOLEAN, inventory_availability_state TEXT,
        updated_by UUID, updated_at TIMESTAMPTZ,
        PRIMARY KEY (restaurant_id, location_id, menu_item_id));
      CREATE TEMP TABLE restaurant_inventory_availability_events (
        restaurant_id BIGINT, location_id BIGINT, inventory_item_id BIGINT, menu_item_id BIGINT,
        previous_available BOOLEAN, next_available BOOLEAN, reason TEXT, created_by UUID);
      INSERT INTO food_menu_items VALUES (41,3,'Burger',TRUE,TRUE,TRUE,'available',NOW());
      INSERT INTO restaurant_inventory_items VALUES
        (17,3,101,'Store A buns',0,0,TRUE), (18,3,202,'Store B buns',10,0,TRUE);
      INSERT INTO restaurant_inventory_item_mappings VALUES (3,41,17,TRUE,1), (3,41,18,TRUE,1);
    `);
  });
  afterAll(async () => { if (db) await db.end(); });

  async function availabilityAt(locationId) {
    const { rows: [item] } = await db.query(`SELECT fmi.*,
      COALESCE((SELECT to_jsonb(sm) FROM restaurant_store_menu_overrides sm
        WHERE sm.restaurant_id=fmi.restaurant_id AND sm.menu_item_id=fmi.id
          AND sm.location_id=$1), '{}'::jsonb) AS store_override
      FROM food_menu_items fmi WHERE id=41`, [locationId]);
    return applyOverride(item).is_available;
  }

  test('sell-out, restock, and holds affect only their store and repeated sync adds no events', async () => {
    await syncMappedMenuAvailability(db, 3, { locationId: 101 });
    await syncMappedMenuAvailability(db, 3, { locationId: 202 });
    expect(await availabilityAt(101)).toBe(false);
    expect(await availabilityAt(202)).toBe(true);
    expect((await db.query('SELECT is_available FROM food_menu_items')).rows[0].is_available).toBe(true);
    expect((await syncMappedMenuAvailability(db, 3, { locationId: 101 })).changes).toHaveLength(0);
    expect((await db.query('SELECT * FROM restaurant_inventory_availability_events')).rows).toHaveLength(1);

    await db.query('UPDATE restaurant_inventory_items SET quantity=10 WHERE id=17');
    await syncMappedMenuAvailability(db, 3, { inventoryItemId: 17, locationId: 101 });
    expect(await availabilityAt(101)).toBe(true);
    await db.query(`INSERT INTO restaurant_inventory_order_reservations
      VALUES (3,101,17,10,'reserved',NOW()+INTERVAL '10 minutes')`);
    await syncMappedMenuAvailability(db, 3, { locationId: 101 });
    expect(await availabilityAt(101)).toBe(false);
    expect(await availabilityAt(202)).toBe(true);
    const { rows } = await db.query('SELECT DISTINCT location_id FROM restaurant_inventory_availability_events');
    expect(rows.map((row) => Number(row.location_id))).toEqual([101]);
  });
});
