'use strict';

// DB-backed tests for F-08 offline cash replay (migrations 99923/99924).
// Everything runs inside one rolled-back transaction against the real
// migrated schema. Money-safety properties under test:
//   - replay is idempotent (no double orders/payments on retry),
//   - a sale whose shift closed before replay is HELD, never posted,
//   - totals are recomputed and must match,
//   - duplicate uploads collapse onto the same queue row.

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Hub replay fixtures require the disposable statement test database');
  }
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const hub = require('../services/storeHubService');

const describeDb = url ? describe : describe.skip;
const TAG = 'HubReplayTest';

describeDb('store hub offline replay (migrations 99923/99924)', () => {
  let client;
  let ownerId;
  let restaurantId;
  let storeId;
  let hubId;
  let shiftId;
  let menuItemId;

  const mkSale = (n, overrides = {}) => ({
    hubSaleUuid: `123e4567-e89b-12d3-a456-426614174${String(n).padStart(3, '0')}`,
    idempotencyKey: `${TAG}-sale-${n}`,
    shiftId,
    items: [{ menuItemId, quantity: 1, unitPriceCents: 1000, name: `${TAG} Item` }],
    subtotalCents: 1000,
    taxCents: 80,
    tipCents: 0,
    discountCents: 0,
    totalCents: 1080,
    cashTenderedCents: 1100,
    ...overrides,
  });

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    ownerId = (await client.query('SELECT id FROM users LIMIT 1')).rows[0].id;
    const businessId = (await client.query(
      `INSERT INTO businesses (business_name, user_id) VALUES ($1, $2) RETURNING id`,
      [`${TAG} Biz`, ownerId]
    )).rows[0].id;
    restaurantId = (await client.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, status, accepts_in_store_orders)
       VALUES ($1, $2, $3, 'active', TRUE) RETURNING id`,
      [businessId, ownerId, `${TAG} Diner`]
    )).rows[0].id;
    await client.query(`UPDATE food_restaurants SET screens_v2_enabled = TRUE WHERE id = $1`, [restaurantId]);
    storeId = (await client.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id LIMIT 1`, [restaurantId]
    )).rows[0].id;
    menuItemId = (await client.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents) VALUES ($1, $2, 1000) RETURNING id`,
      [restaurantId, `${TAG} Item`]
    )).rows[0].id;
    shiftId = (await client.query(
      `INSERT INTO restaurant_pos_shifts (restaurant_id, location_id, drawer_name) VALUES ($1, $2, 'Drawer 1') RETURNING id`,
      [restaurantId, storeId]
    )).rows[0].id;
    const registered = await hub.registerHub(client, {
      restaurantId, locationId: storeId, name: `${TAG} Hub`, actorUserId: ownerId,
    });
    hubId = registered.id;
  }, 30000);

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
    }
    await db.end();
  });

  test('queue accepts sales and collapses duplicate uploads', async () => {
    const first = await hub.queueOfflineSales(client, { restaurantId, hubId, sales: [mkSale(1), mkSale(2)] });
    expect(first.queued).toHaveLength(2);
    expect(first.queued.every((q) => q.status === 'queued' && !q.duplicate)).toBe(true);
    const retry = await hub.queueOfflineSales(client, { restaurantId, hubId, sales: [mkSale(1)] });
    expect(retry.queued).toHaveLength(1);
    expect(retry.queued[0].duplicate).toBe(true);
    expect(retry.queued[0].id).toBe(first.queued[0].id);
    const { rows: [count] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM store_hub_offline_sales WHERE hub_id = $1`, [hubId]
    );
    expect(count.n).toBe(2);
  });

  test('replay posts orders and cash payments exactly once', async () => {
    const result = await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId });
    expect(result.processed).toBe(2);
    expect(result.results.every((r) => r.status === 'replayed')).toBe(true);

    const { rows: orders } = await client.query(
      `SELECT id, payment_status, total_cents, client_order_id, location_id
         FROM food_orders WHERE restaurant_id = $1 AND client_order_id LIKE 'hub:%'`,
      [restaurantId]
    );
    expect(orders).toHaveLength(2);
    expect(orders.every((o) => o.payment_status === 'paid' && Number(o.total_cents) === 1080)).toBe(true);

    const { rows: payments } = await client.query(
      `SELECT id, payment_type, amount_cents, shift_id FROM restaurant_pos_payments
        WHERE restaurant_id = $1 AND food_order_id = ANY($2::bigint[])`,
      [restaurantId, orders.map((o) => o.id)]
    );
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.payment_type === 'cash' && Number(p.amount_cents) === 1080 && Number(p.shift_id) === Number(shiftId))).toBe(true);

    // A receipt job is queued for the in-store print agent; nothing dialed.
    const { rows: [jobs] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_printer_jobs
        WHERE restaurant_id = $1 AND job_type = 'receipt' AND food_order_id = ANY($2::bigint[])`,
      [restaurantId, orders.map((o) => o.id)]
    );
    expect(jobs.n).toBe(2);
  });

  test('replay is idempotent: second run processes nothing', async () => {
    const result = await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId });
    expect(result.processed).toBe(0);
    const { rows: [count] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM food_orders WHERE restaurant_id = $1 AND client_order_id LIKE 'hub:%'`,
      [restaurantId]
    );
    expect(count.n).toBe(2);
  });

  test('a sale whose shift closed before replay is held, never posted', async () => {
    await hub.queueOfflineSales(client, { restaurantId, hubId, sales: [mkSale(3)] });
    await client.query(`UPDATE restaurant_pos_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1`, [shiftId]);
    const result = await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId });
    expect(result.processed).toBe(1);
    expect(result.results[0].status).toBe('held');
    const { rows: [sale] } = await client.query(
      `SELECT status, food_order_id FROM store_hub_offline_sales WHERE hub_id = $1 AND idempotency_key = $2`,
      [hubId, `${TAG}-sale-3`]
    );
    expect(sale.status).toBe('held');
    expect(sale.food_order_id).toBeNull();
    const { rows: [count] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM food_orders WHERE restaurant_id = $1 AND client_order_id LIKE 'hub:%'`,
      [restaurantId]
    );
    expect(count.n).toBe(2);
    // Reopen the shift for the remaining tests.
    await client.query(`UPDATE restaurant_pos_shifts SET status = 'open', closed_at = NULL WHERE id = $1`, [shiftId]);
  });

  test('a sale for another store is rejected at queue time', async () => {
    const otherStore = (await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone) VALUES ($1, $2, 'UTC') RETURNING id`,
      [restaurantId, `${TAG} Other Store`]
    )).rows[0].id;
    const otherShift = (await client.query(
      `INSERT INTO restaurant_pos_shifts (restaurant_id, location_id) VALUES ($1, $2) RETURNING id`,
      [restaurantId, otherStore]
    )).rows[0].id;
    await expect(hub.queueOfflineSales(client, {
      restaurantId, hubId, sales: [mkSale(4, { shiftId: otherShift })],
    })).rejects.toMatchObject({ code: 'shift_not_found' });
  });

  test('hub pull returns only this store revision events', async () => {
    await client.query(`SELECT restaurant_screen_record_change($1, $2, 'store_menu', '42')`, [restaurantId, storeId]);
    const pulled = await hub.pullChanges(client, { restaurantId, hubId, sinceRevision: 0, limit: 50 });
    expect(pulled.locationId).toBe(Number(storeId));
    expect(pulled.events.length).toBeGreaterThan(0);
    expect(pulled.latestRevision).toBeGreaterThanOrEqual(pulled.events[pulled.events.length - 1].revision);
  });

  test('replay decrements inventory and audits usage', async () => {
    const itemId = (await client.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents) VALUES ($1, $2, 500) RETURNING id`,
      [restaurantId, `${TAG} Stocked Item`]
    )).rows[0].id;
    const invId = (await client.query(
      `INSERT INTO restaurant_inventory_items (restaurant_id, location_id, name, quantity) VALUES ($1, $2, $3, 10) RETURNING id`,
      [restaurantId, storeId, `${TAG} Flour`]
    )).rows[0].id;
    await client.query(
      `INSERT INTO restaurant_inventory_item_mappings
         (restaurant_id, inventory_item_id, menu_item_id, usage_label, required_quantity)
       VALUES ($1, $2, $3, 'test', 2)`,
      [restaurantId, invId, itemId]
    );
    await hub.queueOfflineSales(client, {
      restaurantId, hubId,
      sales: [mkSale(20, {
        items: [{ menuItemId: itemId, quantity: 1, unitPriceCents: 500, name: `${TAG} Stocked Item` }],
        subtotalCents: 500, totalCents: 580, taxCents: 80, cashTenderedCents: 600,
      })],
    });
    const result = await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId });
    const mine = result.results.find((r) => r.status === 'replayed' && r.inventoryShortfall == null);
    expect(mine).toBeTruthy();
    const { rows: [item] } = await client.query(
      `SELECT quantity FROM restaurant_inventory_items WHERE id = $1`, [invId]
    );
    expect(Number(item.quantity)).toBe(8);
    const { rows: [adj] } = await client.query(
      `SELECT adjustment_type, quantity_delta, source_type FROM restaurant_inventory_adjustments
        WHERE restaurant_id = $1 AND item_id = $2 ORDER BY id DESC LIMIT 1`,
      [restaurantId, invId]
    );
    expect(adj.adjustment_type).toBe('usage');
    expect(Number(adj.quantity_delta)).toBe(-2);
    expect(adj.source_type).toBe('food_order');
  });

  test('inventory shortfall still posts money and flags the sale', async () => {
    const itemId = (await client.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents) VALUES ($1, $2, 700) RETURNING id`,
      [restaurantId, `${TAG} Scarce Item`]
    )).rows[0].id;
    const invId = (await client.query(
      `INSERT INTO restaurant_inventory_items (restaurant_id, location_id, name, quantity) VALUES ($1, $2, $3, 1) RETURNING id`,
      [restaurantId, storeId, `${TAG} Truffle`]
    )).rows[0].id;
    await client.query(
      `INSERT INTO restaurant_inventory_item_mappings
         (restaurant_id, inventory_item_id, menu_item_id, usage_label, required_quantity)
       VALUES ($1, $2, $3, 'test', 5)`,
      [restaurantId, invId, itemId]
    );
    await hub.queueOfflineSales(client, {
      restaurantId, hubId,
      sales: [mkSale(21, {
        items: [{ menuItemId: itemId, quantity: 1, unitPriceCents: 700, name: `${TAG} Scarce Item` }],
        subtotalCents: 700, totalCents: 756, taxCents: 56, cashTenderedCents: 800,
      })],
    });
    const result = await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId });
    const mine = result.results.find((r) => r.inventoryShortfall);
    expect(mine).toBeTruthy();
    expect(mine.status).toBe('replayed');
    // Money posted: the order and cash payment exist.
    const { rows: [order] } = await client.query(
      `SELECT id, payment_status FROM food_orders WHERE id = $1`, [mine.orderId]
    );
    expect(order.payment_status).toBe('paid');
    const { rows: [payment] } = await client.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_pos_payments WHERE food_order_id = $1 AND payment_type = 'cash'`,
      [mine.orderId]
    );
    expect(payment.n).toBe(1);
    // Stock untouched (never driven negative) and the shortfall flagged.
    const { rows: [item] } = await client.query(
      `SELECT quantity FROM restaurant_inventory_items WHERE id = $1`, [invId]
    );
    expect(Number(item.quantity)).toBe(1);
    const { rows: [sale] } = await client.query(
      `SELECT status, replay_metadata FROM store_hub_offline_sales WHERE id = $1`, [mine.saleId]
    );
    expect(sale.status).toBe('replayed');
    expect(sale.replay_metadata.inventory_shortfall).toMatch(/unavailable/i);
  });

  test('a held sale can be requeued and then replayed', async () => {
    await client.query(`UPDATE restaurant_pos_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1`, [shiftId]);
    await hub.queueOfflineSales(client, { restaurantId, hubId, sales: [mkSale(22)] });
    const held = (await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId })).results[0];
    expect(held.status).toBe('held');
    const resolved = await hub.resolveOfflineSale(client, {
      restaurantId, hubId, saleId: held.saleId, action: 'requeue',
    });
    expect(resolved.status).toBe('queued');
    expect(resolved.action).toBe('requeue');
    await client.query(`UPDATE restaurant_pos_shifts SET status = 'open', closed_at = NULL WHERE id = $1`, [shiftId]);
    const replayed = await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId });
    const mine = replayed.results.find((r) => r.saleId === held.saleId);
    expect(mine.status).toBe('replayed');
    expect(mine.orderId).toBeTruthy();
  });

  test('a held sale can be voided with a manager note', async () => {
    await client.query(`UPDATE restaurant_pos_shifts SET status = 'closed', closed_at = NOW() WHERE id = $1`, [shiftId]);
    await hub.queueOfflineSales(client, { restaurantId, hubId, sales: [mkSale(23)] });
    const held = (await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId })).results[0];
    expect(held.status).toBe('held');
    const resolved = await hub.resolveOfflineSale(client, {
      restaurantId, hubId, saleId: held.saleId, action: 'void', note: 'counted in drawer close',
    });
    expect(resolved.status).toBe('voided');
    await client.query(`UPDATE restaurant_pos_shifts SET status = 'open', closed_at = NULL WHERE id = $1`, [shiftId]);
    const replayed = await hub.replaySales(client, { restaurantId, hubId, actorUserId: ownerId });
    expect(replayed.processed).toBe(0);
    const { rows: [sale] } = await client.query(
      `SELECT status, food_order_id, replay_error FROM store_hub_offline_sales WHERE id = $1`,
      [held.saleId]
    );
    expect(sale.status).toBe('voided');
    expect(sale.food_order_id).toBeNull();
    expect(sale.replay_error).toMatch(/counted in drawer close/);
  });

  test('resolve rejects sales that already replayed', async () => {
    const { rows: [sale] } = await client.query(
      `SELECT id FROM store_hub_offline_sales WHERE hub_id = $1 AND status = 'replayed' LIMIT 1`,
      [hubId]
    );
    await expect(hub.resolveOfflineSale(client, {
      restaurantId, hubId, saleId: sale.id, action: 'void',
    })).rejects.toMatchObject({ code: 'sale_not_resolvable' });
    await expect(hub.resolveOfflineSale(client, {
      restaurantId, hubId, saleId: sale.id, action: 'bogus',
    })).rejects.toMatchObject({ code: 'validation_failed' });
  });
});
