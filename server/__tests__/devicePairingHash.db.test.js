'use strict';

/**
 * Hashed app-device pairing codes (auth-audit finding 40).
 *
 * Migration 335 stored restaurant_app_devices.pairing_code in plaintext.
 * The create/pair flow now mirrors the display flow: only the SHA-256 hash
 * (of the upper-cased code) is persisted, the raw code is returned once to
 * the caller, and pairDevice matches on the hash.
 *
 * DB-backed against an isolated schema with a minimal
 * restaurant_app_devices table; the auth helpers are stubbed so the test
 * exercises the real controller SQL. Skipped without
 * STATEMENT_TEST_DATABASE_URL.
 */

const crypto = require('crypto');

const schema = `pairhash_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Pairing-hash fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

jest.mock('../services/scopeModel', () => ({
  resolveRestaurantAccess: jest.fn(async (_userId, restaurantId) => ({
    id: Number(restaurantId),
    business_id: 1,
    display_name: 'Hash Test Diner',
    settings: {},
  })),
}));
jest.mock('../services/permissionsService', () => {
  const actual = jest.requireActual('../services/permissionsService');
  return { ...actual, hasRestaurantPermission: jest.fn(async () => true) };
});

const db = require('../db');
const controller = require('../controllers/restaurantAppFlowController');

const describeDb = url ? describe : describe.skip;
const RESTAURANT_ID = 4242;

function invoke(handler, { params = {}, body = {}, userId = 'user-1' }) {
  const req = {
    user: { id: userId },
    params,
    body,
    headers: {},
    get: () => undefined,
    ip: '127.0.0.1',
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  return (async () => {
    let thrown = null;
    await handler(req, res, (err) => { thrown = err; });
    if (thrown) {
      res.statusCode = thrown.statusCode || thrown.status || 500;
      res.body = { error: thrown.message, code: thrown.code };
    }
    return { req, res };
  })();
}

describeDb('finding 40: pairing codes are hashed at rest', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`
      CREATE TABLE ${schema}.restaurant_app_devices (
        id BIGSERIAL PRIMARY KEY,
        restaurant_id BIGINT NOT NULL,
        app_key VARCHAR(32) NOT NULL,
        device_name VARCHAR(160),
        mode VARCHAR(64),
        location_id BIGINT,
        pairing_code VARCHAR(24),
        pairing_code_hash VARCHAR(64),
        pairing_code_expires_at TIMESTAMPTZ,
        config JSONB,
        status VARCHAR(24) NOT NULL DEFAULT 'pending',
        paired_at TIMESTAMPTZ,
        last_seen_at TIMESTAMPTZ,
        device_token_hash VARCHAR(128),
        device_token_expires_at TIMESTAMPTZ,
        app_version VARCHAR(80),
        platform VARCHAR(80),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  test('create stores the hash, never the plaintext code', async () => {
    const { res } = await invoke(controller.createDevicePairingCode, {
      params: { restaurantId: String(RESTAURANT_ID) },
      body: { appKey: 'kitchen', deviceName: 'Hash KDS' },
    });
    expect(res.statusCode).toBe(201);
    const code = res.body.pairingCode || res.body.pairing_code;
    expect(code).toMatch(/^[0-9A-F]{12}$/);

    const { rows: [row] } = await db.query(
      `SELECT pairing_code, pairing_code_hash FROM restaurant_app_devices WHERE restaurant_id = $1`,
      [RESTAURANT_ID]
    );
    expect(row.pairing_code).toBeNull();
    expect(row.pairing_code_hash).toBe(
      crypto.createHash('sha256').update(code.toUpperCase()).digest('hex')
    );
  });

  test('pair matches on the hash and clears it; a wrong code 404s', async () => {
    const { res: created } = await invoke(controller.createDevicePairingCode, {
      params: { restaurantId: String(RESTAURANT_ID) },
      body: { appKey: 'kitchen', deviceName: 'Hash KDS 2' },
    });
    const code = created.body.pairingCode || created.body.pairing_code;

    const bad = await invoke(controller.pairDevice, {
      params: { restaurantId: String(RESTAURANT_ID) },
      body: { pairingCode: 'FFFF0000FFFF' },
    });
    expect(bad.res.statusCode).toBe(404);

    const { res: paired } = await invoke(controller.pairDevice, {
      params: { restaurantId: String(RESTAURANT_ID) },
      body: { pairingCode: code.toLowerCase() }, // normalization is case-insensitive
    });
    expect(paired.statusCode).toBe(200);
    expect(paired.body.deviceToken || paired.body.device_token).toBeTruthy();

    const { rows: [row] } = await db.query(
      `SELECT status, pairing_code, pairing_code_hash, device_token_hash
         FROM restaurant_app_devices WHERE restaurant_id = $1 AND device_name = 'Hash KDS 2'`,
      [RESTAURANT_ID]
    );
    expect(row.status).toBe('paired');
    expect(row.pairing_code).toBeNull();
    expect(row.pairing_code_hash).toBeNull();
    expect(row.device_token_hash).toBeTruthy();
  });
});
