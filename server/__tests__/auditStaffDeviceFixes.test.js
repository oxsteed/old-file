'use strict';

/**
 * Auth-audit 2026-10-31 items 9, 13, 14 (staff/device track).
 *
 * Item 9: NULL-device staff sessions stay unbound by design (binding to
 * the issuing account or the PIN owner breaks tested shared-terminal
 * flows), so they get a shorter TTL instead: 5 idle minutes / 1-hour
 * cap, capped below any restaurant-configured policy.
 * Item 13: digest-miss guesses on the device-less path count in a
 * per-restaurant bucket and lock device-less PIN entry after 5 in
 * 15 minutes, mirroring the device/PIN lockout shape.
 * Item 14: device-token expiry is required; the NULL-means-immortal arm
 * is dropped from both app-device predicates. Display-pairing expiry
 * arms are deliberately untouched (different credential, out of scope).
 *
 * No DB needed: the service pool and the credential clients are mocked.
 */

jest.mock('../db', () => ({ query: jest.fn() }));

const crypto = require('crypto');
const pool = require('../db');
const {
  createStaffSession,
  resolveStaffSession,
  validateStaffPinForRestaurant,
} = require('../services/restaurantStaffIdentityService');
const {
  authenticateAppDevice,
  authenticateRegistryDevice,
} = require('../services/restaurantDeviceCredentials');

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

describe('auth-audit item 9: unbound sessions get a shorter TTL', () => {
  const pinRow = { id: 11, staff_user_id: null, staff_label: 'Counter', role_label: null };

  beforeEach(() => {
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [{ id: 99 }] });
  });

  test('NULL-device session is capped to 5 idle minutes / 1-hour cap', async () => {
    const { idleMinutes, maxHours } = await createStaffSession({
      restaurantId: 7,
      deviceId: null,
      pinRow,
    });
    expect(idleMinutes).toBe(5);
    expect(maxHours).toBe(1);
    const [, params] = pool.query.mock.calls[0];
    expect(params[6]).toBe('5');
    expect(JSON.parse(params[7]).maxHours).toBe(1);
  });

  test('NULL-device cap applies below a generous restaurant policy', async () => {
    const { idleMinutes, maxHours } = await createStaffSession({
      restaurantId: 7,
      deviceId: null,
      pinRow,
      settings: { staffSessionIdleMinutes: 30, staffSessionMaxHours: 24 },
    });
    expect(idleMinutes).toBe(5);
    expect(maxHours).toBe(1);
  });

  test('device-bound session keeps the restaurant policy', async () => {
    const { idleMinutes, maxHours } = await createStaffSession({
      restaurantId: 7,
      deviceId: 3,
      pinRow,
      settings: { staffSessionIdleMinutes: 30, staffSessionMaxHours: 24 },
    });
    expect(idleMinutes).toBe(30);
    expect(maxHours).toBe(24);
    const [, params] = pool.query.mock.calls[0];
    expect(params[6]).toBe('30');
  });

  test('NULL-device session still resolves (short-lived, not broken)', async () => {
    const token = 'unbound-token';
    const now = new Date();
    pool.query.mockResolvedValue({
      rows: [{
        id: 5,
        token_hash: sessionTokenHash(token),
        restaurant_id: 7,
        device_id: null,
        staff_user_id: null,
        ended_at: null,
        expires_at: new Date(now.getTime() + 5 * 60 * 1000),
        last_activity_at: now,
        created_at: now,
        metadata: { idleMinutes: 5, maxHours: 1 },
      }],
    });
    const req = {
      get: (header) => (header === 'X-Staff-Session' ? token : undefined),
      body: {},
      restaurantDevice: undefined,
    };
    const session = await resolveStaffSession(req, 7);
    expect(session).toBeTruthy();
    expect(session.device_id).toBeNull();
  });
});

