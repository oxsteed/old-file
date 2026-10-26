'use strict';

// DB-backed tests for display device roles (migration 913, round-2 review
// fixes). Honors STATEMENT_TEST_DATABASE_URL; skipped when the variable is
// absent so the default unit suite never needs a database. Runs in an
// isolated schema with the production migrations applied.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `display_roles_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Display role fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const controller = require('../controllers/restaurantDisplayController');

const describeDb = url ? describe : describe.skip;

const OWNER_ID = 1201;
const OTHER_RESTAURANT_ID = 999999;
let businessId;
let restaurantId;

function res() {
  const r = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  return r;
}

async function invoke(handler, { userId, params = {}, body = {}, headers = {} }) {
  const r = res();
  const req = {
    user: userId ? { id: userId, role: 'user' } : undefined,
    params,
    body,
    headers,
  };
  let thrown = null;
  await handler(req, r, (err) => { thrown = err; });
  if (thrown) {
    // Mirrors the express errorHandler: AppError maps to its status code.
    r.statusCode = thrown.statusCode || 500;
    r.body = { error: thrown.message, code: thrown.code };
  }
  return { req, res: r };
}

async function issueCode(rid, extraBody = {}) {
  const { res: r } = await invoke(controller.issuePairingCode, {
    body: { restaurant_id: rid, ...extraBody },
  });
  expect(r.statusCode).toBe(201);
  return r.body;
}

async function claimCode(code, extraBody = {}) {
  const { res: r } = await invoke(controller.claimDisplay, {
    userId: OWNER_ID,
    body: { code, label: 'Test display', ...extraBody },
  });
  expect(r.statusCode).toBe(201);
  return r.body;
}

async function rowById(id) {
  return (await db.query(`SELECT * FROM ${schema}.display_pairings WHERE id = $1`, [id])).rows[0];
}

async function runKitchenGate({ token, restaurantId: rid }) {
  const req = {
    params: { restaurantId: String(rid) },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  };
  let thrown = null;
  let nexted = false;
  await controller.requireKitchenDeviceOrStaff(req, {}, (err) => {
    if (err) thrown = err;
    else nexted = true;
  });
  return { req, thrown, nexted };
}

