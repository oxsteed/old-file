'use strict';

// DB-backed tests for F-27: display fleet management by display.manage
// holders (not only owners) and pairing-token expiry/rotation
// (migration 944). Honors STATEMENT_TEST_DATABASE_URL; skipped when
// absent. Runs in an isolated schema with the production display
// migrations applied.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const schema = `franchise_displays_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
    throw new Error('Franchise display fixtures require a local disposable database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
process.env['DATABASE' + '_URL'] = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const controller = require('../controllers/restaurantDisplayController');

const describeDb = url ? describe : describe.skip;

const OWNER_ID = 1201;
const MANAGER_ID = 1202;
const EMPLOYEE_ID = 1203;
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
    r.statusCode = thrown.statusCode || 500;
    r.body = { error: thrown.message, code: thrown.code };
  }
  return { req, res: r };
}

async function issueCode() {
  const { res: r } = await invoke(controller.issuePairingCode, {
    body: { restaurant_id: restaurantId },
  });
  expect(r.statusCode).toBe(201);
  return r.body.code;
}

async function rowByTokenHash(hash) {
  const { rows } = await db.query(
    `SELECT * FROM ${schema}.display_pairings WHERE pairing_token_hash = $1 OR pairing_token_hash_prev = $1`,
    [hash]
  );
  return rows[0];
}

