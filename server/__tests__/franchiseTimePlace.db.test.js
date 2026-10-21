'use strict';

// Franchise review F-01 / F-12 / F-28 / F-10(write-side) against the real
// migrated schema. Runs only against an explicitly opted-in disposable
// fr_t1 database:
//   FR_T1_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/fr_t1
//
// Fixtures are stamped and left in the disposable database: deleting
// food_restaurants rows is blocked schema-wide by the wallet ledger's
// append-only rewrite rule.
function frT1OptIn() {
  const value = process.env.FR_T1_TEST_DATABASE_URL || '';
  if (!value) return '';
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (!loopback || url.pathname !== '/fr_t1') {
    throw new Error('FR_T1_TEST_DATABASE_URL must be a loopback fr_t1 database');
  }
  return value;
}

const url = frT1OptIn();
if (url) process.env.DATABASE_URL = url;
jest.unmock('pg');
jest.unmock('../db');
const db = require('../db');
const foodController = require('../controllers/foodController');
const businessController = require('../controllers/businessController');
const appFlowController = require('../controllers/restaurantAppFlowController');

const suite = url ? describe : describe.skip;

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    end() { return this; },
  };
}

function mockNext() {
  const next = (err) => { if (err) next.error = err; };
  next.error = null;
  return next;
}

async function call(handler, req) {
  const res = mockRes();
  const next = mockNext();
  await handler(req, res, next);
  return { res, error: next.error };
}

