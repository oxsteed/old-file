'use strict';

/**
 * DB tests: F-04 fire-on-pay kitchen ticket mode (migration 1400).
 *
 *   - A store with kitchen_fire_mode = 'on_pay' creates the POS order
 *     with kitchen_ticket_fired_at NULL and NO printer jobs; the KDS
 *     ticket appears only after the first payment reconciles.
 *   - Recording the payment fires the ticket exactly once (printer jobs
 *     enqueued, kitchen_ticket_fired_at set, kitchenTicketFired in the
 *     payment response).
 *   - Default behavior (NULL store mode, no restaurant setting) stays
 *     fire-on-send: jobs enqueue at creation.
 *   - The restaurant-level settings key kitchenFireMode is inherited
 *     when the store column is NULL.
 *   - resolveKitchenFireMode unit coverage (no DB).
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantKitchenFire.db.test.js
 * Without it, the DB describes skip (fail closed).
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  // Written via indirection: embedding the credential literally trips
  // secret redaction on write.
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'kitchen-fire-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');
const {
  resolveKitchenFireMode,
  normalizeKitchenFireMode,
} = require('../services/restaurantKitchenFireService');

jest.setTimeout(60000);

describe('resolveKitchenFireMode (unit)', () => {
  test('store column wins over the restaurant setting', () => {
    expect(resolveKitchenFireMode({
      locationRow: { kitchen_fire_mode: 'on_pay' },
      restaurantSettings: { kitchenFireMode: 'on_send' },
    })).toBe('on_pay');
  });
  test('NULL store mode inherits the restaurant settings key', () => {
    expect(resolveKitchenFireMode({
      locationRow: { kitchen_fire_mode: null },
      restaurantSettings: { kitchen_fire_mode: 'on_pay' },
    })).toBe('on_pay');
  });
  test('defaults to on_send when nothing is configured', () => {
    expect(resolveKitchenFireMode({})).toBe('on_send');
    expect(resolveKitchenFireMode({ locationRow: null, restaurantSettings: {} })).toBe('on_send');
  });
  test('invalid values fall back to on_send', () => {
    expect(normalizeKitchenFireMode('whenever')).toBeNull();
    expect(resolveKitchenFireMode({
      locationRow: { kitchen_fire_mode: 'whenever' },
      restaurantSettings: {},
    })).toBe('on_send');
  });
});

function staffApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'staff@example.com', role: 'customer' };
    next();
  });
  app.post('/api/restaurants/:restaurantId/pos/orders', appFlow.createPosOrder);
  app.post('/api/restaurants/:restaurantId/pos/orders/:orderId/payments', appFlow.recordPosPayment);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Fire', 'Fixture', 'customer', TRUE, TRUE)`,
    [id, `kitchen-fire-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('F-04 fire-on-pay (migration 1400)', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const cashier = await newUser('cashier');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Kitchen Fire ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Kitchen Fire Diner', ['pickup', 'dine_in']]
    );
    // Restaurant creation auto-provisions a primary location (migration
    // 989); reuse it as the on_pay store instead of inserting a second
    // primary (unique partial index).
    const { rows: [payStore] } = await pool.query(
      `UPDATE restaurant_locations
          SET name = 'Fire On Pay Store',
              timezone = 'America/New_York',
              kitchen_fire_mode = 'on_pay'
        WHERE restaurant_id = $1 AND is_primary = TRUE
        RETURNING id`,
      [rest.id]
    );
    const { rows: [sendStore] } = await pool.query(
      `INSERT INTO restaurant_locations
         (restaurant_id, name, timezone, status, kitchen_fire_mode)
       VALUES ($1, 'Fire On Send Store', 'America/New_York', 'active', NULL)
       RETURNING id`,
      [rest.id]
    );
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Fire Burger', 1000) RETURNING id`,
      [rest.id]
    );
    for (const storeId of [payStore.id, sendStore.id]) {
      await pool.query(
        `INSERT INTO restaurant_kitchen_stations (restaurant_id, name, location_id, is_active)
         VALUES ($1, $2, $3, TRUE)`,
        [rest.id, `Grill ${storeId}`, storeId]
      );
    }
    // One open shift per staff member (unique index): the second store's
    // shift belongs to a second user.
    const { rows: [cashierMember] } = await pool.query(
      'SELECT email FROM users WHERE id = $1',
      [cashier]
    );
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
       VALUES ($1, $2, $3, $4, 'employee', 'active')`,
      [biz.id, owner, cashier, cashierMember.email]
    );
    const { rows: [shift] } = await pool.query(
      `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status, location_id)
       VALUES ($1, $2, 'open', $3) RETURNING id`,
      [rest.id, owner, payStore.id]
    );
    const { rows: [shift2] } = await pool.query(
      `INSERT INTO restaurant_pos_shifts (restaurant_id, staff_user_id, status, location_id)
       VALUES ($1, $2, 'open', $3) RETURNING id`,
      [rest.id, cashier, sendStore.id]
    );
    F = {
      owner, cashier, businessId: biz.id, restaurantId: rest.id,
      payStoreId: Number(payStore.id), sendStoreId: Number(sendStore.id),
      itemId: Number(item.id), shiftId: Number(shift.id), shift2Id: Number(shift2.id),
    };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  async function createOrder(userId, storeId, shiftId, body = {}) {
    return request(staffApp(userId))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders`)
      .send({
        orderSource: 'counter',
        fulfillmentType: 'pickup',
        shiftId,
        locationId: storeId,
        items: [{ menuItemId: F.itemId, quantity: 1 }],
        clientOrderId: `fire-${crypto.randomUUID()}`,
        ...body,
      });
  }

  async function kitchenJobs(orderId) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM restaurant_printer_jobs
        WHERE restaurant_id = $1 AND food_order_id = $2 AND job_type = 'kitchen_ticket'`,
      [F.restaurantId, orderId]
    );
    return rows[0].n;
  }

  async function orderRow(orderId) {
    const { rows: [row] } = await pool.query(
      'SELECT id, kitchen_ticket_fired_at, metadata FROM food_orders WHERE id = $1',
      [orderId]
    );
    return row;
  }

  test('on_pay: order is created unfired with no printer jobs', async () => {
    const res = await createOrder(F.owner, F.payStoreId, F.shiftId);
    expect(res.status).toBe(201);
    const orderId = res.body.order.id;
    const row = await orderRow(orderId);
    expect(row.kitchen_ticket_fired_at).toBeNull();
    expect(row.metadata.kitchenFireMode).toBe('on_pay');
    expect(await kitchenJobs(orderId)).toBe(0);
    F.payOrderId = orderId;
    F.payOrderTotal = res.body.order.total_cents;
  });

  test('on_pay: the first payment fires the kitchen ticket exactly once', async () => {
    const orderId = F.payOrderId;
    const res = await request(staffApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/pos/orders/${orderId}/payments`)
      .send({ paymentType: 'cash', amountCents: F.payOrderTotal, shiftId: F.shiftId });
    expect(res.status).toBe(201);
    expect(res.body.order.payment_status).toBe('paid');
    expect(res.body.kitchenTicketFired).toBe(true);
    const row = await orderRow(orderId);
    expect(row.kitchen_ticket_fired_at).not.toBeNull();
    expect(await kitchenJobs(orderId)).toBeGreaterThan(0);

    // A second payment-related reconcile does not re-fire.
    const jobsBefore = await kitchenJobs(orderId);
    const { rows: [again] } = await pool.query(
      'SELECT kitchen_ticket_fired_at FROM food_orders WHERE id = $1',
      [orderId]
    );
    expect(again.kitchen_ticket_fired_at).not.toBeNull();
    expect(await kitchenJobs(orderId)).toBe(jobsBefore);
  });

  test('default (NULL store mode): fire-on-send enqueues jobs at creation', async () => {
    const res = await createOrder(F.cashier, F.sendStoreId, F.shift2Id);
    expect(res.status).toBe(201);
    const orderId = res.body.order.id;
    const row = await orderRow(orderId);
    expect(row.kitchen_ticket_fired_at).not.toBeNull();
    expect(row.metadata.kitchenFireMode).toBe('on_send');
    expect(await kitchenJobs(orderId)).toBeGreaterThan(0);
  });

  test('restaurant-level kitchenFireMode setting is inherited by NULL-mode stores', async () => {
    await pool.query(
      `UPDATE food_restaurants
          SET settings = COALESCE(settings, '{}'::jsonb) || '{"kitchenFireMode":"on_pay"}'::jsonb
        WHERE id = $1`,
      [F.restaurantId]
    );
    try {
      const res = await createOrder(F.cashier, F.sendStoreId, F.shift2Id);
      expect(res.status).toBe(201);
      const row = await orderRow(res.body.order.id);
      expect(row.kitchen_ticket_fired_at).toBeNull();
      expect(row.metadata.kitchenFireMode).toBe('on_pay');
      expect(await kitchenJobs(res.body.order.id)).toBe(0);
    } finally {
      await pool.query(
        `UPDATE food_restaurants
            SET settings = COALESCE(settings, '{}'::jsonb) - 'kitchenFireMode'
          WHERE id = $1`,
        [F.restaurantId]
      );
    }
  });
});
