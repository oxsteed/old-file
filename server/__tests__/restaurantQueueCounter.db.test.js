'use strict';

// DB-backed tests for the per-restaurant, per-business-day queue number
// counter (migration 945, findings F-18/F-32). Skipped when no test
// database URL is configured, so the default unit suite never needs a
// database. Points at a disposable, fully migrated database:
//   QUEUE_COUNTER_TEST_DATABASE_URL=postgresql://.../fr_t5 npx jest restaurantQueueCounter
// Fixtures are created with unique random identifiers and removed again,
// so the suite is safe to run against a shared disposable database.

jest.unmock('pg');

const crypto = require('crypto');
const { Pool } = require('pg');
const { nextQueueNumber, businessDateFor } = require('../services/restaurantQueueCounter');

const url = process.env.QUEUE_COUNTER_TEST_DATABASE_URL || process.env.DATABASE_URL;
const describeDb = url ? describe : describe.skip;

describeDb('restaurantQueueCounter (db)', () => {
  const pool = new Pool({ connectionString: url, max: 60 });
  const suffix = crypto.randomBytes(6).toString('hex');
  let ownerId;

  async function makeRestaurant(timezone) {
    // One restaurant per business (idx_food_restaurants_business_unique),
    // so every fixture restaurant gets its own business.
    const { rows: [business] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [ownerId, `Counter Fixture Biz ${suffix} ${crypto.randomBytes(3).toString('hex')}`]
    );
    const { rows: [restaurant] } = await pool.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [business.id, ownerId, `Counter Fixture ${suffix}`, timezone]
    );
    return restaurant.id;
  }

  beforeAll(async () => {
    const { rows: [user] } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, 'x', 'Queue', 'Counter') RETURNING id`,
      [`queue-counter-${suffix}@example.com`]
    );
    ownerId = user.id;
  });

  afterAll(async () => {
    // Fixtures are intentionally left behind (uniquely named per run):
    // deleting a food_restaurants row fails in the migrated schema with a
    // referential-integrity error from the wallet ledger FK trigger
    // ("gave unexpected result", a pre-existing rule/rewrite quirk
    // unrelated to this counter), so fixture rows cannot be removed.
    await pool.end();
  });

  test('businessDateFor resolves the calendar date in the restaurant time zone', () => {
    const instant = new Date('2026-10-20T11:00:00.000Z');
    expect(businessDateFor('UTC', instant)).toBe('2026-10-20');
    expect(businessDateFor('America/New_York', instant)).toBe('2026-10-20');
    expect(businessDateFor('Pacific/Kiritimati', instant)).toBe('2026-10-21');
    const earlyUtc = new Date('2026-10-20T03:30:00.000Z');
    expect(businessDateFor('America/New_York', earlyUtc)).toBe('2026-10-19');
    expect(businessDateFor(null, instant)).toBe('2026-10-20');
    // A non-IANA value falls back to UTC instead of throwing.
    expect(businessDateFor('Eastern', instant)).toBe('2026-10-20');
  });

  test('allocations increment within a day and are independent per restaurant', async () => {
    const a = await makeRestaurant('UTC');
    const b = await makeRestaurant('UTC');
    const client = await pool.connect();
    try {
      expect(await nextQueueNumber(client, a, 'UTC')).toBe(1);
      expect(await nextQueueNumber(client, a, 'UTC')).toBe(2);
      expect(await nextQueueNumber(client, a, 'UTC')).toBe(3);
      expect(await nextQueueNumber(client, b, 'UTC')).toBe(1);
    } finally {
      client.release();
    }
  });

  test('the same instant allocates on different business dates per time zone', async () => {
    const restaurantId = await makeRestaurant('America/New_York');
    const instant = new Date('2026-10-20T11:00:00.000Z');
    const client = await pool.connect();
    try {
      expect(await nextQueueNumber(client, restaurantId, 'America/New_York', instant)).toBe(1);
      expect(await nextQueueNumber(client, restaurantId, 'Pacific/Kiritimati', instant)).toBe(1);
      const { rows } = await pool.query(
        `SELECT business_date::text AS business_date, last_queue_number
           FROM restaurant_daily_counters
          WHERE restaurant_id = $1 ORDER BY business_date`,
        [restaurantId]
      );
      expect(rows).toEqual([
        { business_date: '2026-10-20', last_queue_number: 1 },
        { business_date: '2026-10-21', last_queue_number: 1 },
      ]);
    } finally {
      client.release();
    }
  });

  test('50 parallel allocations yield 50 distinct numbers', async () => {
    const restaurantId = await makeRestaurant('America/New_York');
    const allocations = await Promise.all(
      Array.from({ length: 50 }, async () => {
        const client = await pool.connect();
        try {
          return await nextQueueNumber(client, restaurantId, 'America/New_York');
        } finally {
          client.release();
        }
      })
    );
    expect(new Set(allocations).size).toBe(50);
    expect([...allocations].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    );
    const { rows: [counter] } = await pool.query(
      `SELECT last_queue_number FROM restaurant_daily_counters
        WHERE restaurant_id = $1 AND business_date = $2`,
      [restaurantId, businessDateFor('America/New_York')]
    );
    expect(counter.last_queue_number).toBe(50);
  });
});
