'use strict';

// Explicit loopback-only disposable DB. All fixtures use connection-local
// temporary tables; no persistent application tables are modified.
jest.unmock('pg');
// Controller reads must use this test connection, never the app's default pool.
jest.mock('../db', () => ({ query: (...args) => require('./setup').mockQuery(...args) }));
const { Client } = require('pg');
const { mockQuery } = require('./setup');
jest.mock('../services/scopeModel', () => ({ resolveRestaurantAccess: jest.fn(async () => ({
  id: 3, business_id: 42, effective_role: 'manager', effective_membership_id: 8, timezone: 'America/New_York',
})) }));
jest.mock('../services/permissionsService', () => ({
  getEffectivePermissions: jest.fn(async () => ({ permissions: new Set(['inventory.view']) })),
  hasAny: (grants, codes) => codes.some((code) => grants.has(code)),
}));
jest.mock('../services/restaurantLocationAccessService', () => ({
  getLocationScope: jest.fn(async () => ({ mode: 'assigned', location_ids: [101] })),
  assertLocationAccess: jest.fn(async () => {}),
}));
const operations = require('../controllers/restaurantInventoryOperationsController');
const { reserveInventoryForOrder, releaseInventoryForOrder, consumeInventoryForOrder } = require('../services/restaurantInventoryOrderService');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');
const inventory = require('../controllers/restaurantInventoryController');
const { menuSnapshot } = require('../services/restaurantDeliveryMarketplaceService');
const { logInventoryAudit } = require('../services/restaurantInventoryAuditService');
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
  });
  beforeEach(async () => {
    await db.query('DISCARD TEMP');
    await db.query(`
      CREATE TEMP TABLE food_menu_items (
        id BIGINT PRIMARY KEY, restaurant_id BIGINT, name TEXT,
        is_available BOOLEAN, manual_available BOOLEAN, inventory_available BOOLEAN,
        inventory_availability_state TEXT, updated_at TIMESTAMPTZ,
        category_id BIGINT DEFAULT 1, description TEXT, price_cents INTEGER DEFAULT 1000, currency_code TEXT DEFAULT 'USD',
        sort_order INTEGER DEFAULT 0, tags TEXT[], publication_status TEXT DEFAULT 'published', archived_at TIMESTAMPTZ);
      CREATE TEMP TABLE restaurant_inventory_items (
        id BIGINT PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, name TEXT,
        quantity NUMERIC, low_stock_threshold NUMERIC, is_active BOOLEAN,
        unit TEXT, category TEXT, unit_cost NUMERIC, par_level NUMERIC, reorder_point NUMERIC, critical_level NUMERIC,
        last_counted_at TIMESTAMPTZ, storage_area_id BIGINT, updated_at TIMESTAMPTZ);
      CREATE TEMP TABLE restaurant_inventory_item_mappings (
        restaurant_id BIGINT, menu_item_id BIGINT, inventory_item_id BIGINT,
        id BIGSERIAL, created_at TIMESTAMPTZ DEFAULT NOW(),
        auto_manage BOOLEAN, required_quantity NUMERIC, conversion_factor NUMERIC DEFAULT 1, yield_percent NUMERIC DEFAULT 100);
      CREATE TEMP TABLE restaurant_inventory_order_reservations (
        id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, location_id BIGINT, inventory_item_id BIGINT,
        food_order_id BIGINT, food_order_item_id BIGINT, menu_item_id BIGINT,
        quantity NUMERIC(12,3), status TEXT DEFAULT 'reserved', expires_at TIMESTAMPTZ, released_at TIMESTAMPTZ, consumed_at TIMESTAMPTZ);
      CREATE TEMP TABLE restaurant_store_menu_overrides (
        restaurant_id BIGINT, location_id BIGINT, menu_item_id BIGINT,
        price_cents INTEGER,
        is_available BOOLEAN, available_again_at TIMESTAMPTZ,
        inventory_available BOOLEAN, inventory_availability_state TEXT,
        updated_by UUID, updated_at TIMESTAMPTZ,
        PRIMARY KEY (restaurant_id, location_id, menu_item_id));
      CREATE TEMP TABLE restaurant_inventory_availability_events (
        restaurant_id BIGINT, location_id BIGINT, inventory_item_id BIGINT, menu_item_id BIGINT,
        previous_available BOOLEAN, next_available BOOLEAN, reason TEXT, created_by UUID, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TEMP TABLE restaurant_locations (id BIGINT, restaurant_id BIGINT, name TEXT, address_city TEXT, address_state TEXT, status TEXT, is_primary BOOLEAN, UNIQUE(restaurant_id,id));
      CREATE TEMP TABLE restaurant_inventory_adjustments (restaurant_id BIGINT, location_id BIGINT, item_id BIGINT, item_name TEXT, adjustment_type TEXT, quantity_delta NUMERIC, source_type TEXT, source_id BIGINT, created_at TIMESTAMPTZ, quantity_after NUMERIC, note TEXT, adjusted_by UUID);
      CREATE TEMP TABLE restaurant_inventory_receipts (id BIGINT, restaurant_id BIGINT, location_id BIGINT, supplier_name TEXT, received_at TIMESTAMPTZ);
      CREATE TEMP TABLE restaurant_inventory_receipt_lines (id BIGINT, receipt_id BIGINT, restaurant_id BIGINT, received_quantity NUMERIC, accepted_quantity NUMERIC, expected_quantity NUMERIC);
      CREATE TEMP TABLE restaurant_inventory_purchase_requests (id BIGSERIAL, restaurant_id BIGINT, location_id BIGINT, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), requested_by UUID);
      CREATE TEMP TABLE restaurant_inventory_supplier_issues (id BIGSERIAL, restaurant_id BIGINT, location_id BIGINT, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), reported_by UUID);
      CREATE TEMP TABLE restaurant_inventory_storage_areas (id BIGINT, restaurant_id BIGINT, name TEXT);
      CREATE TEMP TABLE users (id UUID, first_name TEXT, last_name TEXT, email TEXT);
      CREATE TEMP TABLE restaurant_inventory_transfers (id BIGINT, restaurant_id BIGINT, location_id BIGINT);
      CREATE TEMP TABLE restaurant_inventory_supplier_catalog (id BIGINT, restaurant_id BIGINT, inventory_item_id BIGINT);
      CREATE TEMP TABLE restaurant_inventory_audit_events (id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT, business_id BIGINT,
        event_type TEXT, entity_type TEXT, entity_id BIGINT, actor_user_id UUID, client_operation_id UUID,
        metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TEMP TABLE food_menu_categories (id BIGINT, restaurant_id BIGINT, name TEXT, sort_order INTEGER, is_active BOOLEAN);
      INSERT INTO food_menu_categories VALUES (1,3,'Mains',0,TRUE);
      CREATE TEMP TABLE food_orders (id BIGINT, restaurant_id BIGINT, location_id BIGINT,
        total_cents BIGINT, created_at TIMESTAMPTZ, payment_status TEXT, status TEXT);
      CREATE TEMP TABLE food_order_items (order_id BIGINT, menu_item_id BIGINT, quantity NUMERIC);
      INSERT INTO food_menu_items (id,restaurant_id,name,is_available,manual_available,inventory_available,inventory_availability_state,updated_at) VALUES (41,3,'Burger',TRUE,TRUE,TRUE,'available',NOW());
      INSERT INTO restaurant_inventory_items (id, restaurant_id, location_id, name, quantity, low_stock_threshold, is_active) VALUES
        (17,3,101,'Store A buns',0,0,TRUE), (18,3,202,'Store B buns',10,0,TRUE);
      INSERT INTO restaurant_inventory_item_mappings (restaurant_id, menu_item_id, inventory_item_id, auto_manage, required_quantity) VALUES (3,41,17,TRUE,1), (3,41,18,TRUE,1);
    `);
    let pending = Promise.resolve();
    mockQuery.mockImplementation((sql, params) => {
      const result = pending.then(() => db.query(sql, params));
      pending = result.catch(() => {});
      return result;
    });
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
    await db.query(`INSERT INTO restaurant_inventory_order_reservations (restaurant_id, location_id, inventory_item_id, quantity, status, expires_at)
      VALUES (3,101,17,10,'reserved',NOW()+INTERVAL '10 minutes')`);
    await syncMappedMenuAvailability(db, 3, { locationId: 101 });
    expect(await availabilityAt(101)).toBe(false);
    expect(await availabilityAt(202)).toBe(true);
    const { rows } = await db.query('SELECT DISTINCT location_id FROM restaurant_inventory_availability_events');
    expect(rows.map((row) => Number(row.location_id))).toEqual([101]);
  });

  test('recipe conversion and yield drive both availability and the order stock hold', async () => {
    await db.query('UPDATE restaurant_inventory_item_mappings SET conversion_factor=2, yield_percent=50 WHERE inventory_item_id=17');
    await db.query('UPDATE restaurant_inventory_items SET quantity=3 WHERE id=17');
    await syncMappedMenuAvailability(db, 3, { locationId: 101 });
    expect(await availabilityAt(101)).toBe(false); // 1 * 2 / 50% = 4 stock units
    await expect(reserveInventoryForOrder(db, { restaurantId: 3, orderId: 7, locationId: 101,
      orderItems: [{ id: 8, menuItemId: 41, quantity: 1 }] })).rejects.toMatchObject({ code: 'inventory_unavailable' });
    await db.query('UPDATE restaurant_inventory_items SET quantity=8 WHERE id=17');
    await reserveInventoryForOrder(db, { restaurantId: 3, orderId: 7, locationId: 101,
      orderItems: [{ id: 8, menuItemId: 41, quantity: 2 }] });
    expect((await db.query('SELECT quantity FROM restaurant_inventory_order_reservations')).rows[0].quantity).toBe('8.000');
    expect(await availabilityAt(101)).toBe(false);
    expect(await availabilityAt(202)).toBe(true);
    await releaseInventoryForOrder(db, { restaurantId: 3, orderId: 7, locationId: 101 });
    expect(await availabilityAt(101)).toBe(true);
  });

  test('reports use local days across midnight/DST and exclude sibling store activity', async () => {
    // Place both days within the current seven-day report window while retaining
    // the crucial UTC-midnight/local-previous-day boundary.
    await db.query(`INSERT INTO restaurant_inventory_adjustments (restaurant_id,location_id,item_id,item_name,adjustment_type,quantity_delta,source_type,source_id,created_at)
      SELECT 3,101,17,'Buns','waste',-2,NULL,NULL,
        ((NOW() AT TIME ZONE 'America/New_York')::date::timestamp AT TIME ZONE 'UTC') + INTERVAL '2 hours';
      INSERT INTO restaurant_inventory_adjustments (restaurant_id,location_id,item_id,item_name,adjustment_type,quantity_delta,source_type,source_id,created_at)
      SELECT 3,202,18,'Buns','waste',-99,NULL,NULL,NOW();`);
    let result;
    await operations.getReports({ params: { restaurantId: 3 }, user: { id: 'staff' } },
      { json: (value) => { result = value; } }, (error) => { throw error; });
    expect(result.waste.daily).toHaveLength(1);
    expect(result.waste.daily[0].quantity).toBe('2');
    const expected = await db.query(`SELECT (((NOW() AT TIME ZONE 'America/New_York')::date - 1)::text) AS day`);
    expect(result.waste.daily[0].day.toLocaleDateString('en-CA')).toBe(expected.rows[0].day);
    const dst = await db.query(`SELECT EXTRACT(EPOCH FROM (
      ('2026-03-09'::timestamp AT TIME ZONE 'America/New_York') -
      ('2026-03-08'::timestamp AT TIME ZONE 'America/New_York'))) / 3600 AS hours`);
    expect(Number(dst.rows[0].hours)).toBe(23);
    await operations.getDashboard({ params: { restaurantId: 3 }, user: { id: 'staff' } },
      { json: (value) => { result = value; } }, (error) => { throw error; });
    expect(result.risk.out_of_stock).toBe(1);
  });

  test('food cost includes the local day after UTC midnight and never charges a sibling store recipe', async () => {
    await db.query(`UPDATE restaurant_inventory_items SET unit_cost=1;
      INSERT INTO food_orders VALUES
        (7,3,101,1000,'2026-03-09T03:30:00Z','paid','completed'),
        (8,3,202,99000,'2026-03-09T03:30:00Z','paid','completed');
      INSERT INTO food_order_items VALUES (7,41,2),(8,41,99);
      INSERT INTO restaurant_inventory_adjustments VALUES
        (3,101,17,'Buns','usage',-2,NULL,NULL,'2026-03-09T03:30:00Z'),
        (3,202,18,'Buns','usage',-99,NULL,NULL,'2026-03-09T03:30:00Z');`);
    let result;
    await operations.foodCostSummary({ params: { restaurantId: 3 }, user: { id: 'staff' },
      query: { from: '2026-03-08', to: '2026-03-08' } },
    { json: (value) => { result = value; } }, (error) => { throw error; });
    expect(result.rows).toHaveLength(1);
    expect(Number(result.rows[0].theoretical_quantity)).toBe(2);
    expect(Number(result.rows[0].actual_quantity)).toBe(2);
    expect(result.totals.net_sales).toBe(10);
  });

  test('assigned-store procurement pagination executes with the correct parameter positions', async () => {
    await db.query(`INSERT INTO restaurant_inventory_purchase_requests (restaurant_id,location_id) VALUES (3,202),(3,101),(3,101);
      INSERT INTO restaurant_inventory_supplier_issues (restaurant_id,location_id) VALUES (3,202),(3,101),(3,101);`);
    for (const [handler, field] of [[inventory.listPurchaseRequests, 'requests'], [inventory.listSupplierIssues, 'issues']]) {
      let result;
      await handler({ params: { restaurantId: 3 }, user: { id: 'staff' }, query: { limit: '1', offset: '1' } },
        { json: (value) => { result = value; } }, (error) => { throw error; });
      expect(result[field]).toHaveLength(1);
      expect(Number(result[field][0].location_id)).toBe(101);
    }
  });

  test('deleted-item adjustments remain visible only to their recorded store', async () => {
    await db.query(`INSERT INTO restaurant_inventory_adjustments (restaurant_id,location_id,item_id,created_at)
      VALUES (3,101,999,NOW()),(3,202,999,NOW());`);
    let result;
    await inventory.listAdjustments({ params: { restaurantId: 3 }, user: { id: 'staff' }, query: {} },
      { json: (value) => { result = value; } }, (error) => { throw error; });
    expect(result.adjustments).toHaveLength(1);
    expect(Number(result.adjustments[0].location_id)).toBe(101);
  });

  test('active stock holds drive dashboard risks while expired holds and sibling stores are excluded', async () => {
    await db.query(`UPDATE restaurant_inventory_items SET quantity=10, reorder_point=2;
      INSERT INTO restaurant_inventory_order_reservations (restaurant_id,location_id,inventory_item_id,quantity,status,expires_at)
      VALUES (3,101,17,9,'reserved',NOW()+INTERVAL '10 minutes'),
             (3,101,17,100,'reserved',NOW()-INTERVAL '1 minute');`);
    let result;
    await operations.getDashboard({ params: { restaurantId: 3 }, user: { id: 'staff' } },
      { json: (value) => { result = value; } }, (error) => { throw error; });
    expect(result.risk.low_stock).toBe(1);
    expect(result.risk.out_of_stock).toBe(0);
    expect(Number(result.priorities[0].available_quantity)).toBe(1);
    expect(result.menu_impacts).toHaveLength(1);
  });

  test('shared ingredient consumption rejects aggregate overdraw before writing, then consumes the exact available amount', async () => {
    await db.query(`UPDATE restaurant_inventory_items SET quantity=5 WHERE id=17;
      INSERT INTO restaurant_inventory_order_reservations (restaurant_id,location_id,inventory_item_id,food_order_id,quantity)
      VALUES (3,101,17,7,3),(3,101,17,7,3);`);
    await expect(consumeInventoryForOrder(db, { restaurantId: 3, orderId: 7, locationId: 101 })).rejects.toMatchObject({ code: 'inventory_consistency_conflict' });
    expect(Number((await db.query('SELECT quantity FROM restaurant_inventory_items WHERE id=17')).rows[0].quantity)).toBe(5);
    expect((await db.query('SELECT * FROM restaurant_inventory_adjustments')).rows).toHaveLength(0);
    await db.query('UPDATE restaurant_inventory_items SET quantity=6 WHERE id=17');
    expect(await consumeInventoryForOrder(db, { restaurantId: 3, orderId: 7, locationId: 101 })).toEqual({ consumed: 2 });
    expect(Number((await db.query('SELECT quantity FROM restaurant_inventory_items WHERE id=17')).rows[0].quantity)).toBe(0);
  });

  test('marketplace menus exclude drafts, archived items and unavailable items', async () => {
    await db.query(`INSERT INTO food_menu_items (id,restaurant_id,name,is_available,publication_status,archived_at)
      VALUES (42,3,'Draft',TRUE,'draft',NULL),(43,3,'Archived',TRUE,'published',NOW()),(44,3,'Sold out',FALSE,'published',NULL);`);
    expect((await menuSnapshot(db, 3))[0].items.map((item) => item.id)).toEqual([41]);
  });

  test('audit location backfill and new snapshots preserve store isolation after entity deletion', async () => {
    await db.query(`INSERT INTO restaurant_locations (id,restaurant_id) VALUES (101,3),(202,3),(303,4);
      INSERT INTO restaurant_inventory_audit_events (restaurant_id,event_type,entity_type,entity_id)
      VALUES (3,'before','item',17),(3,'before','item',18),(3,'unknown','item',999);`);
    const migration = require('fs').readFileSync(require('path').join(__dirname, '../migrations/992_restaurant_inventory_audit_locations.sql'), 'utf8');
    await db.query(migration);
    await db.query(migration); // schema/backfill replay remains safe
    await logInventoryAudit(db, { restaurantId: 3, eventType: 'snapshot', entityType: 'item', entityId: 17 });
    await db.query('DELETE FROM restaurant_inventory_items WHERE id=17');
    await logInventoryAudit(db, { restaurantId: 3, eventType: 'deleted', entityType: 'item', entityId: 17, locationId: 101 });
    let result;
    await operations.listAuditEvents({ params: { restaurantId: 3 }, user: { id: 'staff' }, query: {} },
      { json: (value) => { result = value; } }, (error) => { throw error; });
    expect(result.events).toHaveLength(3);
    expect(result.events.every((event) => Number(event.location_id) === 101)).toBe(true);
    expect((await db.query('SELECT * FROM restaurant_inventory_audit_events')).rows).toHaveLength(5);
    await expect(logInventoryAudit(db, { restaurantId: 3, eventType: 'foreign', entityType: 'item', locationId: 303 }))
      .rejects.toMatchObject({ code: '23503' });
  });
});
