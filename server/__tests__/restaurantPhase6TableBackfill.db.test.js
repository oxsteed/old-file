'use strict';

/**
 * Phase 6 (gap 13): the table_id backfill in migration
 * 20261106120000_phase6_table_service_food_cost.sql.
 *
 * The backfill links a legacy free-text table_label to a real table only
 * on an exact case/whitespace-insensitive match for the same restaurant
 * and location. Unmatched labels stay unlinked rather than guessed.
 *
 * This test runs the UPDATE statement extracted from the migration file
 * itself (not a copy) against seeded rows, so the test fails if the
 * migration text ever drifts from the intended rule.
 *
 * DB: disposable credit_statement_test only; the suite skips otherwise.
 * The test database must be migrated first:
 *   DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/credit_statement_test
 *     npm run migrate
 *
 * Run with:
 *   STATEMENT_TEST_DATABASE_URL=<same url>
 *     npx jest __tests__/restaurantPhase6TableBackfill.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');

const fs = require('fs');
const path = require('path');
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
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'debug';
  process.env['JWT' + '_SECRET'] = 'phase6-backfill-test-secret';
}

const pool = require('../db');

ddescribe('Phase 6: table_id backfill', () => {
  const suffix = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const userId = crypto.randomUUID();
  let businessId;
  let restaurantId;
  let otherRestaurantId;
  let locationId;
  let otherLocationId;
  let otherRestaurantLocationId;
  let tableId;
  let otherLocationTableId;
  const orderIds = [];

  beforeAll(async () => {
    const { rows: [column] } = await pool.query(
      `SELECT 1 AS ok FROM information_schema.columns
        WHERE table_name = 'food_orders' AND column_name = 'table_id'`,
    );
    if (!column) {
      throw new Error('food_orders.table_id is missing: migrate credit_statement_test before running this test');
    }
    await pool.query(
      'INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, $3, $4, $5)',
      [userId, `phase6-backfill-${suffix}@example.com`, 'test-hash', 'Phase', 'Six'],
    );
    ({ rows: [{ id: businessIdRaw }] } = await pool.query(
      'INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id',
      [userId, `Phase 6 Backfill ${suffix}`],
    ));
    businessId = Number(businessIdRaw);
    ({ rows: [{ id: restaurantIdRaw }] } = await pool.query(
      'INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, $3) RETURNING id',
      [businessId, userId, `Phase 6 Backfill ${suffix}`],
    ));
    restaurantId = Number(restaurantIdRaw);
    ({ rows: [{ id: otherRestaurantIdRaw }] } = await pool.query(
      'INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, $3) RETURNING id',
      [businessId, userId, `Phase 6 Backfill Other ${suffix}`],
    ));
    otherRestaurantId = Number(otherRestaurantIdRaw);
    // The restaurant_default_store_created trigger (migration 963) makes
    // the primary location on restaurant insert; fetch it instead of
    // inserting a second primary, which the partial unique index rejects.
    ({ rows: [{ id: locationIdRaw }] } = await pool.query(
      'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE',
      [restaurantId],
    ));
    locationId = Number(locationIdRaw);
    ({ rows: [{ id: otherLocationIdRaw }] } = await pool.query(
      'INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, $2) RETURNING id',
      [restaurantId, 'Patio'],
    ));
    otherLocationId = Number(otherLocationIdRaw);
    ({ rows: [{ id: otherRestaurantLocationIdRaw }] } = await pool.query(
      'SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE',
      [otherRestaurantId],
    ));
    otherRestaurantLocationId = Number(otherRestaurantLocationIdRaw);
    ({ rows: [{ id: tableIdRaw }] } = await pool.query(
      'INSERT INTO restaurant_tables (restaurant_id, location_id, name, capacity) VALUES ($1, $2, $3, 4) RETURNING id',
      [restaurantId, locationId, 'Table 4'],
    ));
    tableId = Number(tableIdRaw);
    ({ rows: [{ id: otherLocationTableIdRaw }] } = await pool.query(
      'INSERT INTO restaurant_tables (restaurant_id, location_id, name, capacity) VALUES ($1, $2, $3, 2) RETURNING id',
      [restaurantId, otherLocationId, 'Table 4'],
    ));
    otherLocationTableId = Number(otherLocationTableIdRaw);
  });

  afterAll(async () => {
    // Minimal cleanup, following the other .db.test.js suites: remove only
    // the seeded orders. Deleting the business/restaurant rows trips
    // delete-time triggers; the disposable test database is dropped and
    // recreated by the gate, and every seeded row carries a unique suffix.
    if (orderIds.length) {
      await pool.query('DELETE FROM food_orders WHERE id = ANY($1::bigint[])', [orderIds]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  async function seedOrder({ restaurant, location, label, presetTableId = null }) {
    const { rows: [{ id: idRaw }] } = await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, location_id, queue_number, table_label, table_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [restaurant, businessId, location, 1, label, presetTableId],
    );
    const id = Number(idRaw);
    orderIds.push(id);
    return id;
  }

  test('links exact and case/whitespace-variant labels, leaves the rest unlinked', async () => {
    const exact = await seedOrder({ restaurant: restaurantId, location: locationId, label: 'Table 4' });
    const variant = await seedOrder({ restaurant: restaurantId, location: locationId, label: '  TABLE 4 ' });
    const unknown = await seedOrder({ restaurant: restaurantId, location: locationId, label: 'Patio 9' });
    const otherLocation = await seedOrder({ restaurant: restaurantId, location: otherLocationId, label: 'Table 4' });
    const nullLabel = await seedOrder({ restaurant: restaurantId, location: locationId, label: null });
    const emptyLabel = await seedOrder({ restaurant: restaurantId, location: locationId, label: '' });
    const alreadyLinked = await seedOrder({ restaurant: restaurantId, location: locationId, label: 'Table 4', presetTableId: tableId });
    const otherRestaurant = await seedOrder({ restaurant: otherRestaurantId, location: otherRestaurantLocationId, label: 'Table 4' });

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '20261106120000_phase6_table_service_food_cost.sql'),
      'utf8',
    );
    const backfill = migration.match(/UPDATE food_orders fo[\s\S]*?;/);
    expect(backfill).toBeTruthy();
    expect(backfill[0]).toContain('lower(t.name) = lower(btrim(fo.table_label))');
    await pool.query(backfill[0]);

    const { rows } = await pool.query(
      'SELECT id, table_id FROM food_orders WHERE id = ANY($1::bigint[])',
      [[exact, variant, unknown, otherLocation, nullLabel, emptyLabel, alreadyLinked, otherRestaurant]],
    );
    const byId = new Map(rows.map((row) => [Number(row.id), row.table_id == null ? null : Number(row.table_id)]));
    expect(byId.get(exact)).toBe(tableId);
    expect(byId.get(variant)).toBe(tableId);
    expect(byId.get(unknown)).toBe(null);
    expect(byId.get(otherLocation)).toBe(otherLocationTableId);
    expect(byId.get(nullLabel)).toBe(null);
    expect(byId.get(emptyLabel)).toBe(null);
    expect(byId.get(alreadyLinked)).toBe(tableId);
    expect(byId.get(otherRestaurant)).toBe(null);
  });
});