suite('franchise time & place: restaurant timezone, fulfillment defaults, locations', () => {
  const stamp = Date.now();
  let userId;
  let restaurantId;
  let businessId;

  const reqFor = (body = {}, params = {}) => ({
    user: { id: userId },
    body,
    params,
    query: {},
    get: () => undefined,
  });

  beforeAll(async () => {
    const { rows: [user] } = await db.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, 'x', 'FTP', 'Fixture') RETURNING id`,
      [`ftp-${stamp}@example.test`]
    );
    userId = user.id;
  });

  afterAll(async () => {
    if (restaurantId) {
      await db.query('DELETE FROM restaurant_locations WHERE restaurant_id = $1', [restaurantId]);
    }
    await db.end();
  });

  test('F-01/F-12: createRestaurant stores a valid timezone and defaults fulfillment modes', async () => {
    const { res, error } = await call(foodController.createRestaurant, reqFor({
      displayName: `FTP Bistro ${stamp}`,
      timezone: 'America/New_York',
    }));
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    restaurantId = res.body.restaurant.id;
    businessId = res.body.restaurant.business_id;
    expect(res.body.restaurant.timezone).toBe('America/New_York');
    expect(res.body.restaurant.fulfillment_modes).toEqual(['pickup', 'dine_in', 'kiosk']);
    const { rows: [biz] } = await db.query(
      'SELECT timezone FROM businesses WHERE id = $1',
      [res.body.restaurant.business_id]
    );
    expect(biz.timezone).toBe('America/New_York');
  });

  test('F-01: createRestaurant rejects an invalid timezone with a 400 and writes nothing', async () => {
    const { error } = await call(foodController.createRestaurant, reqFor({
      displayName: `FTP Bad TZ ${stamp}`,
      timezone: 'Eastern',
    }));
    expect(error).toBeTruthy();
    expect(error.status).toBe(400);
    expect(error.fields.timezone).toMatch(/IANA/);
    const { rows } = await db.query(
      'SELECT id FROM food_restaurants WHERE display_name = $1',
      [`FTP Bad TZ ${stamp}`]
    );
    expect(rows).toHaveLength(0);
  });

  test('F-01: createRestaurant for an existing business inherits the business timezone', async () => {
    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name, business_kind, business_mode, timezone)
       VALUES ($1, $2, 'restaurant', 'food', 'Europe/Paris') RETURNING id`,
      [userId, `FTP Existing ${stamp}`]
    );
    const { res, error } = await call(foodController.createRestaurant, reqFor({
      displayName: `FTP Existing Restaurant ${stamp}`,
      businessId: biz.id,
    }));
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body.restaurant.timezone).toBe('Europe/Paris');
  });

  test('F-01b: a Business Hub restaurant inherits the business timezone', async () => {
    const { res, error } = await call(businessController.addBusiness, reqFor({
      business_name: `FTP Hub ${stamp}`,
      business_kind: 'restaurant',
      timezone: 'America/Denver',
    }));
    expect(error).toBeNull();
    const businessId = res.body.business.id;
    const { rows: [restaurant] } = await db.query(
      'SELECT timezone FROM food_restaurants WHERE business_id = $1',
      [businessId]
    );
    expect(restaurant).toBeTruthy();
    expect(restaurant.timezone).toBe('America/Denver');
  });

  test('F-01: updateRestaurant validates the timezone on write', async () => {
    const bad = await call(foodController.updateRestaurant, reqFor(
      { timezone: 'Eastern' },
      { restaurantId }
    ));
    expect(bad.error).toBeTruthy();
    expect(bad.error.status).toBe(400);

    const good = await call(foodController.updateRestaurant, reqFor(
      { timezone: 'Asia/Tokyo' },
      { restaurantId }
    ));
    expect(good.error).toBeNull();
    expect(good.res.body.restaurant.timezone).toBe('Asia/Tokyo');
  });

  test('F-10: updatePublishing rejects an invalid timezone and accepts a valid one', async () => {
    const bad = await call(appFlowController.updatePublishing, reqFor(
      { timezone: 'Eastern' },
      { restaurantId }
    ));
    expect(bad.error).toBeTruthy();
    expect(bad.error.status).toBe(400);
    expect(bad.error.fields.timezone).toMatch(/IANA/);

    const good = await call(appFlowController.updatePublishing, reqFor(
      { timezone: 'America/Chicago' },
      { restaurantId }
    ));
    expect(good.error).toBeNull();
    const { rows: [row] } = await db.query(
      'SELECT timezone FROM food_restaurants WHERE id = $1',
      [restaurantId]
    );
    expect(row.timezone).toBe('America/Chicago');
  });

  describe('F-28 locations', () => {
    let primaryId;
    let secondId;

    test('create stores NULL coordinates when none are sent (never 0)', async () => {
      const { res, error } = await call(foodController.createRestaurantLocation, reqFor(
        { name: 'Downtown', isPrimary: true, timezone: 'America/New_York', latitude: null, longitude: null },
        { restaurantId }
      ));
      expect(error).toBeNull();
      expect(res.statusCode).toBe(201);
      primaryId = res.body.location.id;
      expect(res.body.location.latitude).toBeNull();
      const { rows: auditRows } = await db.query(
        `SELECT action, target_type, after_state
           FROM business_audit_log
          WHERE business_id = $1 AND action = 'restaurant.location.created'
          ORDER BY id DESC LIMIT 1`,
        [businessId]
      );
      expect(auditRows[0].target_type).toBe('restaurant_location');
      expect(auditRows[0].after_state.name).toBe('Downtown');
      expect(res.body.location.longitude).toBeNull();
      expect(res.body.location.timezone).toBe('America/New_York');
      expect(res.body.location.is_primary).toBe(true);
    });

    test('an invalid status is a 400 and the primary flag survives', async () => {
      const { error } = await call(foodController.createRestaurantLocation, reqFor(
        { name: 'Bogus', status: 'bogus', isPrimary: true },
        { restaurantId }
      ));
      expect(error).toBeTruthy();
      expect(error.status).toBe(400);
      const { rows } = await db.query(
        'SELECT id, is_primary FROM restaurant_locations WHERE restaurant_id = $1',
        [restaurantId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].is_primary).toBe(true);
    });

    test('creating a second primary flips the first inside the same flow', async () => {
      const { res, error } = await call(foodController.createRestaurantLocation, reqFor(
        { name: 'Uptown', isPrimary: true },
        { restaurantId }
      ));
      expect(error).toBeNull();
      secondId = res.body.location.id;
      const { rows } = await db.query(
        'SELECT id, is_primary FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
        [restaurantId]
      );
      expect(rows.find((r) => r.id === primaryId).is_primary).toBe(false);
      expect(rows.find((r) => r.id === secondId).is_primary).toBe(true);
    });

    test('update validates status, keeps NULL coordinates NULL, and can pause', async () => {
      const bad = await call(foodController.updateRestaurantLocation, reqFor(
        { status: 'bogus' },
        { restaurantId, locationId: primaryId }
      ));
      expect(bad.error).toBeTruthy();
      expect(bad.error.status).toBe(400);

      const { res, error } = await call(foodController.updateRestaurantLocation, reqFor(
        { status: 'paused', phone: '555-0100' },
        { restaurantId, locationId: primaryId }
      ));
      expect(error).toBeNull();
      expect(res.body.location.status).toBe('paused');
      expect(res.body.location.phone).toBe('555-0100');
      expect(res.body.location.latitude).toBeNull();
      const { rows: auditRows } = await db.query(
        `SELECT before_state, after_state
           FROM business_audit_log
          WHERE business_id = $1 AND action = 'restaurant.location.updated'
          ORDER BY id DESC LIMIT 1`,
        [businessId]
      );
      expect(auditRows[0].before_state.status).toBe('active');
      expect(auditRows[0].after_state.status).toBe('paused');
    });

    test('update can promote a location back to primary', async () => {
      const { error } = await call(foodController.updateRestaurantLocation, reqFor(
        { isPrimary: true },
        { restaurantId, locationId: primaryId }
      ));
      expect(error).toBeNull();
      const { rows } = await db.query(
        'SELECT id, is_primary FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY id',
        [restaurantId]
      );
      expect(rows.find((r) => r.id === primaryId).is_primary).toBe(true);
      expect(rows.find((r) => r.id === secondId).is_primary).toBe(false);
    });

    test('update rejects an invalid timezone with a 400', async () => {
      const { error } = await call(foodController.updateRestaurantLocation, reqFor(
        { timezone: 'Eastern' },
        { restaurantId, locationId: primaryId }
      ));
      expect(error).toBeTruthy();
      expect(error.status).toBe(400);
    });
  });
});
