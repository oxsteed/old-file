'use strict';

/**
 * DB tests: migration 993 backfills immortal restaurant_app_devices tokens
 * (auth-audit item 17).
 *
 * Pre-786 rows carry device_token_expires_at NULL, which
 * requireDeviceCredential treats as never-expiring. Migration 993 (a)
 * backfills NULL to NOW() + 90 days for paired devices holding a token,
 * and (b) installs a column DEFAULT of NOW() + 90 days so future inserts
 * can never create a NULL-expiry row. The migration file itself is
 * idempotent, so the test re-applies it against seeded legacy rows.
 *
 * Run with:
 *   ST_T3_TEST_DATABASE_URL=<redacted> \
 *     npx jest __tests__/restaurantDeviceTokenExpiry993.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RAW_URL = process.env.ST_T3_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/st_t3';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable st_t3 database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');

jest.setTimeout(60000);

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '993_restaurant_app_device_token_expiry_backfill.sql'),
  'utf8'
);

ddescribe('device token expiry backfill (migration 993, auth-audit item 17)', () => {
  let restaurantId;

  beforeAll(async () => {
    const ownerId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
       VALUES ($1, $2, 'x', 'Device', 'Fixture', 'customer', TRUE, TRUE)`,
      [ownerId, `device-993-${ownerId}@example.invalid`]
    );
    const { rows: [biz] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [ownerId, `Device 993 ${crypto.randomUUID().slice(0, 8)}`]
    );
    const { rows: [rest] } = await pool.query(
      `INSERT INTO food_restaurants
         (business_id, owner_user_id, display_name, status, accepts_in_store_orders, fulfillment_modes)
       VALUES ($1, $2, $3, 'active', TRUE, $4::text[])
       RETURNING id`,
      [biz.id, ownerId, 'Device 993 Diner', ['pickup']]
    );
    restaurantId = Number(rest.id);
  });

  afterAll(async () => { await pool.end(); });

  function tokenHash() {
    return crypto.createHash('sha256').update(crypto.randomUUID()).digest('hex');
  }

  test('the migration backfills NULL expiries on paired token-holding devices', async () => {
    // A legacy pre-786 row: paired, has a token, NULL expiry. Explicit
    // NULL overrides the new column DEFAULT, exactly like the legacy rows.
    const { rows: [legacy] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, app_key, device_name, status, device_token_hash, device_token_expires_at, paired_at)
       VALUES ($1, 'pos', 'Legacy counter', 'paired', $2, NULL, NOW() - INTERVAL '400 days')
       RETURNING id`,
      [restaurantId, tokenHash()]
    );
    // A pending (unpaired) device keeps its NULL: it holds no credential.
    const { rows: [pending] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, app_key, device_name, status, device_token_hash, device_token_expires_at)
       VALUES ($1, 'pos', 'Pending counter', 'pending', NULL, NULL)
       RETURNING id`,
      [restaurantId]
    );

    await pool.query(MIGRATION_SQL);

    const { rows: [backfilled] } = await pool.query(
      'SELECT device_token_expires_at FROM restaurant_app_devices WHERE id = $1',
      [legacy.id]
    );
    expect(backfilled.device_token_expires_at).toBeTruthy();
    const days = (new Date(backfilled.device_token_expires_at).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);

    const { rows: [untouched] } = await pool.query(
      'SELECT device_token_expires_at FROM restaurant_app_devices WHERE id = $1',
      [pending.id]
    );
    expect(untouched.device_token_expires_at).toBeNull();
  });

  test('new inserts get a bounded expiry from the column default', async () => {
    const { rows: [device] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, app_key, device_name, status, device_token_hash, paired_at)
       VALUES ($1, 'pos', 'Fresh counter', 'paired', $2, NOW())
       RETURNING device_token_expires_at`,
      [restaurantId, tokenHash()]
    );
    expect(device.device_token_expires_at).toBeTruthy();
    const days = (new Date(device.device_token_expires_at).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });
});