describeDb('display device roles (migration 913)', () => {
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
    // Apply 911, insert a legacy (pre-role) paired row, then apply 913 so
    // the migration default is exercised against real existing data.
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/911_display_pairings.sql'), 'utf8'));
    businessId = (await db.query(`INSERT INTO ${schema}.businesses (user_id) VALUES ($1) RETURNING id`, [OWNER_ID])).rows[0].id;
    restaurantId = (
      await db.query(
        `INSERT INTO ${schema}.food_restaurants (business_id, owner_user_id, display_name)
         VALUES ($1, $2, 'Role Test Diner') RETURNING id`,
        [businessId, OWNER_ID]
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO ${schema}.restaurant_locations (restaurant_id, name, is_primary) VALUES ($1, 'Main store', TRUE)`,
      [restaurantId]
    );
    await db.query(
      `INSERT INTO ${schema}.display_pairings
         (restaurant_id, code_hash, pairing_token_hash, label, expires_at, paired_at)
       VALUES ($1, $2, $3, 'Legacy TV', NOW() + INTERVAL '1 hour', NOW())`,
      [
        restaurantId,
        crypto.randomBytes(32).toString('hex'),
        crypto.randomBytes(32).toString('hex'),
      ]
    );
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/913_display_pairing_device_role.sql'), 'utf8'));
    // Migration 944 (F-27 pairing-token expiry/rotation): the endpoints
    // read/write the token expiry columns, so the schema must have them too.
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/944_display_pairing_token_expiry.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/975_display_pairing_locations.sql'), 'utf8'));
    await require('./helpers/displayRegistryFixture').applyDisplayRegistryFixture(db, schema);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  test('migration 913 defaults pre-existing rows to kiosk and rejects other values', async () => {
    const { rows } = await db.query(`SELECT device_role FROM ${schema}.display_pairings`);
    expect(rows).toHaveLength(1);
    expect(rows[0].device_role).toBe('kiosk');
    await expect(
      db.query(`UPDATE ${schema}.display_pairings SET device_role = 'bogus'`)
    ).rejects.toThrow();
  });

  test('issuePairingCode stores display_type; invalid or absent becomes kiosk', async () => {
    const kitchen = await issueCode(restaurantId, { display_type: 'kitchen' });
    const { rows: [kRow] } = await db.query(
      `SELECT device_role FROM ${schema}.display_pairings WHERE code_hash = $1`,
      [crypto.createHash('sha256').update(kitchen.code, 'utf8').digest('hex')]
    );
    expect(kRow.device_role).toBe('kitchen');

    const board = await issueCode(restaurantId, { display_type: 'queue_board' });
    const { rows: [bRow] } = await db.query(
      `SELECT device_role FROM ${schema}.display_pairings WHERE code_hash = $1`,
      [crypto.createHash('sha256').update(board.code, 'utf8').digest('hex')]
    );
    expect(bRow.device_role).toBe('queue_board');

    const invalid = await issueCode(restaurantId, { display_type: 'drive_thru' });
    const { rows: [iRow] } = await db.query(
      `SELECT device_role FROM ${schema}.display_pairings WHERE code_hash = $1`,
      [crypto.createHash('sha256').update(invalid.code, 'utf8').digest('hex')]
    );
    expect(iRow.device_role).toBe('kiosk');

    const absent = await issueCode(restaurantId);
    const { rows: [aRow] } = await db.query(
      `SELECT device_role FROM ${schema}.display_pairings WHERE code_hash = $1`,
      [crypto.createHash('sha256').update(absent.code, 'utf8').digest('hex')]
    );
    expect(aRow.device_role).toBe('kiosk');
  });

  test('claimDisplay overrides device_role when the owner approves it, 400s on invalid, keeps the row role when absent', async () => {
    // Owner override: a kiosk-declared TV is claimed as a kitchen display.
    const { code: overrideCode } = await issueCode(restaurantId, { display_type: 'kiosk' });
    const overridden = await claimCode(overrideCode, { device_role: 'kitchen' });
    expect(overridden.display.device_role).toBe('kitchen');
    expect((await rowById(overridden.display.id)).device_role).toBe('kitchen');

    // Invalid override is a 400, not a silent default.
    const { code: badCode } = await issueCode(restaurantId);
    const { res: bad } = await invoke(controller.claimDisplay, {
      userId: OWNER_ID,
      body: { code: badCode, label: 'TV', device_role: 'drive_thru' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body.code).toBe('invalid_device_role');

    // Absent override keeps the role the TV declared at issuance.
    const { code: keepCode } = await issueCode(restaurantId, { display_type: 'queue_board' });
    const kept = await claimCode(keepCode);
    expect(kept.display.device_role).toBe('queue_board');
    expect((await rowById(kept.display.id)).device_role).toBe('queue_board');
  });

  test('verifyDisplayPairingToken returns the device role', async () => {
    const { code } = await issueCode(restaurantId, { display_type: 'kitchen' });
    const { token } = await claimCode(code);
    const pairing = await controller.verifyDisplayPairingToken(token);
    expect(pairing).not.toBeNull();
    expect(pairing.deviceRole).toBe('kitchen');
  });

  test('requireKitchenDeviceOrStaff: kitchen token passes, kiosk token 401s with display_token_invalid', async () => {
    const { code: kioskCode } = await issueCode(restaurantId, { display_type: 'kiosk' });
    const { token: kioskToken } = await claimCode(kioskCode);
    const { code: kitchenCode } = await issueCode(restaurantId, { display_type: 'kitchen' });
    const { token: kitchenToken } = await claimCode(kitchenCode);

    const ok = await runKitchenGate({ token: kitchenToken, restaurantId });
    expect(ok.thrown).toBeNull();
    expect(ok.nexted).toBe(true);
    expect(ok.req.displayDevice.deviceRole).toBe('kitchen');
    expect(ok.req.displayDevice.pairingId).toEqual(expect.any(Number));

    // A kiosk token never falls through to staff auth: it fails closed.
    const denied = await runKitchenGate({ token: kioskToken, restaurantId });
    expect(denied.nexted).toBe(false);
    expect(denied.thrown).not.toBeNull();
    expect(denied.thrown.statusCode).toBe(401);
    expect(denied.thrown.code).toBe('display_token_invalid');
    expect(denied.thrown.message).toBe('Unauthorized');
    expect(denied.req.displayDevice).toBeUndefined();

    // A kitchen token for the wrong restaurant still fails closed.
    const wrongScope = await runKitchenGate({ token: kitchenToken, restaurantId: OTHER_RESTAURANT_ID });
    expect(wrongScope.thrown).not.toBeNull();
    expect(wrongScope.thrown.statusCode).toBe(401);
    expect(wrongScope.thrown.code).toBe('display_token_invalid');

    // An unknown display-shaped token fails with the same code.
    const bogus = await runKitchenGate({ token: crypto.randomBytes(32).toString('hex'), restaurantId });
    expect(bogus.thrown).not.toBeNull();
    expect(bogus.thrown.statusCode).toBe(401);
    expect(bogus.thrown.code).toBe('display_token_invalid');
  });

  test('publicPairingShape includes device_role (via claim response)', async () => {
    const { code } = await issueCode(restaurantId, { display_type: 'kitchen' });
    const claimed = await claimCode(code);
    expect(claimed.display.device_role).toBe('kitchen');
  });
});
