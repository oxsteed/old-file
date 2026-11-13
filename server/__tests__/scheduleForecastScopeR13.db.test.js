'use strict';

/**
 * DB test: money-flows audit R13 (2026-11-07) — the schedule
 * forecast ignores the restaurant and location it is asked for.
 *
 * Repro: one business with two restaurants (A, B). Draft shifts in
 * both. A restaurant-scoped forecast for A must count only A's
 * shifts; a location-scoped request must count only that location's
 * shifts. Before the fix the draft-shift query filters only
 * business_id, so every scope returns the business-wide forecast.
 *
 * Run with:
 *   DATABASE_URL=STATEMENT_TEST_DATABASE_URL=STATEMENT_JOB_TEST_DATABASE_URL=STATEMENT_INVESTIGATION_TEST_DATABASE_URL=ADMIN_GRANT_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     STATEMENT_REQUIRE_DB_TESTS=true npx jest __tests__/scheduleForecastScopeR13.db.test.js --runInBand --forceExit
 * Without it, the DB describes skip (fail closed), same pattern as
 * restaurantPunchCloseoutBatchLimit.db.test.js.
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/credit_statement_test';
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable credit_statement_test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = process.env.STATEMENT_TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const { computeScheduleForecast } = require('../services/scheduleForecast');

jest.setTimeout(120000);

const RUN = crypto.randomUUID().slice(0, 8);
const FROM = '2026-11-02';
const TO = '2026-11-08';

async function newUser(label) {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active)
     VALUES ($1, $2, 'x', 'Forecast', $3, 'customer', TRUE, TRUE)`,
    [id, `r13-${label}-${id}@example.invalid`, label]
  );
  return id;
}

ddescribe('Money flows R13: forecast respects restaurant and location scope', () => {
  let businessId;
  let restaurantA;
  let restaurantB;
  let locationA1;
  let locationA2;
  let workerId;

  beforeAll(async () => {
    const owner = await newUser(`owner-${RUN}`);
    workerId = await newUser(`worker-${RUN}`);
    const { rows: [b] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name, timezone) VALUES ($1, $2, $3) RETURNING id',
      [owner, `R13 Bistro ${RUN}`, 'UTC']
    );
    businessId = Number(b.id);
    const mkRestaurant = async (name) => {
      const { rows: [r] } = await pool.query(
        `INSERT INTO food_restaurants (business_id, owner_user_id, display_name, timezone, currency_code)
         VALUES ($1, $2, $3, 'UTC', 'USD') RETURNING id`,
        [businessId, owner, name]
      );
      return Number(r.id);
    };
    restaurantA = await mkRestaurant(`R13 A ${RUN}`);
    restaurantB = await mkRestaurant(`R13 B ${RUN}`);
    const mkLocation = async (restaurantId, name) => {
      const { rows: [loc] } = await pool.query(
        `INSERT INTO restaurant_locations
           (restaurant_id, name, address_country, address_state, timezone, currency_code, is_primary)
         VALUES ($1, $2, 'US', 'OH', 'UTC', 'USD', FALSE) RETURNING id`,
        [restaurantId, name]
      );
      return Number(loc.id);
    };
    locationA1 = await mkLocation(restaurantA, `R13 A1 ${RUN}`);
    locationA2 = await mkLocation(restaurantA, `R13 A2 ${RUN}`);
    const locationB1 = await mkLocation(restaurantB, `R13 B1 ${RUN}`);
    // Wage of record for the worker: $20/h.
    await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, job_role, hourly_wage_cents)
       VALUES ($1, $2, $3, 'employee', $4, 'active', 'Server', 2000)`,
      [businessId, owner, workerId, `r13-worker-${RUN}@example.invalid`]
    );
    // Draft shifts (published_at NULL): one per store, distinct days.
    const mkShift = async (restaurantId, locationId, date) => {
      await pool.query(
        `INSERT INTO business_staff_shifts
           (business_id, user_id, shift_date, start_time, end_time, role_label, restaurant_id, location_id)
         VALUES ($1, $2, $3::date, '09:00'::time, '17:00'::time, 'Server', $4, $5)`,
        [businessId, workerId, date, restaurantId, locationId]
      );
    };
    await mkShift(restaurantA, locationA1, '2026-11-02');
    await mkShift(restaurantA, locationA2, '2026-11-03');
    await mkShift(restaurantB, locationB1, '2026-11-04');
  });

  afterAll(async () => {
    await pool.end().catch(() => {});
  });

  test('a restaurant-scoped forecast excludes sibling restaurants', async () => {
    const forecast = await computeScheduleForecast(pool, {
      businessId, from: FROM, to: TO, restaurantId: restaurantA,
    });
    expect(forecast.draft_shift_count).toBe(2);
    expect(forecast.total_hours).toBe(16);
  });

  test('a location-scoped forecast returns only that location', async () => {
    const forecast = await computeScheduleForecast(pool, {
      businessId, from: FROM, to: TO, restaurantId: restaurantA, locationId: locationA1,
    });
    expect(forecast.draft_shift_count).toBe(1);
    expect(forecast.total_hours).toBe(8);
  });

  test('an unscoped forecast still covers the whole business', async () => {
    const forecast = await computeScheduleForecast(pool, {
      businessId, from: FROM, to: TO,
    });
    expect(forecast.draft_shift_count).toBe(3);
    expect(forecast.total_hours).toBe(24);
  });
});
