'use strict';

// Group 13 Slice 4g acceptance: operate as cashier (681-685).
// 681 location picker, 684 transaction lookup, 683 authorized transaction
// view, 682 cashier shift summary, 685 shift closeout checklist — one
// device-authenticated cashier surface on the kiosk, scoped server-side to
// the paired device. No money moves in this slice: the shift summary and
// closeout derive from the existing kiosk ledger records.
// Runs against a dedicated fresh database (credit_statement_test_g13g) so
// slice-local fixtures never pollute the shared credit_statement_test DB.

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP13_SLICE4G_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g13g') {
    throw new Error('Group 13 Slice 4g DB tests require the loopback credit_statement_test_g13g database');
  }
  process.env.DATABASE_URL = dbUrl;
}

jest.setTimeout(60000);

const describeDb = dbUrl ? describe : describe.skip;

describeDb('Group 13 Slice 4g: operate as cashier (681-685)', () => {
  let pool;
  let app;
  let owner;
  let businessId;
  let restaurantId;
  let locPrimary;
  let locSecond;
  let locPaused;
  let kioskDevice;
  let kioskToken;
  let displayKiosk;
  let displayToken;
  let otherDevice;
  let otherToken;
  let queueDevice;
  let queueToken;

  beforeAll(async () => {
    pool = require('../db');
    app = express();
    app.use(express.json());
    // The real kiosk router, mounted exactly as in server/index.js, so the
    // cashier routes' position ahead of the credit_kiosk-only auth is
    // exercised rather than assumed.
    app.use('/api/restaurants/:restaurantId/credit-kiosks/:deviceId', require('../routes/oxsteedCreditKiosk'));
    app.use(require('../middleware/errorHandler').errorHandler);

    owner = await makeUser();
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_primary, is_active)
       VALUES ($1, 'Fixture Business', FALSE, TRUE) RETURNING id`,
      [owner.id],
    );
    businessId = business.id;
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, 'Fixture Kitchen') RETURNING id`,
      [business.id, owner.id],
    );
    restaurantId = restaurant.id;
    // Inserting the restaurant auto-creates its primary location (named
    // after the restaurant); reuse it instead of inserting a second one —
    // one primary per restaurant is a unique partial index.
    ({ rows: [{ id: locPrimary }] } = await pool.query(
      `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE`,
      [restaurantId],
    ));
    locPrimary = Number(locPrimary);
    await pool.query(`UPDATE restaurant_locations SET name = 'Downtown' WHERE id = $1`, [locPrimary]);
    locSecond = await makeLocation('Uptown', {});
    locPaused = await makeLocation('Paused Store', { status: 'paused' });

    // The credit-kiosk terminal, bound to the primary location at pairing.
    ({ device: kioskDevice, token: kioskToken } = await makeDevice({
      locationId: locPrimary, appKey: 'credit_kiosk',
    }));
    // The managed display kiosk (role kiosk), with no location binding:
    // it may work any active location of the restaurant.
    ({ device: displayKiosk, token: displayToken } = await makeDevice({
      locationId: null, appKey: 'display', config: { screenRole: 'kiosk' },
    }));
    // A second terminal, bound to the other location.
    ({ device: otherDevice, token: otherToken } = await makeDevice({
      locationId: locSecond, appKey: 'credit_kiosk',
    }));
    // A display that is NOT a kiosk (queue board): never a cashier device.
    ({ device: queueDevice, token: queueToken } = await makeDevice({
      locationId: locPrimary, appKey: 'display', config: { screenRole: 'queue' },
    }));
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  async function makeUser(role = 'customer') {
    const id = crypto.randomUUID();
    const email = `t${id}@example.invalid`;
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Test', 'Fixture', $3, TRUE, TRUE, TRUE)`,
      [id, email, role],
    );
    return { id, email, role };
  }

  async function makeLocation(name, { isPrimary = false, status = 'active' } = {}) {
    const { rows: [row] } = await pool.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, is_primary, status)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [restaurantId, name, isPrimary, status],
    );
    return Number(row.id);
  }

  async function makeDevice({ locationId = null, appKey = 'credit_kiosk', config = {}, mode = null }) {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows: [device] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, location_id, app_key, device_name, mode, status, config,
          device_token_hash, device_token_expires_at, paired_at)
       VALUES ($1, $2, $3, 'Fixture device', $4, 'paired', $5, $6, NOW() + INTERVAL '90 days', NOW())
       RETURNING id`,
      [restaurantId, locationId, appKey, mode, JSON.stringify(config), hash],
    );
    // Pairing auto-registers the device in restaurant_devices; device auth
    // joins that registry row, so a missing row would fail every request.
    const { rows: [registry] } = await pool.query(
      `SELECT id, status FROM restaurant_devices WHERE source_app_device_id = $1`,
      [device.id],
    );
    expect(registry?.status).toBe('active');
    return { device, token };
  }

  const cashierGet = (device, token, path) => request(app)
    .get(`/api/restaurants/${restaurantId}/credit-kiosks/${device.id}${path}`)
    .set('X-Device-Token', token);

  test('681: a location-bound terminal sees only its paired location, as the default', async () => {
    const res = await cashierGet(kioskDevice, kioskToken, '/cashier/locations');
    expect(res.status).toBe(200);
    expect(res.body.pairedLocationId).toBe(locPrimary);
    expect(res.body.defaultLocationId).toBe(locPrimary);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({
      id: locPrimary, name: 'Downtown', isPaired: true,
    });
  });

  test('681: a display kiosk with no location at pairing is bound to the primary store by the DB trigger', async () => {
    // Migration 989 backfills a missing device location with the primary
    // store, so the display kiosk is bound, not unbound: one location,
    // paired, as the default.
    const res = await cashierGet(displayKiosk, displayToken, '/cashier/locations');
    expect(res.status).toBe(200);
    expect(res.body.pairedLocationId).toBe(locPrimary);
    expect(res.body.defaultLocationId).toBe(locPrimary);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({ id: locPrimary, isPaired: true });
  });

  test('681: a device with no binding authorizes nothing (fail-closed service fallback)', async () => {
    // The trigger makes this unreachable for a real device row; the service
    // is tested directly with a bare device record so the fallback is
    // proven anyway: no binding means no locations, never every location.
    const cashierService = require('../services/creditKioskCashier');
    const locations = await cashierService.getAuthorizedLocations(pool, {
      restaurant_id: restaurantId, location_id: null,
    });
    expect(locations).toEqual([]);
    expect(cashierService.defaultLocationId({ location_id: null }, locations)).toBeNull();
  });

  test('681: a second terminal bound elsewhere sees only its own location', async () => {
    const res = await cashierGet(otherDevice, otherToken, '/cashier/locations');
    expect(res.status).toBe(200);
    expect(res.body.locations).toHaveLength(1);
    expect(res.body.locations[0]).toMatchObject({ id: locSecond, isPaired: true });
    expect(res.body.defaultLocationId).toBe(locSecond);
  });

  test('681: another device\'s token cannot read this device\'s locations', async () => {
    const res = await cashierGet(kioskDevice, otherToken, '/cashier/locations');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_device_credential');
  });

  test('681: no token cannot read the locations', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantId}/credit-kiosks/${kioskDevice.id}/cashier/locations`);
    expect(res.status).toBe(401);
  });

  test('681: a queue-board display is not a cashier device', async () => {
    const res = await cashierGet(queueDevice, queueToken, '/cashier/locations');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_kiosk_cashier_device_required');
  });

  test('681: the device must belong to the restaurant in the path', async () => {
    const res = await request(app)
      .get(`/api/restaurants/${restaurantId + 9999}/credit-kiosks/${kioskDevice.id}/cashier/locations`)
      .set('X-Device-Token', kioskToken);
    expect(res.status).toBe(401);
  });
});
