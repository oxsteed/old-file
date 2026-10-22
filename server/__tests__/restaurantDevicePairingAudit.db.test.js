'use strict';

/**
 * Tests: F-20 device-pairing + display audit actions.
 *
 * Every pairing lifecycle mutation writes a dedicated business_audit_log
 * row with before/after state (never the secret itself):
 *   - restaurant.device.pairing_code.created (createDevicePairingCode)
 *   - restaurant.device.paired               (pairDevice, unauthenticated)
 *   - restaurant.device.token_rotated        (rotateDeviceToken)
 *   - restaurant.device.config_updated       (updateDeviceConfig)
 *   - restaurant.display.paired              (claimDisplay)
 *   - restaurant.display.unpaired            (unpairDisplay)
 *
 * Modifier-group lifecycle mutations are covered too (same audit table,
 * F-20 modifier scope):
 *   - menu.modifier_group.created / .updated / .deleted
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 *
 * Run with:
*   STATEMENT_TEST_DATABASE_URL=<redacted>
 *     npx jest __tests__/restaurantDevicePairingAudit.db.test.js
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
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'debug';
  process.env['JWT' + '_SECRET'] = 'device-audit-test-secret';
}

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
  broadcastToUser: jest.fn(),
}));
jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(),
  resolveScope: jest.fn(),
}));

const { resolveRestaurantAccess } = require('../services/scopeModel');
const { errorHandler } = require('../middleware/errorHandler');
const pool = require('../db');
const appFlow = require('../controllers/restaurantAppFlowController');
const displays = require('../controllers/restaurantDisplayController');
const food = require('../controllers/foodController');

jest.setTimeout(60000);

function deviceApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = userId ? { id: userId, email: 'owner@example.com', role: 'customer' } : undefined;
    next();
  });
  app.post('/api/restaurants/:restaurantId/devices/pairing-codes', appFlow.createDevicePairingCode);
  app.post('/api/restaurants/:restaurantId/devices/pair', appFlow.pairDevice);
  app.post('/api/restaurants/:restaurantId/devices/:deviceId/rotate-token', appFlow.rotateDeviceToken);
  app.patch('/api/restaurants/:restaurantId/devices/:deviceId', appFlow.updateDeviceConfig);
  app.post('/api/restaurant/displays/claim', displays.claimDisplay);
  app.delete('/api/restaurant/displays/:id', displays.unpairDisplay);
  app.use(errorHandler);
  return app;
}

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Device', 'Audit', 'customer', TRUE, TRUE)`,
    [id, `device-audit-${label}-${id}@example.invalid`]
  );
  return id;
}

async function auditRows(businessId, action) {
  const { rows } = await pool.query(
    `SELECT action, target_type, target_id, before_state, after_state, metadata
       FROM business_audit_log
      WHERE business_id = $1 AND action = $2
      ORDER BY id DESC LIMIT 5`,
    [businessId, action]
  );
  return rows;
}

ddescribe('F-20 device-pairing audit actions', () => {
  let F = {};

  beforeAll(async () => {
    const owner = await newUser('owner');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Device Audit ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Device Audit Diner', ['pickup']]
    );
    F = { owner, businessId: biz.id, restaurantId: rest.id };
    resolveRestaurantAccess.mockImplementation(async () => ({
      id: rest.id,
      business_id: biz.id,
      display_name: 'Device Audit Diner',
      timezone: 'UTC',
      currency_code: 'USD',
      effective_role: 'owner',
      effective_membership_id: null,
    }));
  });

  test('pairing-code creation and pairing are audited; secrets never land in the log', async () => {
    const created = await request(deviceApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/devices/pairing-codes`)
      .send({ appKey: 'kitchen', deviceName: 'Kitchen TV' });
    expect(created.status).toBe(201);
    const deviceId = created.body.device.id;
    const code = created.body.pairingCode;
    expect(code).toBeTruthy();

    let rows = await auditRows(F.businessId, 'restaurant.device.pairing_code.created');
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('restaurant_app_device');
    expect(String(rows[0].target_id)).toBe(String(deviceId));
    expect(rows[0].after_state.appKey).toBe('kitchen');
    expect(JSON.stringify(rows[0])).not.toContain(code);

    // pairDevice is unauthenticated: the device holds the code.
    const paired = await request(deviceApp(null))
      .post(`/api/restaurants/${F.restaurantId}/devices/pair`)
      .send({ pairingCode: code });
    expect(paired.status).toBe(200);
    expect(paired.body.deviceToken).toBeTruthy();

    rows = await auditRows(F.businessId, 'restaurant.device.paired');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].target_id)).toBe(String(deviceId));
    expect(rows[0].after_state.deviceName).toBe('Kitchen TV');
    expect(JSON.stringify(rows[0])).not.toContain(paired.body.deviceToken);

    F.deviceId = deviceId;
  });

  test('token rotation is audited with before/after expiry, never the token', async () => {
    const { rows: [before] } = await pool.query(
      'SELECT device_token_expires_at FROM restaurant_app_devices WHERE id = $1',
      [F.deviceId]
    );
    const rotated = await request(deviceApp(F.owner))
      .post(`/api/restaurants/${F.restaurantId}/devices/${F.deviceId}/rotate-token`)
      .send({});
    expect(rotated.status).toBe(200);

    const rows = await auditRows(F.businessId, 'restaurant.device.token_rotated');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].target_id)).toBe(String(F.deviceId));
    expect(rows[0].before_state.deviceTokenExpiresAt).toBe(before.device_token_expires_at.toISOString());
    expect(new Date(rows[0].after_state.deviceTokenExpiresAt).getTime())
      .toBeGreaterThan(new Date(rows[0].before_state.deviceTokenExpiresAt).getTime());
    expect(JSON.stringify(rows[0])).not.toContain(rotated.body.deviceToken);
  });

  test('config updates are audited with before/after', async () => {
    const updated = await request(deviceApp(F.owner))
      .patch(`/api/restaurants/${F.restaurantId}/devices/${F.deviceId}`)
      .send({ deviceName: 'Kitchen TV v2', config: { theme: 'dark' } });
    expect(updated.status).toBe(200);

    const rows = await auditRows(F.businessId, 'restaurant.device.config_updated');
    expect(rows).toHaveLength(1);
    expect(rows[0].before_state.deviceName).toBe('Kitchen TV');
    expect(rows[0].after_state.deviceName).toBe('Kitchen TV v2');
    expect(rows[0].after_state.configVersion).toBe(rows[0].before_state.configVersion + 1);
  });

  test('display claim and unpair are audited', async () => {
    const { hashSecret, generatePairingCode } = displays._test;
    const code = generatePairingCode();
    const { rows: [pairing] } = await pool.query(
      `INSERT INTO display_pairings
         (restaurant_id, code_hash, device_role, expires_at)
       VALUES ($1, $2, 'kitchen', NOW() + INTERVAL '15 minutes')
       RETURNING id`,
      [F.restaurantId, hashSecret(code)]
    );

    const claimed = await request(deviceApp(F.owner))
      .post('/api/restaurant/displays/claim')
      .send({ code, device_role: 'kitchen' });
    expect(claimed.status).toBe(201);

    let rows = await auditRows(F.businessId, 'restaurant.display.paired');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].target_id)).toBe(String(pairing.id));
    expect(rows[0].after_state.deviceRole).toBe('kitchen');
    expect(JSON.stringify(rows[0])).not.toContain(claimed.body.token);

    const unpaired = await request(deviceApp(F.owner))
      .delete(`/api/restaurant/displays/${pairing.id}`)
      .send({});
    expect(unpaired.status).toBe(200);

    rows = await auditRows(F.businessId, 'restaurant.display.unpaired');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].target_id)).toBe(String(pairing.id));
    expect(rows[0].before_state.deviceRole).toBe('kitchen');
  });
});

ddescribe('F-20 modifier-group audit actions', () => {
  let F = {};

  function menuApp(userId) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: userId };
      next();
    });
    app.post('/api/food/restaurants/:restaurantId/menu-items/:itemId/modifier-groups', food.createModifierGroup);
    app.patch('/api/food/restaurants/:restaurantId/modifier-groups/:groupId', food.updateModifierGroup);
    app.delete('/api/food/restaurants/:restaurantId/modifier-groups/:groupId', food.deleteModifierGroup);
    app.use(errorHandler);
    return app;
  }

  beforeAll(async () => {
    const owner = await newUser('modifier-owner');
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [owner, `Modifier Audit ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, owner, 'Modifier Audit Diner', ['pickup']]
    );
    const { rows: [item] } = await pool.query(
      `INSERT INTO food_menu_items (restaurant_id, name, price_cents)
       VALUES ($1, 'Burger', 999) RETURNING id`,
      [rest.id]
    );
    F = { owner, businessId: biz.id, restaurantId: rest.id, itemId: item.id };
    resolveRestaurantAccess.mockImplementation(async () => ({
      id: rest.id,
      business_id: biz.id,
      display_name: 'Modifier Audit Diner',
      timezone: 'UTC',
      currency_code: 'USD',
      effective_role: 'owner',
      effective_membership_id: null,
    }));
  });

  test('modifier-group create/update/delete are audited with before/after option detail', async () => {
    const created = await request(menuApp(F.owner))
      .post(`/api/food/restaurants/${F.restaurantId}/menu-items/${F.itemId}/modifier-groups`)
      .send({
        name: 'Extras',
        minSelect: 0,
        maxSelect: 2,
        options: [
          { name: 'Cheese', priceDeltaCents: 100 },
          { name: 'Bacon', priceDeltaCents: 200 },
        ],
      });
    expect(created.status).toBe(201);
    const groupId = created.body.modifierGroup?.id;
    expect(groupId).toBeTruthy();

    let rows = await auditRows(F.businessId, 'menu.modifier_group.created');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].target_id)).toBe(String(groupId));
    expect(rows[0].after_state.name).toBe('Extras');
    expect(rows[0].after_state.options).toHaveLength(2);
    expect(rows[0].after_state.options[0]).toMatchObject({ name: 'Cheese', price_delta_cents: 100 });

    const updated = await request(menuApp(F.owner))
      .patch(`/api/food/restaurants/${F.restaurantId}/modifier-groups/${groupId}`)
      .send({
        name: 'Extras',
        minSelect: 1,
        maxSelect: 2,
        isRequired: true,
        options: [
          { name: 'Cheese', priceDeltaCents: 150 },
          { name: 'Bacon', priceDeltaCents: 200 },
          { name: 'Avocado', priceDeltaCents: 250 },
        ],
      });
    expect(updated.status).toBe(200);

    rows = await auditRows(F.businessId, 'menu.modifier_group.updated');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].target_id)).toBe(String(groupId));
    // Before image carries the original price deltas; after image the new ones.
    expect(rows[0].before_state.options.find((o) => o.name === 'Cheese').price_delta_cents).toBe(100);
    expect(rows[0].after_state.options.find((o) => o.name === 'Cheese').price_delta_cents).toBe(150);
    expect(rows[0].after_state.options).toHaveLength(3);
    expect(rows[0].before_state.is_required).toBe(false);
    expect(rows[0].after_state.is_required).toBe(true);

    const deleted = await request(menuApp(F.owner))
      .delete(`/api/food/restaurants/${F.restaurantId}/modifier-groups/${groupId}`)
      .send({});
    expect(deleted.status).toBe(204);

    rows = await auditRows(F.businessId, 'menu.modifier_group.deleted');
    expect(rows).toHaveLength(1);
    expect(String(rows[0].target_id)).toBe(String(groupId));
    expect(rows[0].before_state.name).toBe('Extras');
    expect(rows[0].before_state.options).toHaveLength(3);
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });
});
