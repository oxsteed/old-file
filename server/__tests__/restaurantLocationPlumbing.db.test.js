'use strict';

/**
 * DB tests: F-02 phase 1 store plumbing (migration 952).
 *
 * Every operational record that belongs to a physical store now carries
 * restaurant_locations.id: food_orders (online + POS + split children),
 * restaurant_pos_payments, restaurant_pos_shifts, restaurant_printer_jobs
 * and restaurant_inventory_items. Resolution order is explicit request
 * (must belong to the restaurant, else 400), then the acting device's
 * store, then the primary location. Order availability (operating hours
 * and dayparts) is evaluated against the resolved store's hours and
 * timezone, and queue numbers are allocated per store (migration 952
 * counter restructure) with the restaurant-wide counter as the
 * no-location fallback.
 *
 * Run with:
 *   RESTAURANT_LOCATION_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/st_f02 \
 *     npx jest __tests__/restaurantLocationPlumbing.db.test.js
 * Without it, the DB describes skip (fail closed) instead of touching a DB.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.RESTAURANT_LOCATION_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/st_f02';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable st_f02 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = 'location-plumbing-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');
const food = require('../controllers/foodController');
const inventory = require('../controllers/restaurantInventoryController');
const locationService = require('../services/restaurantLocationService');
const { nextQueueNumber } = require('../services/restaurantQueueCounter');

jest.setTimeout(60000);

function staffApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'staff@example.com', role: 'customer' };
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/orders', food.createOrder);
  app.post('/api/restaurants/:restaurantId/pos/shifts', appFlow.openShift);
  app.post('/api/restaurants/:restaurantId/pos/orders', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/split', appFlow.splitPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payments', appFlow.recordPosPayment);
  app.post('/api/restaurants/:restaurantId/printer-jobs', appFlow.createPrinterJob);
  app.post('/api/restaurants/:restaurantId/inventory/items', inventory.createItem);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Location', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `location-plumbing-${label}-${id}@example.invalid`]
  );
  return id;
}

async function makeRestaurant(owner, label) {
  const { rows: [biz] } = await pool.query(
    `INSERT INTO businesses (user_id, business_name, setup_status)
     VALUES ($1, $2, 'active') RETURNING id`,
    [owner, `${label} ${crypto.randomUUID().slice(0, 8)}`]
  );
  const { rows: [rest] } = await pool.query(
    `INSERT INTO food_restaurants
       (business_id, owner_user_id, display_name, status, accepts_in_store_orders,
        accepts_online_orders, fulfillment_modes, timezone)
     VALUES ($1, $2, $3, 'active', TRUE, TRUE, $4::text[], 'UTC')
     RETURNING id`,
    [biz.id, owner, label, ['pickup', 'dine_in', 'kiosk']]
  );
  return { businessId: biz.id, restaurantId: rest.id };
}

async function makeLocation(restaurantId, { name, timezone = 'UTC', hours = null, primary = false }) {
  const { rows: [loc] } = await pool.query(
    `INSERT INTO restaurant_locations (restaurant_id, name, timezone, operating_hours, is_primary, status)
     VALUES ($1, $2, $3, $4::jsonb, $5, 'active') RETURNING id`,
    [restaurantId, name, timezone, JSON.stringify(hours || {}), primary]
  );
  return Number(loc.id);
}

function nyToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

ddescribe('F-02 phase 1 location plumbing (migration 952)', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const customer = await newUser('customer');
    const manager = await newUser('manager');

    const main = await makeRestaurant(owner, 'Location Plumbing Diner');
    const empty = await makeRestaurant(owner, 'Locationless Diner');
    const counter = await makeRestaurant(owner, 'Counter Diner');

    const l1 = await makeLocation(main.restaurantId, {
      name: 'Primary Store', timezone: 'America/New_York', primary: true,
    });
    const l2 = await makeLocation(main.restaurantId, {
      name: 'Second Store', timezone: 'America/Chicago',
    });
    const l3 = await makeLocation(main.restaurantId, {
      name: 'Closed Today Store',
      timezone: 'America/New_York',
      hours: { weekly: {}, special_dates: { [nyToday()]: 'closed' } },
    });
    const counterA = await makeLocation(counter.restaurantId, {
      name: 'Counter A', timezone: 'UTC', primary: true,
    });
    const counterB = await makeLocation(counter.restaurantId, { name: 'Counter B', timezone: 'UTC' });

    const { rows: [managerUser] } = await pool.query('SELECT email FROM users WHERE id = $1', [manager]);
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
       VALUES ($1, $2, $3, $4, 'manager', 'active')`,
      [main.businessId, owner, manager, managerUser.email]
    );

    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Plumbing Burger', 1000) RETURNING id`,
      [main.restaurantId]
    );
    const { rows: [item2] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Plumbing Fries', 500) RETURNING id`,
      [main.restaurantId]
    );
    await pool.query(
      `INSERT INTO restaurant_kitchen_stations (restaurant_id, name, is_active)
       VALUES ($1, 'Grill', TRUE)`,
      [main.restaurantId]
    );
    const { rows: [device] } = await pool.query(
      `INSERT INTO restaurant_app_devices (restaurant_id, app_key, device_name, location_id, status)
       VALUES ($1, $2, 'Counter Tablet', $3, 'paired') RETURNING id`,
      [main.restaurantId, 'pos', l2]
    );

    F = {
      owner, customer, manager,
      businessId: main.businessId, restaurantId: main.restaurantId,
      emptyRestaurantId: empty.restaurantId,
      counterRestaurantId: counter.restaurantId, counterBusinessId: counter.businessId,
      l1, l2, l3, counterA, counterB,
      itemId: Number(item.id), item2Id: Number(item2.id),
      deviceId: Number(device.id),
    };
  });

  test('schema: location_id columns and FKs exist on all five record tables', async () => {
    const { rows } = await pool.query(
      `SELECT c.relname AS table_name, a.attname AS column_name,
              conf.relname AS referenced_table
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_constraint con ON con.conrelid = c.oid AND con.contype = 'f'
          AND a.attnum = ANY (con.conkey)
         JOIN pg_class conf ON conf.oid = con.confrelid
        WHERE a.attname = 'location_id'
          AND c.relname IN ('restaurant_pos_payments', 'restaurant_pos_shifts',
                            'restaurant_printer_jobs', 'restaurant_inventory_items',
                            'restaurant_daily_counters')`
    );
    const byTable = Object.fromEntries(rows.map((r) => [r.table_name, r.referenced_table]));
    for (const table of ['restaurant_pos_payments', 'restaurant_pos_shifts',
      'restaurant_printer_jobs', 'restaurant_inventory_items', 'restaurant_daily_counters']) {
      expect(byTable[table]).toBe('restaurant_locations');
    }
    const { rows: indexes } = await pool.query(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'restaurant_daily_counters'
          AND indexname IN ('uq_restaurant_daily_counters_restaurant_date',
                            'uq_restaurant_daily_counters_location_date')`
    );
    expect(indexes).toHaveLength(2);
  });

  test('resolver: primary default, explicit store, device store, cross-restaurant 400, none', async () => {
    await expect(locationService.resolveLocationId(pool, { restaurantId: F.restaurantId }))
      .resolves.toBe(F.l1);
    await expect(locationService.resolveLocationId(pool, {
      restaurantId: F.restaurantId, requestedLocationId: F.l2,
    })).resolves.toBe(F.l2);

    const deviceLoc = await locationService.deviceLocationId(pool, {
      restaurantId: F.restaurantId, deviceId: F.deviceId,
    });
    expect(deviceLoc).toBe(F.l2);
    await expect(locationService.resolveLocationId(pool, {
      restaurantId: F.restaurantId, deviceLocationId: deviceLoc,
    })).resolves.toBe(F.l2);

    await expect(locationService.resolveLocationId(pool, {
      restaurantId: F.emptyRestaurantId, requestedLocationId: F.l1,
    })).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
      fields: { locationId: 'location_restaurant_mismatch' },
    });

    await expect(locationService.resolveLocationId(pool, { restaurantId: F.emptyRestaurantId }))
      .resolves.toBeNull();
  });

  async function createOnlineOrder(userId, body = {}) {
    return request(staffApp(userId))
      .post(`/api/food/restaurants/${F.restaurantId}/orders`)
      .set('Idempotency-Key', `online-${crypto.randomUUID()}`)
      .send({
        fulfillmentType: 'pickup',
        items: [{ menuItemId: F.itemId, quantity: 1 }],
        ...body,
      });
  }

  test('online order defaults to the primary location; its kitchen printer job follows', async () => {
    const res = await createOnlineOrder(F.customer);
    expect(res.status).toBe(201);
    const orderId = res.body.order.id;
    const { rows: [order] } = await pool.query(
      'SELECT location_id FROM food_orders WHERE id = $1', [orderId]
    );
    expect(Number(order.location_id)).toBe(F.l1);
    const { rows: jobs } = await pool.query(
      'SELECT location_id FROM restaurant_printer_jobs WHERE food_order_id = $1', [orderId]
    );
    expect(jobs.length).toBeGreaterThan(0);
    expect(Number(jobs[0].location_id)).toBe(F.l1);
  });

  test('online order with an explicit second location carries it', async () => {
    const res = await createOnlineOrder(F.customer, { locationId: F.l2 });
    expect(res.status).toBe(201);
    const { rows: [order] } = await pool.query(
      'SELECT location_id FROM food_orders WHERE id = $1', [res.body.order.id]
    );
    expect(Number(order.location_id)).toBe(F.l2);
  });

  test('online order is refused at a store closed today by its own hours, open at the primary', async () => {
    const closed = await createOnlineOrder(F.customer, { locationId: F.l3 });
    expect(closed.status).toBe(409);
    const open = await createOnlineOrder(F.customer, { locationId: F.l1 });
    expect(open.status).toBe(201);
  });

  test('openShift defaults the drawer to the primary location', async () => {
    const res = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/pos/shifts`)
      .send({ openingCashCents: 10000 });
    expect(res.status).toBe(201);
    F.ownerShiftId = res.body.shift.id;
    const { rows: [shift] } = await pool.query(
      'SELECT location_id FROM restaurant_pos_shifts WHERE id = $1', [F.ownerShiftId]
    );
    expect(Number(shift.location_id)).toBe(F.l1);
  });

  test('openShift with a device pinned to the second store stamps that store', async () => {
    const res = await request(staffApp(F.manager))
      .post(`/api/restaurants/${F.restaurantId}/pos/shifts`)
      .send({ openingCashCents: 5000, deviceId: F.deviceId });
    expect(res.status).toBe(201);
    const { rows: [shift] } = await pool.query(
      'SELECT location_id FROM restaurant_pos_shifts WHERE id = $1', [res.body.shift.id]
    );
    expect(Number(shift.location_id)).toBe(F.l2);
  });

  async function createPosOrder(userId, body = {}) {
    return request(staffApp(userId))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        shiftId: F.ownerShiftId,
        items: [{ menuItemId: F.itemId, quantity: 1 }],
        ...body,
      });
  }

  test('POS order stamps the primary location by default', async () => {
    const res = await createPosOrder(F.owner);
    expect(res.status).toBe(201);
    expect(Number(res.body.order.location_id)).toBe(F.l1);
  });

  test('POS order at the second store: split child inherits, payment and printer job follow', async () => {
    const res = await createPosOrder(F.owner, {
      locationId: F.l2,
      items: [
        { menuItemId: F.itemId, quantity: 1 },
        { menuItemId: F.item2Id, quantity: 1 },
      ],
    });
    expect(res.status).toBe(201);
    const order = res.body.order;
    expect(Number(order.location_id)).toBe(F.l2);

    const { rows: orderItems } = await pool.query(
      'SELECT id, menu_item_id FROM food_order_items WHERE order_id = $1 ORDER BY id', [order.id]
    );
    const fries = orderItems.find((row) => Number(row.menu_item_id) === F.item2Id);
    const split = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/split`)
      .send({ orderItemIds: [fries.id] });
    expect(split.status).toBe(201);
    const childId = split.body.splitOrder.id;
    const { rows: [child] } = await pool.query(
      'SELECT location_id FROM food_orders WHERE id = $1', [childId]
    );
    expect(Number(child.location_id)).toBe(F.l2);

    const { rows: [parent] } = await pool.query(
      'SELECT total_cents FROM food_orders WHERE id = $1', [order.id]
    );
    const pay = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders/${order.id}/payments`)
      .set('Idempotency-Key', `pay-${crypto.randomUUID()}`)
      .send({ paymentType: 'cash', amountCents: Number(parent.total_cents), shiftId: F.ownerShiftId });
    expect(pay.status).toBe(201);
    const { rows: [payment] } = await pool.query(
      'SELECT location_id FROM restaurant_pos_payments WHERE food_order_id = $1 ORDER BY id DESC LIMIT 1',
      [order.id]
    );
    expect(Number(payment.location_id)).toBe(F.l2);

    const job = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/printer-jobs`)
      .send({ jobType: 'receipt', orderId: order.id, payload: { lines: ['receipt'] } });
    expect(job.status).toBe(201);
    expect(Number(job.body.job.location_id)).toBe(F.l2);

    const testPage = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/printer-jobs`)
      .send({ jobType: 'receipt', payload: { lines: ['test'] } });
    expect(testPage.status).toBe(201);
    expect(Number(testPage.body.job.location_id)).toBe(F.l1);
  });

  test('inventory items stamp the requested store, else the primary', async () => {
    const explicit = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/inventory/items`)
      .send({ name: 'Second Store Flour', quantity: 10, locationId: F.l2 });
    expect(explicit.status).toBe(201);
    expect(Number(explicit.body.item.location_id)).toBe(F.l2);

    const fallback = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/inventory/items`)
      .send({ name: 'Primary Store Sugar', quantity: 5 });
    expect(fallback.status).toBe(201);
    expect(Number(fallback.body.item.location_id)).toBe(F.l1);
  });

  test('queue counters: two stores run independent sequences; no-location fallback intact', async () => {
    const client = await pool.connect();
    try {
      const now = new Date();
      await expect(nextQueueNumber(client, F.counterRestaurantId, 'UTC', now, F.counterA))
        .resolves.toBe(1);
      await expect(nextQueueNumber(client, F.counterRestaurantId, 'UTC', now, F.counterA))
        .resolves.toBe(2);
      // Store B already issued a ticket numbered 7 today (direct row, as
      // a paired device would have before per-store counters existed):
      // its first counter allocation continues at 8, not 1.
      await client.query(
        `INSERT INTO food_orders (restaurant_id, business_id, queue_number, location_id, total_cents)
         VALUES ($1, $2, 7, $3, 100)`,
        [F.counterRestaurantId, F.counterBusinessId, F.counterB]
      );
      await expect(nextQueueNumber(client, F.counterRestaurantId, 'UTC', now, F.counterB))
        .resolves.toBe(8);
      await expect(nextQueueNumber(client, F.counterRestaurantId, 'UTC', now, F.counterB))
        .resolves.toBe(9);
      // Restaurant-wide fallback still works and is its own sequence.
      await expect(nextQueueNumber(client, F.counterRestaurantId, 'UTC', now))
        .resolves.toBe(1);
      await expect(nextQueueNumber(client, F.counterRestaurantId, 'UTC', now))
        .resolves.toBe(2);
    } finally {
      client.release();
    }
  });
});