describe('auth-audit item 13: device-less digest-miss lockout', () => {
  let bucketFailures;
  let inserts;

  function routeQuery(sql) {
    if (sql.startsWith('INSERT INTO restaurant_staff_pin_attempts')) {
      inserts.push(sql);
      return { rows: [] };
    }
    if (sql.includes('COUNT(*)') && sql.includes('restaurant_staff_pin_attempts')) {
      return { rows: [{ failures: bucketFailures }] };
    }
    if (sql.includes('pin_digest IS NULL')) return { rows: [] };
    if (sql.includes('pin_digest')) return { rows: [] };
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  }

  beforeEach(() => {
    bucketFailures = 0;
    inserts = [];
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('COUNT(*)')) return Promise.resolve(routeQuery(sql));
      if (sql.startsWith('INSERT INTO restaurant_staff_pin_attempts')) {
        inserts.push(params);
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('pin_digest IS NULL')) return Promise.resolve({ rows: [] });
      if (sql.includes('pin_digest')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    });
  });

  test('a device-less digest-miss records a NULL/NULL attempt and 401s', async () => {
    await expect(
      validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: null })
    ).rejects.toMatchObject({ code: 'invalid_pin' });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual([7, null, null, false]);
  });

  test('five misses then a 429: the restaurant bucket locks device-less entry', async () => {
    for (let i = 0; i < 5; i += 1) {
      bucketFailures = i;
      await expect(
        validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: null })
      ).rejects.toMatchObject({ code: 'invalid_pin' });
    }
    bucketFailures = 5;
    const callsBefore = pool.query.mock.calls.length;
    try {
      await validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: null });
      throw new Error('expected 429');
    } catch (err) {
      expect(err.code).toBe('pin_locked');
      expect(err.fields?.scope).toBe('restaurant');
    }
    // The locked call makes only the bucket check: no digest lookup, no insert.
    expect(pool.query.mock.calls.length - callsBefore).toBe(1);
  });

  test('device-present digest-miss still uses the device bucket, not the restaurant bucket', async () => {
    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('COUNT(*)') && sql.includes('device_id = $2')) {
        return Promise.resolve({ rows: [{ failures: 0 }] });
      }
      if (sql.startsWith('INSERT INTO restaurant_staff_pin_attempts')) {
        inserts.push(params);
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('pin_digest IS NULL')) return Promise.resolve({ rows: [] });
      if (sql.includes('pin_digest')) return Promise.resolve({ rows: [] });
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    });
    await expect(
      validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: 9 })
    ).rejects.toMatchObject({ code: 'invalid_pin' });
    const bucketSelects = pool.query.mock.calls.filter(
      ([sql]) => sql.includes('COUNT(*)') && sql.includes('staff_pin_id IS NULL')
    );
    expect(bucketSelects).toHaveLength(0);
    expect(inserts).toEqual([[7, 9, null, false]]);
  });
});

describe('auth-audit item 14: device-token expiry is required', () => {
  function capturingClient(row) {
    const queries = [];
    return {
      queries,
      query: jest.fn((sql, params) => {
        queries.push(sql);
        return Promise.resolve({ rows: row ? [row] : [] });
      }),
    };
  }

  test('app-device predicate requires expiry (no NULL arm)', async () => {
    const client = capturingClient({ id: 3 });
    await authenticateAppDevice(client, { restaurantId: 7, deviceId: 3, token: 't' });
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toContain('device_token_expires_at>NOW()');
    expect(client.queries[0]).not.toContain('device_token_expires_at IS NULL');
  });

  test('registry app-device arm requires expiry; pairing arms untouched', async () => {
    const client = capturingClient({ id: 4 });
    await authenticateRegistryDevice(client, { restaurantId: 7, registryId: 4, token: 't' });
    expect(client.queries).toHaveLength(1);
    expect(client.queries[0]).toContain('device_token_expires_at>NOW()');
    expect(client.queries[0]).not.toContain('device_token_expires_at IS NULL');
    // Display-pairing expiry arms are a different credential and out of scope.
    expect(client.queries[0]).toContain('pairing_token_expires_at IS NULL');
  });

  test('no matching device still 401s', async () => {
    const client = capturingClient(null);
    await expect(
      authenticateAppDevice(client, { restaurantId: 7, deviceId: 3, token: 't' })
    ).rejects.toMatchObject({ code: 'invalid_device_credential' });
  });
});
