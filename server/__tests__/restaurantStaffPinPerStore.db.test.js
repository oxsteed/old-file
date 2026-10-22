'use strict';

/**
 * Tests: F-21 per-store staff PIN uniqueness (migration 99916).
 *
 *   - A PIN value may be reused across stores but never twice within the
 *     same store (409 pin_already_in_use on a same-store clash).
 *   - Re-setting the same person's PIN at the same store is not a clash.
 *   - Validation prefers the exact store row, then falls back to a legacy
 *     restaurant-wide (NULL location) PIN; with no store context only
 *     restaurant-wide PINs validate (fail closed).
 *   - A store-scoped PIN does not validate at another store.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantStaffPinPerStore.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'staff-pin-store-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');
const { validateStaffPinForRestaurant } = require('../services/restaurantStaffIdentityService');

jest.setTimeout(60000);

function pinApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: userId, email: 'owner@example.com', role: 'customer' };
    next();
  });
  app.post('/api/restaurants/:restaurantId/pos/staff-pins', appFlow.setStaffPin);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Pin', 'Store', 'customer', TRUE, TRUE)`,
    [id, `pin-store-${label}-${id}@example.invalid`]
  );
  return id;
}

ddescribe('F-21 per-store staff PIN uniqueness', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Pin Store ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [biz.id, owner, 'Pin Store Diner']
    );
    const { rows: [storeA] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, status)
       VALUES ($1, 'Store A', 'active') RETURNING id`,
      [rest.id]
    );
    const { rows: [storeB] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, status)
       VALUES ($1, 'Store B', 'active') RETURNING id`,
      [rest.id]
    );
    F = { owner, businessId: biz.id, restaurantId: rest.id, storeA: storeA.id, storeB: storeB.id };
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('a PIN value is reusable across stores but not twice in one store', async () => {
    const app = pinApp(F.owner);
    const first = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '1111', staffLabel: 'Cashier A', locationId: F.storeA });
    expect(first.status).toBe(201);
    expect(Number(first.body.staffPin.location_id)).toBe(Number(F.storeA));

    // Same value at the other store: allowed (different label).
    const second = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '1111', staffLabel: 'Cashier B', locationId: F.storeB });
    expect(second.status).toBe(201);

    // Same value, same store, different person: refused.
    const clash = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '1111', staffLabel: 'Cashier C', locationId: F.storeA });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('pin_already_in_use');

    // Re-setting the same person's PIN at the same store is not a clash.
    const reset = await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '1111', staffLabel: 'Cashier A', locationId: F.storeA });
    expect(reset.status).toBe(201);
  });

  test('a store id outside the restaurant fails closed', async () => {
    const res = await request(pinApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '2222', staffLabel: 'Cashier X', locationId: 987654321 });
    expect(res.status).toBe(404);
  });

  test('validation prefers the store row, then the restaurant-wide PIN', async () => {
    const app = pinApp(F.owner);
    // Store-scoped PINs sharing one value across stores.
    await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '3333', staffLabel: 'Cashier A', locationId: F.storeA })
      .expect(201);
    await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '3333', staffLabel: 'Cashier B', locationId: F.storeB })
      .expect(201);
    // Legacy restaurant-wide PIN.
    await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '4444', staffLabel: 'Floater' })
      .expect(201);

    const atA = await validateStaffPinForRestaurant({
      restaurantId: F.restaurantId, pin: '3333', locationId: F.storeA,
    });
    expect(atA.pinRow.staff_label).toBe('Cashier A');

    const atB = await validateStaffPinForRestaurant({
      restaurantId: F.restaurantId, pin: '3333', locationId: F.storeB,
    });
    expect(atB.pinRow.staff_label).toBe('Cashier B');

    // No store context: only the restaurant-wide PIN validates.
    await expect(validateStaffPinForRestaurant({
      restaurantId: F.restaurantId, pin: '3333', locationId: null,
    })).rejects.toMatchObject({ code: 'invalid_pin' });
    const floater = await validateStaffPinForRestaurant({
      restaurantId: F.restaurantId, pin: '4444', locationId: null,
    });
    expect(floater.pinRow.staff_label).toBe('Floater');

    // The restaurant-wide PIN also works when a store is named (fallback).
    const floaterAtA = await validateStaffPinForRestaurant({
      restaurantId: F.restaurantId, pin: '4444', locationId: F.storeA,
    });
    expect(floaterAtA.pinRow.staff_label).toBe('Floater');
  });

  test('an exact store row beats a restaurant-wide row with the same value', async () => {
    const app = pinApp(F.owner);
    await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '5555', staffLabel: 'Store A Lead', locationId: F.storeA })
      .expect(201);
    await request(app)
      .post(`/api/restaurants/${F.restaurantId}/pos/staff-pins`)
      .send({ pin: '5555', staffLabel: 'Roving Manager' })
      .expect(201);

    const atA = await validateStaffPinForRestaurant({
      restaurantId: F.restaurantId, pin: '5555', locationId: F.storeA,
    });
    expect(atA.pinRow.staff_label).toBe('Store A Lead');

    const atB = await validateStaffPinForRestaurant({
      restaurantId: F.restaurantId, pin: '5555', locationId: F.storeB,
    });
    expect(atB.pinRow.staff_label).toBe('Roving Manager');
  });
});
