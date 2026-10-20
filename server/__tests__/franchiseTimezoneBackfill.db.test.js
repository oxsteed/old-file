'use strict';

// F-01 (migration 941): restaurants stored as 'UTC' inherit the timezone of
// their primary location first, then of their business. Runs only against an
// explicitly opted-in disposable fr_t1 database:
//   FR_T1_TEST_DATABASE_URL=postgresql://...@127.0.0.1:5432/fr_t1
//
// Everything runs on one client inside a transaction that rolls back:
// deleting food_restaurants rows is blocked schema-wide by the wallet
// ledger's append-only rewrite rule, so fixtures must never be committed.
const fs = require('fs');
const path = require('path');

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

const suite = url ? describe : describe.skip;

suite('migration 941 restaurant timezone backfill (F-01)', () => {
  const stamp = Date.now();
  let client;
  let userId;
  let businessSeq = 0;
  let restaurantSeq = 0;

  async function makeBusiness(timezone) {
    businessSeq += 1;
    const { rows: [biz] } = await client.query(
      `INSERT INTO businesses (user_id, business_name, timezone)
       VALUES ($1, $2, $3) RETURNING id`,
      [userId, `F941 fixture ${stamp}-${businessSeq}`, timezone]
    );
    return biz.id;
  }

  async function makeRestaurant(businessId, timezone) {
    restaurantSeq += 1;
    const { rows: [restaurant] } = await client.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [businessId, userId, `F941 restaurant ${stamp}-${restaurantSeq}`, timezone]
    );
    return restaurant.id;
  }

  async function makeLocation(restaurantId, { timezone, isPrimary }) {
    await client.query(
      `INSERT INTO restaurant_locations (restaurant_id, name, timezone, is_primary)
       VALUES ($1, $2, $3, $4)`,
      [restaurantId, `F941 location ${stamp}`, timezone, isPrimary]
    );
  }

  async function timezoneOf(restaurantId) {
    const { rows: [row] } = await client.query(
      'SELECT timezone FROM food_restaurants WHERE id = $1',
      [restaurantId]
    );
    return row.timezone;
  }

  beforeAll(async () => {
    client = await db.connect();
    await client.query('BEGIN');
    const { rows: [user] } = await client.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, 'x', 'F941', 'Fixture') RETURNING id`,
      [`f941-${stamp}@example.test`]
    );
    userId = user.id;
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await db.end();
  });

  test('UTC restaurants inherit location, then business, timezones; others untouched', async () => {
    // Business timezone is used when there is no location evidence.
    const bizA = await makeBusiness('America/New_York');
    const restA = await makeRestaurant(bizA, 'UTC');

    // Primary location wins over the business timezone.
    const bizB = await makeBusiness('America/Chicago');
    const restB = await makeRestaurant(bizB, 'UTC');
    await makeLocation(restB, { timezone: 'Europe/Paris', isPrimary: true });

    // A UTC primary location does not block the business fallback, and a
    // non-primary location is never used as evidence.
    const bizC = await makeBusiness('America/Chicago');
    const restC = await makeRestaurant(bizC, 'UTC');
    await makeLocation(restC, { timezone: 'UTC', isPrimary: true });
    await makeLocation(restC, { timezone: 'Asia/Tokyo', isPrimary: false });

    // A restaurant that already has a real timezone is left alone.
    const bizD = await makeBusiness('America/New_York');
    const restD = await makeRestaurant(bizD, 'Australia/Sydney');

    // No evidence anywhere: stays UTC for the owner to confirm.
    const bizE = await makeBusiness('UTC');
    const restE = await makeRestaurant(bizE, 'UTC');

    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '941_restaurant_timezone_backfill.sql'),
      'utf8'
    );
    await client.query(sql);

    await expect(timezoneOf(restA)).resolves.toBe('America/New_York');
    await expect(timezoneOf(restB)).resolves.toBe('Europe/Paris');
    await expect(timezoneOf(restC)).resolves.toBe('America/Chicago');
    await expect(timezoneOf(restD)).resolves.toBe('Australia/Sydney');
    await expect(timezoneOf(restE)).resolves.toBe('UTC');
  });
});