describeDb('F-27 display fleet managers and token expiry', () => {
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
    await db.query(
      `CREATE TABLE ${schema}.restaurant_location_memberships
         (id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT NOT NULL, membership_id BIGINT NOT NULL,
          location_id BIGINT NOT NULL, role_override TEXT, status TEXT NOT NULL DEFAULT 'active')`
    );
    await db.query(`CREATE TABLE ${schema}.team_roles (id BIGSERIAL PRIMARY KEY, code TEXT)`);
    await db.query(`CREATE TABLE ${schema}.team_permissions (id BIGSERIAL PRIMARY KEY, code TEXT)`);
    await db.query(
      `CREATE TABLE ${schema}.team_role_permissions
         (role_id BIGINT, permission_id BIGINT, allow BOOLEAN)`
    );
    await db.query(
      `CREATE TABLE ${schema}.membership_permission_overrides
         (id BIGSERIAL PRIMARY KEY, membership_id BIGINT, permission_id BIGINT, effect TEXT, expires_at TIMESTAMPTZ)`
    );
    for (const file of ['911_display_pairings.sql', '913_display_pairing_device_role.sql', '944_display_pairing_token_expiry.sql', '975_display_pairing_locations.sql']) {
      await db.query(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
    }

    businessId = (await db.query(`INSERT INTO ${schema}.businesses (user_id) VALUES ($1) RETURNING id`, [OWNER_ID])).rows[0].id;
    restaurantId = (
      await db.query(
        `INSERT INTO ${schema}.food_restaurants (business_id, owner_user_id, display_name)
         VALUES ($1, $2, 'Fleet Test Diner') RETURNING id`,
        [businessId, OWNER_ID]
      )
    ).rows[0].id;
    const locationId = (await db.query(
      `INSERT INTO ${schema}.restaurant_locations (restaurant_id, name, is_primary) VALUES ($1, 'Main store', TRUE) RETURNING id`,
      [restaurantId]
    )).rows[0].id;
    await db.query(
      `INSERT INTO ${schema}.business_members (business_id, member_id, role, status) VALUES ($1, $2, 'manager', 'active'), ($1, $3, 'employee', 'active')`,
      [businessId, MANAGER_ID, EMPLOYEE_ID]
    );
    await db.query(
      `INSERT INTO ${schema}.restaurant_location_memberships (restaurant_id, membership_id, location_id)
       SELECT $1, id, $2 FROM ${schema}.business_members WHERE business_id = $3 AND member_id = $4`,
      [restaurantId, locationId, businessId, MANAGER_ID]
    );
    const { rows: roles } = await db.query(
      `INSERT INTO ${schema}.team_roles (code) VALUES ('owner'), ('manager'), ('employee') RETURNING id, code`
    );
    const { rows: perms } = await db.query(
      `INSERT INTO ${schema}.team_permissions (code) VALUES ('display.manage'), ('orders.view') RETURNING id, code`
    );
    const managerRole = roles.find((r) => r.code === 'manager');
    const displayManage = perms.find((p) => p.code === 'display.manage');
    await db.query(
      `INSERT INTO ${schema}.team_role_permissions (role_id, permission_id, allow) VALUES ($1, $2, TRUE)`,
      [managerRole.id, displayManage.id]
    );
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA ${schema} CASCADE`);
  });

  test('a manager with display.manage can claim, and the token gets a 90-day expiry', async () => {
    const code = await issueCode();
    const { res: r } = await invoke(controller.claimDisplay, {
      userId: MANAGER_ID,
      body: { code, label: 'Kitchen TV' },
    });
    expect(r.statusCode).toBe(201);
    expect(r.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.display.token_expires_at).toBeTruthy();
    const expiresMs = new Date(r.body.display.token_expires_at).getTime();
    expect(expiresMs).toBeGreaterThan(Date.now() + 80 * 24 * 3600 * 1000);
    expect(expiresMs).toBeLessThan(Date.now() + 91 * 24 * 3600 * 1000);
  });

  test('an employee without display.manage cannot claim', async () => {
    const code = await issueCode();
    const { res: r } = await invoke(controller.claimDisplay, {
      userId: EMPLOYEE_ID,
      body: { code, label: 'Lobby TV' },
    });
    expect(r.statusCode).toBe(403);
  });

  test('verifyDisplayPairingToken rejects an expired token', async () => {
    const code = await issueCode();
    const { res: claim } = await invoke(controller.claimDisplay, {
      userId: OWNER_ID,
      body: { code, label: 'Expiring TV' },
    });
    const token = claim.body.token;
    const valid = await controller.verifyDisplayPairingToken(token);
    expect(valid).toBeTruthy();
    await db.query(
      `UPDATE ${schema}.display_pairings SET pairing_token_expires_at = NOW() - INTERVAL '1 hour'
        WHERE pairing_token_hash = $1`,
      [controller._test.hashSecret(token)]
    );
    const expired = await controller.verifyDisplayPairingToken(token);
    expect(expired).toBeNull();
  });

  test('heartbeat rotates a token inside its final week and the old token keeps working', async () => {
    const code = await issueCode();
    const { res: claim } = await invoke(controller.claimDisplay, {
      userId: OWNER_ID,
      body: { code, label: 'Rotating TV' },
    });
    const oldToken = claim.body.token;
    await db.query(
      `UPDATE ${schema}.display_pairings SET pairing_token_expires_at = NOW() + INTERVAL '3 days'
        WHERE pairing_token_hash = $1`,
      [controller._test.hashSecret(oldToken)]
    );
    const { res: beat } = await invoke(controller.heartbeat, {
      headers: { authorization: `Bearer ${oldToken}` },
    });
    expect(beat.statusCode).toBe(200);
    expect(beat.body.rotated_token).toMatch(/^[0-9a-f]{64}$/);
    expect(beat.body.rotated_token).not.toBe(oldToken);
    // The rotated-out token remains valid until its original expiry.
    const oldStillValid = await controller.verifyDisplayPairingToken(oldToken);
    expect(oldStillValid).toBeTruthy();
    expect(oldStillValid.usedPreviousToken).toBe(true);
    const newValid = await controller.verifyDisplayPairingToken(beat.body.rotated_token);
    expect(newValid).toBeTruthy();
    expect(newValid.usedPreviousToken).toBe(false);
  });

  test('heartbeat adopts an expiry for legacy tokens without rotating them', async () => {
    const code = await issueCode();
    const { res: claim } = await invoke(controller.claimDisplay, {
      userId: OWNER_ID,
      body: { code, label: 'Legacy TV' },
    });
    const token = claim.body.token;
    await db.query(
      `UPDATE ${schema}.display_pairings SET pairing_token_expires_at = NULL
        WHERE pairing_token_hash = $1`,
      [controller._test.hashSecret(token)]
    );
    const { res: beat } = await invoke(controller.heartbeat, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(beat.statusCode).toBe(200);
    expect(beat.body.rotated_token).toBeUndefined();
    expect(beat.body.token_expires_at).toBeTruthy();
    const row = await rowByTokenHash(controller._test.hashSecret(token));
    expect(row.pairing_token_expires_at).toBeTruthy();
  });

  test('manager can list (with last_seen and expiry), refresh and unpair', async () => {
    const code = await issueCode();
    const { res: claim } = await invoke(controller.claimDisplay, {
      userId: MANAGER_ID,
      body: { code, label: 'Fleet TV' },
    });
    expect(claim.statusCode).toBe(201);
    const displayId = claim.body.display.id;

    const { res: list } = await invoke(controller.listPairings, { userId: MANAGER_ID });
    expect(list.statusCode).toBe(200);
    const mine = list.body.displays.find((d) => d.id === displayId);
    expect(mine).toBeTruthy();
    expect(mine).toHaveProperty('last_seen_at');
    expect(mine.token_expires_at).toBeTruthy();

    const { res: refresh } = await invoke(controller.requestRefresh, {
      userId: MANAGER_ID,
      params: { id: String(displayId) },
    });
    expect(refresh.statusCode).toBe(200);

    const { res: refreshDenied } = await invoke(controller.requestRefresh, {
      userId: EMPLOYEE_ID,
      params: { id: String(displayId) },
    });
    expect(refreshDenied.statusCode).toBe(403);

    const { res: unpair } = await invoke(controller.unpairDisplay, {
      userId: MANAGER_ID,
      params: { id: String(displayId) },
    });
    expect(unpair.statusCode).toBe(200);
    const { res: listAfter } = await invoke(controller.listPairings, { userId: MANAGER_ID });
    expect(listAfter.body.displays.find((d) => d.id === displayId)).toBeUndefined();
  });
});
