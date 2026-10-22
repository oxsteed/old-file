'use strict';

// F-33: automatic prep-time extension under load.
// Migration 99919 columns (prep_time_auto_extend_max_min / _threshold_orders /
// _per_order_min) are read by restaurantPrepTimeService and wired into the
// quote's estimatedReadyMinutes and the order's promised time.

const request = require('supertest');
const express = require('express');

const targetDb = process.env.STATEMENT_TEST_DATABASE_URL || '';
const usingDisposableDb = /credit_statement_test/.test(targetDb);

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const OWNER_ID = '11111111-2222-3333-4444-555555555555';
let currentRestaurant = null;

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');

describe('F-33 auto prep-time extension', () => {
  let pool;
  let app;
  let prep;
  const F = {};

  beforeAll(async () => {
    expect(usingDisposableDb).toBe(true);
    process.env.DATABASE_URL = targetDb;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    pool = require('../db');
    require('../controllers/foodController');
    prep = require('../services/restaurantPrepTimeService');
    const { errorHandler } = require('../middleware/errorHandler');

    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, 'f33@example.com', 'x', 'F33', 'Test', 'customer', TRUE, TRUE)
       ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email`,
      [OWNER_ID]
    );
    const { rows: [biz] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, 'F33 biz') RETURNING id`,
      [OWNER_ID]
    );
    F.businessId = biz.id;
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, is_accepting_orders_now)
       VALUES ($1, $2, 'F33 Rest', TRUE) RETURNING id`,
      [F.businessId, OWNER_ID]
    );
    F.restaurantId = rest.id;
    currentRestaurant = {
      id: rest.id,
      business_id: F.businessId,
      display_name: 'F33 Rest',
      timezone: 'UTC',
      currency_code: 'USD',
      settings: {},
      effective_role: 'owner',
      effective_membership_id: null,
      prep_time_min: 15,
      prep_time_extension_min: 0,
    };
    const { rows: [loc] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, status)
       VALUES ($1, 'Main', 'active') RETURNING id`,
      [F.restaurantId]
    );
    F.locationId = loc.id;
    resolveRestaurantAccess.mockImplementation(async () => currentRestaurant);

    // Mount the foodController location endpoints directly (the /api/food
    // router's `authenticate` middleware is session-based; the controller
    // itself only needs req.user + the mocked scopeModel).
    const foodController = require('../controllers/foodController');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.user = { id: OWNER_ID }; next(); });
    app.patch(
      '/api/food/restaurants/:restaurantId/locations/:locationId',
      (req, res, next) => foodController.updateRestaurantLocation(req, res, next)
    );
    app.use(errorHandler);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  let queueSeq = 1000;
  async function addOrders(count, { status = 'preparing', locationId = F.locationId, scheduledFor = null } = {}) {
    for (let i = 0; i < count; i += 1) {
      queueSeq += 1;
      await pool.query(
        `INSERT INTO food_orders (restaurant_id, business_id, location_id, status, scheduled_for, queue_number)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [F.restaurantId, F.businessId, locationId, status, scheduledFor, queueSeq]
      );
    }
  }

  async function setAutoExtend(maxMin, thresholdOrders, perOrderMin) {
    const resp = await request(app)
      .patch(`/api/food/restaurants/${F.restaurantId}/locations/${F.locationId}`)
      .send({
        prepTimeAutoExtendMaxMin: maxMin,
        prepTimeAutoExtendThresholdOrders: thresholdOrders,
        prepTimeAutoExtendPerOrderMin: perOrderMin,
      });
    expect(resp.status).toBe(200);
    return resp.body.location;
  }

  test('extension is 0 when the store has not opted in', async () => {
    await addOrders(12);
    const got = await prep.computeAutoPrepExtensionMinutes(pool, {
      restaurantId: F.restaurantId,
      locationId: F.locationId,
    });
    expect(got).toMatchObject({ extensionMin: 0, enabled: false, openTickets: 0 });
  });

  test('extension grows with open tickets and is capped by the max', async () => {
    await setAutoExtend(30, 5, 2);
    let got = await prep.computeAutoPrepExtensionMinutes(pool, {
      restaurantId: F.restaurantId,
      locationId: F.locationId,
    });
    // 12 open tickets: (12 - 5) * 2 = 14
    expect(got.extensionMin).toBe(14);
    expect(got.enabled).toBe(true);
    expect(got.openTickets).toBe(12);

    await addOrders(20);
    got = await prep.computeAutoPrepExtensionMinutes(pool, {
      restaurantId: F.restaurantId,
      locationId: F.locationId,
    });
    // (32 - 5) * 2 = 54 -> capped at 30
    expect(got.extensionMin).toBe(30);
  });

  test('completed, cancelled and not-yet-due scheduled orders do not count', async () => {
    await addOrders(10, { status: 'completed' });
    await addOrders(10, { status: 'cancelled' });
    const future = new Date(Date.now() + 3600_000);
    await addOrders(10, { scheduledFor: future });
    const got = await prep.computeAutoPrepExtensionMinutes(pool, {
      restaurantId: F.restaurantId,
      locationId: F.locationId,
    });
    // still 32 active tickets from the previous test
    expect(got.openTickets).toBe(32);
    expect(got.extensionMin).toBe(30);
  });

  test('other stores are not counted toward this store', async () => {
    const { rows: [loc2] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, status)
       VALUES ($1, 'Second', 'active') RETURNING id`,
      [F.restaurantId]
    );
    await addOrders(50, { locationId: loc2.id });
    const got = await prep.computeAutoPrepExtensionMinutes(pool, {
      restaurantId: F.restaurantId,
      locationId: F.locationId,
    });
    expect(got.openTickets).toBe(32);
  });

  test('the location PATCH validates the auto-extend bounds', async () => {
    const bad = await request(app)
      .patch(`/api/food/restaurants/${F.restaurantId}/locations/${F.locationId}`)
      .send({ prepTimeAutoExtendMaxMin: 241 });
    expect(bad.status).toBe(400);
  });

  test('extension is 0 when below the threshold', async () => {
    await pool.query('DELETE FROM food_orders WHERE restaurant_id = $1', [F.restaurantId]);
    await addOrders(4);
    const got = await prep.computeAutoPrepExtensionMinutes(pool, {
      restaurantId: F.restaurantId,
      locationId: F.locationId,
    });
    expect(got).toMatchObject({ extensionMin: 0, openTickets: 4, enabled: true });
  });
});
