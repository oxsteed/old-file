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
 * Domain 6 finding 8: the item-13 digest-miss bucket gains a success
 * reset, so a successful device-less PIN entry clears the bucket instead
 * of 5 blind guesses locking every device-less terminal restaurant-wide.
 *
 * No DB needed: the service pool and the credential clients are mocked.
 */

jest.mock('../db', () => ({ query: jest.fn() }));

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../db');
const {
  createStaffSession,
  resolveStaffSession,
  resolveActingStaff,
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

describe('device-bound staff identity', () => {
  test('device location lookup failures do not become an unscoped session', async () => {
    const token = 'device-token';
    const now = new Date();
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM restaurant_staff_sessions')) {
        return Promise.resolve({ rows: [{
          id: 8,
          token_hash: sessionTokenHash(token),
          restaurant_id: 7,
          device_id: 31,
          staff_user_id: null,
          ended_at: null,
          expires_at: new Date(now.getTime() + 5 * 60 * 1000),
          last_activity_at: now,
          created_at: now,
          metadata: {},
        }] });
      }
      if (sql.includes('FROM restaurant_app_devices')) {
        return Promise.reject(new Error('database connection lost'));
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    });

    const req = {
      get: (header) => (header === 'X-Staff-Session' ? token : undefined),
      body: {},
      restaurantDevice: { id: 31 },
    };
    await expect(resolveActingStaff(req, 7)).rejects.toMatchObject({
      message: 'database connection lost',
    });
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

describe('auth-audit Domain 6 finding 8: device-less digest-miss bucket resets on success', () => {
  // Domain 6 finding 8 (2026-11-09 audit): the item-13 digest-miss bucket
  // is per-restaurant NULL/NULL with no success reset, so 5 blind guesses
  // lock ALL device-less PIN entry restaurant-wide for 15 minutes. A
  // digest-miss carries no account identity (the PIN matched nothing), so
  // per-account scoping is impossible; the fix is a success reset: a
  // successful device-less PIN entry records a NULL/NULL success marker,
  // and the bucket counts only failures after the latest such marker
  // (mirroring the success-reset the device/PIN buckets already have in
  // recentPinFailures). The 5-failure lockout itself is unchanged.
  let pinHash;
  let attempts;
  let inserts;
  let seq;

  function maxSuccessSeq() {
    let max = -1;
    for (const row of attempts) {
      if (row.deviceId === null && row.staffPinId === null && row.success === true) {
        max = Math.max(max, row.seq);
      }
    }
    return max;
  }

  beforeEach(async () => {
    pinHash = await bcrypt.hash('1234', 4);
    attempts = [];
    inserts = [];
    seq = 0;
    pool.query.mockReset();
    pool.query.mockImplementation((sql, params = []) => {
      if (sql.startsWith('INSERT INTO restaurant_staff_pin_attempts')) {
        seq += 1;
        attempts.push({
          deviceId: params[1],
          staffPinId: params[2],
          success: params[3],
          seq,
        });
        inserts.push(params);
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('COUNT(*)') && sql.includes('staff_pin_id IS NULL')) {
        // Digest-miss bucket. The mock applies the success reset only
        // when the executed SQL carries the reset clause (a subquery on
        // the latest NULL/NULL success), so the test fails against the
        // pre-fix query and passes against the fixed one.
        const resetAt = sql.includes('success = TRUE') ? maxSuccessSeq() : -1;
        const failures = attempts.filter(
          (row) =>
            row.deviceId === null &&
            row.staffPinId === null &&
            row.success === false &&
            row.seq > resetAt
        ).length;
        return Promise.resolve({ rows: [{ failures }] });
      }
      if (sql.includes('COUNT(*)') && sql.includes('staff_pin_id = $2')) {
        const pinId = params[1];
        let resetAt = -1;
        for (const row of attempts) {
          if (row.staffPinId === pinId && row.success === true) resetAt = Math.max(resetAt, row.seq);
        }
        const failures = attempts.filter(
          (row) => row.staffPinId === pinId && row.success === false && row.seq > resetAt
        ).length;
        return Promise.resolve({ rows: [{ failures }] });
      }
      if (sql.includes('COUNT(*)') && sql.includes('device_id = $2')) {
        return Promise.resolve({ rows: [{ failures: 0 }] });
      }
      if (sql.includes('pin_digest IS NULL')) {
        // Legacy bcrypt-scan path: the only legacy row owns PIN 1234.
        return Promise.resolve({
          rows: [{ id: 11, staff_user_id: null, staff_label: 'Counter', role_label: null, pin_hash: pinHash }],
        });
      }
      if (sql.includes('pin_digest')) return Promise.resolve({ rows: [] });
      if (sql.startsWith('UPDATE restaurant_staff_pins SET pin_digest')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    });
  });

  test('a successful device-less PIN entry resets the digest-miss bucket', async () => {
    for (let i = 0; i < 4; i += 1) {
      await expect(
        validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: null })
      ).rejects.toMatchObject({ code: 'invalid_pin' });
    }
    const ok = await validateStaffPinForRestaurant({ restaurantId: 7, pin: '1234', deviceId: null });
    expect(ok.pinRow.id).toBe(11);
    // The success records a NULL/NULL success marker alongside the
    // PIN-scoped success row, so the bucket can reset.
    expect(inserts).toContainEqual([7, null, null, true]);
    // Four more blind misses after the success must NOT lock: pre-fix the
    // second one already 429s because the bucket still holds 5+ failures.
    for (let i = 0; i < 4; i += 1) {
      await expect(
        validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: null })
      ).rejects.toMatchObject({ code: 'invalid_pin' });
    }
    // The correct PIN still works with 4 post-reset failures banked.
    const okAgain = await validateStaffPinForRestaurant({ restaurantId: 7, pin: '1234', deviceId: null });
    expect(okAgain.pinRow.id).toBe(11);
  });

  test('the 5-failure lockout still fires after the reset', async () => {
    await validateStaffPinForRestaurant({ restaurantId: 7, pin: '1234', deviceId: null });
    for (let i = 0; i < 5; i += 1) {
      await expect(
        validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: null })
      ).rejects.toMatchObject({ code: 'invalid_pin' });
    }
    await expect(
      validateStaffPinForRestaurant({ restaurantId: 7, pin: '0000', deviceId: null })
    ).rejects.toMatchObject({ code: 'pin_locked' });
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
