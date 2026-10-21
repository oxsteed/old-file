'use strict';

// DB-backed tests for the kitchen device-or-staff authorization (Track B).
// Covers verifyDisplayPairingToken() and requireKitchenDeviceOrStaff():
//   - a valid pairing token scoped to :restaurantId authorizes the request
//     and sets req.displayDevice
//   - an invalid/unpaired token 401s (fail closed, no staff fall-through)
//   - a token paired to restaurant A on restaurant B's route 401s
//   - no token (or a non-display-shaped bearer) falls through to the staff
//     path (authenticate + the canonical restaurant gate)
//
// Honors STATEMENT_TEST_DATABASE_URL; skipped when the variable is absent
// so the default unit suite never needs a database. Runs in an isolated
// schema with the production migration applied.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `kitchen_device_auth_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Kitchen device auth fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const controller = require('../controllers/restaurantDisplayController');
const authMiddleware = require('../middleware/auth');
const scopeGates = require('../middleware/scopeGates');

const describeDb = url ? describe : describe.skip;

const OWNER_ID = 1201;
let restaurantA;
let restaurantB;
let pairingA; // { id, token }
let pairingB;

function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function codeHash() {
  return sha256hex(crypto.randomBytes(16).toString('hex'));
}

// Invokes the middleware and resolves { nextCalled, thrown, req }.
async function invokeMiddleware({ token, restaurantId }) {
  const req = {
    params: { restaurantId: String(restaurantId) },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  let nextCalled = false;
  let thrown = null;
  await controller.requireKitchenDeviceOrStaff(req, res, (err) => {
    nextCalled = true;
    thrown = err || null;
  });
  return { req, res, nextCalled, thrown };
}

describeDb('kitchen device-or-staff authorization', () => {
  let realAuthenticate;
  let realRequireRestaurantAccess;

  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.businesses (id BIGSERIAL PRIMARY KEY, user_id BIGINT, deleted_at TIMESTAMPTZ)`);
    await db.query(
      `CREATE TABLE ${schema}.business_members
         (id BIGSERIAL PRIMARY KEY, business_id BIGINT, member_id BIGINT, role TEXT, status TEXT)`
    );
    await db.query(
      `CREATE TABLE ${schema}.food_restaurants
         (id BIGSERIAL PRIMARY KEY, business_id BIGINT REFERENCES ${schema}.businesses(id),
          owner_user_id BIGINT, display_name TEXT)`
    );
    await db.query(
      `CREATE TABLE ${schema}.restaurant_locations
         (id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT NOT NULL, name TEXT,
          status TEXT NOT NULL DEFAULT 'active', is_primary BOOLEAN NOT NULL DEFAULT FALSE)`
    );
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/911_display_pairings.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/913_display_pairing_device_role.sql'), 'utf8'));
    // Migration 944 (F-27 pairing-token expiry/rotation): token verification
    // reads the expiry/previous-hash columns, so the schema must have them.
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/944_display_pairing_token_expiry.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/975_display_pairing_locations.sql'), 'utf8'));

    const businessId = (
      await db.query(`INSERT INTO ${schema}.businesses (user_id) VALUES ($1) RETURNING id`, [OWNER_ID])
    ).rows[0].id;
    restaurantA = (
      await db.query(
        `INSERT INTO ${schema}.food_restaurants (business_id, owner_user_id, display_name)
         VALUES ($1, $2, 'Diner A') RETURNING id`,
        [businessId, OWNER_ID]
      )
    ).rows[0].id;
    restaurantB = (
      await db.query(
        `INSERT INTO ${schema}.food_restaurants (business_id, owner_user_id, display_name)
         VALUES ($1, $2, 'Diner B') RETURNING id`,
        [businessId, OWNER_ID]
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO ${schema}.restaurant_locations (restaurant_id, name, is_primary) VALUES ($1, 'Main A', TRUE), ($2, 'Main B', TRUE)`,
      [restaurantA, restaurantB]
    );

    async function pairedRow(restaurantId, label, deviceRole = 'kiosk') {
      const token = crypto.randomBytes(32).toString('hex');
      const { rows } = await db.query(
        `INSERT INTO ${schema}.display_pairings
           (restaurant_id, location_id, code_hash, expires_at, paired_at, label, pairing_token_hash, device_role)
         VALUES ($1, (SELECT id FROM ${schema}.restaurant_locations WHERE restaurant_id = $1), $2, NOW() + INTERVAL '10 minutes', NOW(), $3, $4, $5)
         RETURNING id`,
        [restaurantId, codeHash(), label, sha256hex(token), deviceRole]
      );
      return { id: Number(rows[0].id), token };
    }
    pairingA = await pairedRow(restaurantA, 'Kitchen tablet', 'kitchen');
    pairingB = await pairedRow(restaurantB, 'Expo screen');
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  test('verifyDisplayPairingToken returns the pairing for a paired token, null otherwise', async () => {
    const ok = await controller.verifyDisplayPairingToken(pairingA.token);
    // F-27: the verifier also reports token expiry and whether the
    // rotated-out previous token was used; this legacy fixture row has no
    // expiry recorded yet, so tokenExpiresAt is null.
    expect(ok).toEqual({ pairingId: pairingA.id, restaurantId: Number(restaurantA), locationId: expect.any(Number), label: 'Kitchen tablet', deviceRole: 'kitchen', tokenExpiresAt: null, usedPreviousToken: false });

    expect(await controller.verifyDisplayPairingToken(crypto.randomBytes(32).toString('hex'))).toBeNull();
    expect(await controller.verifyDisplayPairingToken(null)).toBeNull();
    expect(await controller.verifyDisplayPairingToken('not-a-token')).toBeNull();
  });

  test('revoked tokens (pairing deleted, like owner unpair) verify as null and 401', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const { rows } = await db.query(
      `INSERT INTO ${schema}.display_pairings
         (restaurant_id, code_hash, expires_at, paired_at, label, pairing_token_hash)
       VALUES ($1, $2, NOW() + INTERVAL '10 minutes', NOW(), 'Temp', $3)
       RETURNING id`,
      [restaurantA, codeHash(), sha256hex(token)]
    );
    // Owner unpairs: the row is deleted and the token stops working.
    await db.query(`DELETE FROM ${schema}.display_pairings WHERE id = $1`, [rows[0].id]);
    expect(await controller.verifyDisplayPairingToken(token)).toBeNull();
    const { req, nextCalled, thrown } = await invokeMiddleware({ token, restaurantId: restaurantA });
    expect(nextCalled).toBe(true);
    expect(thrown).toBeTruthy();
    expect(thrown.statusCode).toBe(401);
    expect(req.displayDevice).toBeUndefined();
  });

  test('valid token + matching restaurant authorizes and sets req.displayDevice', async () => {
    const { req, nextCalled, thrown } = await invokeMiddleware({ token: pairingA.token, restaurantId: restaurantA });
    expect(thrown).toBeNull();
    expect(nextCalled).toBe(true);
    expect(req.displayDevice).toEqual({
      pairingId: pairingA.id,
      restaurantId: Number(restaurantA),
      locationId: expect.any(Number),
      label: 'Kitchen tablet',
      deviceRole: 'kitchen',
    });
  });

  test('unknown display-token-shaped bearer fails closed with 401', async () => {
    const { req, nextCalled, thrown } = await invokeMiddleware({
      token: crypto.randomBytes(32).toString('hex'),
      restaurantId: restaurantA,
    });
    expect(nextCalled).toBe(true);
    expect(thrown).toBeTruthy();
    expect(thrown.statusCode).toBe(401);
    expect(req.displayDevice).toBeUndefined();
  });

  test('token paired to restaurant A on restaurant B route fails closed with 401', async () => {
    const { req, nextCalled, thrown } = await invokeMiddleware({
      token: pairingA.token,
      restaurantId: restaurantB,
    });
    expect(nextCalled).toBe(true);
    expect(thrown).toBeTruthy();
    expect(thrown.statusCode).toBe(401);
    expect(req.displayDevice).toBeUndefined();
  });

  test('kiosk-role token is rejected from kitchen authorization with 401', async () => {
    const { req, nextCalled, thrown } = await invokeMiddleware({
      token: pairingB.token,
      restaurantId: restaurantB,
    });
    expect(nextCalled).toBe(true);
    expect(thrown).toBeTruthy();
    expect(thrown.statusCode).toBe(401);
    expect(req.displayDevice).toBeUndefined();
  });

  describe('staff fall-through', () => {
    const staffCalls = [];

    beforeEach(() => {
      staffCalls.length = 0;
      realAuthenticate = authMiddleware.authenticate;
      realRequireRestaurantAccess = scopeGates.requireRestaurantAccess;
      authMiddleware.authenticate = (req, res, next) => {
        staffCalls.push('authenticate');
        req.user = { id: OWNER_ID };
        next();
      };
      scopeGates.requireRestaurantAccess = () => (req, res, next) => {
        staffCalls.push('restaurant-gate');
        next();
      };
    });

    afterEach(() => {
      authMiddleware.authenticate = realAuthenticate;
      scopeGates.requireRestaurantAccess = realRequireRestaurantAccess;
    });

    test('no bearer falls through to authenticate + the restaurant gate', async () => {
      const { req, nextCalled, thrown } = await invokeMiddleware({ token: null, restaurantId: restaurantA });
      expect(thrown).toBeNull();
      expect(nextCalled).toBe(true);
      expect(req.displayDevice).toBeUndefined();
      expect(staffCalls).toEqual(['authenticate', 'restaurant-gate']);
    });

    test('a non-display-shaped bearer (e.g. staff JWT) takes the staff path, not the device path', async () => {
      const { req, nextCalled, thrown } = await invokeMiddleware({
        token: 'eyJhbGciOiJIUzI1NiJ9.c3RhZmY.c2ln',
        restaurantId: restaurantA,
      });
      expect(thrown).toBeNull();
      expect(nextCalled).toBe(true);
      expect(req.displayDevice).toBeUndefined();
      expect(staffCalls).toEqual(['authenticate', 'restaurant-gate']);
    });
  });
});
