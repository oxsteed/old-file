'use strict';

// DB-backed tests for the display pairing flow (migration 911). Honors
// STATEMENT_TEST_DATABASE_URL; skipped when the variable is absent so the
// default unit suite never needs a database. Runs in an isolated schema with
// the production migration applied.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `display_pairing_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('Display pairing fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const controller = require('../controllers/restaurantDisplayController');

const describeDb = url ? describe : describe.skip;

const OWNER_ID = 1101;
const OTHER_ID = 1102;
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

function nextFn() {
  return (err) => { throw err; };
}

async function invoke(handler, { userId, params = {}, body = {}, headers = {} }) {
  const r = res();
  let thrown = null;
  await handler(
    { user: userId ? { id: userId, role: 'user' } : undefined, params, body, headers },
    r,
    (err) => { thrown = err; }
  );
  if (thrown) {
    // Mirrors the express errorHandler: AppError maps to its status code.
    r.statusCode = thrown.statusCode || 500;
    r.body = { error: thrown.message, code: thrown.code };
  }
  return r;
}

async function issueCode(rid) {
  const r = await invoke(controller.issuePairingCode, { body: { restaurant_id: rid } });
  expect(r.statusCode).toBe(201);
  return r.body;
}

describeDb('restaurant display pairing (migration 911)', () => {
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
    // Migration 913 (device roles) is part of the same branch: the pairing
    // endpoints always read/write device_role, so the test schema must have it.
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/913_display_pairing_device_role.sql'), 'utf8'));
    // Migration 944 (F-27 pairing-token expiry/rotation): the endpoints
    // read/write the token expiry columns, so the schema must have them too.
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/944_display_pairing_token_expiry.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(__dirname, '../migrations/975_display_pairing_locations.sql'), 'utf8'));
    await require('./helpers/displayRegistryFixture').applyDisplayRegistryFixture(db, schema);
    businessId = (await db.query(`INSERT INTO ${schema}.businesses (user_id) VALUES ($1) RETURNING id`, [OWNER_ID])).rows[0].id;
    restaurantId = (
      await db.query(
        `INSERT INTO ${schema}.food_restaurants (business_id, owner_user_id, display_name)
         VALUES ($1, $2, 'Test Diner') RETURNING id`,
        [businessId, OWNER_ID]
      )
    ).rows[0].id;
    await db.query(
      `INSERT INTO ${schema}.restaurant_locations (restaurant_id, name, is_primary) VALUES ($1, 'Main store', TRUE)`,
      [restaurantId]
    );
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  async function rowById(id) {
    return (await db.query(`SELECT * FROM ${schema}.display_pairings WHERE id = $1`, [id])).rows[0];
  }

  test('issuePairingCode stores only the hash, with a 10-minute expiry', async () => {
    const { code, expires_in_seconds } = await issueCode(restaurantId);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(expires_in_seconds).toBe(600);
    const { rows } = await db.query(`SELECT * FROM ${schema}.display_pairings WHERE restaurant_id = $1`, [restaurantId]);
    const stored = rows[rows.length - 1];
    expect(stored.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.code_hash).not.toContain(code);
    expect(stored.paired_at).toBeNull();
    expect(stored.pairing_token_hash).toBeNull();
    const ttlMs = new Date(stored.expires_at).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(9 * 60 * 1000);
    // PostgreSQL stores the expiry with millisecond precision, so the query
    // can finish a few milliseconds after Date.now() samples the clock.
    expect(ttlMs).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
  });

  test('issuePairingCode rejects unknown and invalid restaurants', async () => {
    const missing = await invoke(controller.issuePairingCode, { body: { restaurant_id: 999999 } });
    expect(missing.statusCode).toBe(404);
    const bad = await invoke(controller.issuePairingCode, { body: { restaurant_id: 'nope' } });
    expect(bad.statusCode).toBe(400);
  });

  test('claim rejects bad codes and non-owners, and is single-use', async () => {
    const { code } = await issueCode(restaurantId);

    const malformed = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code: '000000', label: 'TV' } });
    expect(malformed.statusCode).toBe(400);

    const unknown = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code: 'AAAAAA', label: 'TV' } });
    expect(unknown.statusCode).toBe(404);

    const outsider = await invoke(controller.claimDisplay, { userId: OTHER_ID, body: { code, label: 'TV' } });
    expect([403, 404]).toContain(outsider.statusCode);

    const ok = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code: code.toLowerCase(), label: '  Dining room TV  ' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.body.display.label).toBe('Dining room TV');

    const stored = await rowById(ok.body.display.id);
    expect(stored.paired_at).not.toBeNull();
    expect(stored.pairing_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.pairing_token_encrypted).not.toBeNull();
    expect(stored.token_delivered_at).toBeNull();

    // Second claim of the same code fails: single-use.
    const again = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code, label: 'TV 2' } });
    expect(again.statusCode).toBe(404);
  });

  test('claim rejects expired codes', async () => {
    const { code } = await issueCode(restaurantId);
    const codeHash = crypto.createHash('sha256').update(code, 'utf8').digest('hex');
    await db.query(`UPDATE ${schema}.display_pairings SET expires_at = NOW() - INTERVAL '1 minute' WHERE code_hash = $1`, [codeHash]);
    const r = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code, label: 'TV' } });
    expect(r.statusCode).toBe(404);
  });

  test('status polls unclaimed, then delivers the token exactly once', async () => {
    const { code } = await issueCode(restaurantId);
    const before = await invoke(controller.pairingStatus, { body: { code } });
    expect(before.statusCode).toBe(200);
    expect(before.body.claimed).toBe(false);

    const claim = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code, label: 'Counter TV' } });
    expect(claim.statusCode).toBe(201);
    const ownerToken = claim.body.token;

    const delivered = await invoke(controller.pairingStatus, { body: { code } });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.body.claimed).toBe(true);
    expect(delivered.body.token).toBe(ownerToken);

    // Second poll reports paired but reveals no token.
    const again = await invoke(controller.pairingStatus, { body: { code } });
    expect(again.body.claimed).toBe(true);
    expect(again.body.token).toBeUndefined();

    const stored = await rowById(claim.body.display.id);
    expect(stored.token_delivered_at).not.toBeNull();
    expect(stored.pairing_token_encrypted).toBeNull();

    const unknown = await invoke(controller.pairingStatus, { body: { code: 'ZZZZZZ' } });
    expect(unknown.statusCode).toBe(404);
  });

  test('heartbeat updates last_seen and consumes the refresh flag', async () => {
    const { code } = await issueCode(restaurantId);
    const claim = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code, label: 'Kitchen TV' } });
    const token = claim.body.token;
    const pairingId = claim.body.display.id;

    const bad = await invoke(controller.heartbeat, { headers: { authorization: 'Bearer nope' } });
    expect(bad.statusCode).toBe(401);
    const missing = await invoke(controller.heartbeat, { headers: {} });
    expect(missing.statusCode).toBe(401);

    const hb = await invoke(controller.heartbeat, { headers: { authorization: `Bearer ${token}` } });
    expect(hb.statusCode).toBe(200);
    expect(hb.body.refresh_requested).toBe(false);
    expect(Number(hb.body.restaurant_id)).toBe(Number(restaurantId));

    const seen = (await rowById(pairingId)).last_seen_at;
    expect(seen).not.toBeNull();

    // Owner requests a refresh; the next heartbeat consumes it.
    const refresh = await invoke(controller.requestRefresh, { userId: OWNER_ID, params: { id: pairingId } });
    expect(refresh.statusCode).toBe(200);
    const hb2 = await invoke(controller.heartbeat, { headers: { authorization: `Bearer ${token}` } });
    expect(hb2.body.refresh_requested).toBe(true);
    const hb3 = await invoke(controller.heartbeat, { headers: { authorization: `Bearer ${token}` } });
    expect(hb3.body.refresh_requested).toBe(false);
  });

  test('list shows pairings with online status, scoped to owned restaurants', async () => {
    const { code } = await issueCode(restaurantId);
    const claim = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code, label: 'Lobby TV' } });
    await invoke(controller.heartbeat, { headers: { authorization: `Bearer ${claim.body.token}` } });

    const list = await invoke(controller.listPairings, { userId: OWNER_ID });
    expect(list.statusCode).toBe(200);
    const entry = list.body.displays.find((d) => d.id === claim.body.display.id);
    expect(entry).toBeDefined();
    expect(entry.label).toBe('Lobby TV');
    expect(entry.online).toBe(true);
    expect(entry.restaurant_id).toBe(Number(restaurantId));

    // Stale last_seen_at reads offline.
    await db.query(`UPDATE ${schema}.display_pairings SET last_seen_at = NOW() - INTERVAL '5 minutes' WHERE id = $1`, [claim.body.display.id]);
    const list2 = await invoke(controller.listPairings, { userId: OWNER_ID });
    expect(list2.body.displays.find((d) => d.id === claim.body.display.id).online).toBe(false);

    // A user with no restaurants sees nothing.
    const empty = await invoke(controller.listPairings, { userId: OTHER_ID });
    expect(empty.body.displays).toEqual([]);
  });

  test('refresh/unpair enforce ownership and unpair kills the token', async () => {
    const { code } = await issueCode(restaurantId);
    const claim = await invoke(controller.claimDisplay, { userId: OWNER_ID, body: { code, label: 'Patio TV' } });
    const pairingId = claim.body.display.id;

    const forbidden = await invoke(controller.requestRefresh, { userId: OTHER_ID, params: { id: pairingId } });
    expect([403, 404]).toContain(forbidden.statusCode);

    const unpair = await invoke(controller.unpairDisplay, { userId: OWNER_ID, params: { id: pairingId } });
    expect(unpair.statusCode).toBe(200);
    expect(await rowById(pairingId)).toBeUndefined();

    const hb = await invoke(controller.heartbeat, { headers: { authorization: `Bearer ${claim.body.token}` } });
    expect(hb.statusCode).toBe(401);
  });
});
