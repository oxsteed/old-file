'use strict';

// Customer 360 upgrade 7 on PostgreSQL: derived lifecycle stages, stage
// change events, sweep cursor, cohort aggregates and small-cell suppression.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const lifecycle = require('../services/customer360Lifecycle');

jest.setTimeout(180000);

test('distribution suppresses small cohorts and small cells', () => {
  expect(lifecycle.distribution({ active: 9 })).toMatchObject({ total: null, suppressed: true });
  const d = lifecycle.distribution({ active: 30, dormant: 5, new: 15 });
  expect(d.total).toBe(50);
  expect(d.stages.active).toEqual({ count: 30, share: 60 });
  expect(d.stages.dormant).toEqual({ count: null, share: null, suppressed: true });
  expect(d.stages.lapsing).toEqual({ count: 0, share: 0 });
});

test('lifecycle DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 lifecycle and cohorts', () => {
  let pool;
  const country = 'Q' + String.fromCharCode(65 + Math.floor(Math.random() * 26)); // synthetic, avoids real data
  async function user({ age = 400, deleted = false, role = 'customer' } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, country, created_at, deleted_at)
       VALUES ($1, $2, 'x', 'Life', 'Cycle', $3, $4, CASE WHEN $5::int < 30 THEN NOW() - ($5::int * INTERVAL '1 day') ELSE date_trunc('month', NOW() - ($5::int * INTERVAL '1 day')) + INTERVAL '1 day' END, $6)`,
      [id, `c360-life-${id}@example.invalid`, role, country, age, deleted ? new Date() : null]);
    return id;
  }
  async function order(customerId, daysAgo) {
    const { rows: [r] } = await pool.query(
      `SELECT fr.id AS rid, fr.business_id FROM food_restaurants fr JOIN restaurant_locations l ON l.restaurant_id = fr.id LIMIT 1`);
    await pool.query(
      `INSERT INTO food_orders (restaurant_id, business_id, customer_id, status, payment_status, total_cents, queue_number, created_at)
       VALUES ($1, $2, $3, 'completed', 'paid', 1000, $4, NOW() - ($5::int * INTERVAL '1 day'))`,
      [r.rid, r.business_id, customerId, 50000 + Math.floor(Math.random() * 1e6), daysAgo]);
  }
  beforeAll(async () => {
    pool = require('../db');
    const { rows } = await pool.query(`SELECT 1 FROM food_restaurants fr JOIN restaurant_locations l ON l.restaurant_id = fr.id LIMIT 1`);
    if (!rows.length) {
      const owner = crypto.randomUUID();
      await pool.query(`INSERT INTO users (id, email, password_hash, first_name, last_name) VALUES ($1, $2, 'x', 'O', 'W')`, [owner, `c360-life-owner-${owner}@example.invalid`]);
      const { rows: [b] } = await pool.query(`INSERT INTO businesses (user_id, business_name) VALUES ($1, 'Life Grill') RETURNING id`, [owner]);
      const { rows: [r] } = await pool.query(`INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'Life Grill') RETURNING id`, [b.id, owner]);
      await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Main')`, [r.id]);
    }
  });
  afterAll(async () => { await pool.end?.(); });

  test('stages derive from signup and transactions; changes become events', async () => {
    const fresh = await user({ age: 5 });
    const never = await user({ age: 120 });
    const active = await user(); await order(active, 3);
    const lapsing = await user(); await order(lapsing, 45);
    const dormant = await user(); await order(dormant, 200);
    const closed = await user({ deleted: true });
    const staff = await user({ role: 'admin' });
    const changed = await lifecycle.computeBatch([fresh, never, active, lapsing, dormant, closed, staff]);
    expect(changed).toEqual([]); // first computation is not a change
    const { rows } = await pool.query(`SELECT customer_id, stage, transactions_90d, cohort_month FROM customer_lifecycle WHERE customer_id = ANY($1::uuid[])`,
      [[fresh, never, active, lapsing, dormant, closed, staff]]);
    const by = Object.fromEntries(rows.map((r) => [r.customer_id, r]));
    expect(by[fresh].stage).toBe('new');
    expect(by[never].stage).toBe('never_activated');
    expect(by[active]).toMatchObject({ stage: 'active', transactions_90d: 1 });
    expect(by[lapsing].stage).toBe('lapsing');
    expect(by[dormant]).toMatchObject({ stage: 'dormant', transactions_90d: 0 });
    expect(by[closed].stage).toBe('closed');
    expect(by[staff]).toBeUndefined();
    expect(by[active].cohort_month.getDate()).toBe(1);

    await order(dormant, 1);
    const again = await lifecycle.computeBatch([dormant, active]);
    expect(again).toEqual([expect.objectContaining({ customer_id: dormant, stage: 'active', previous: 'dormant' })]);
    const { rows: ev } = await pool.query(`SELECT changes FROM customer_events WHERE customer_id = $1 AND event_type = 'lifecycle.stage_changed'`, [dormant]);
    expect(ev).toEqual([{ changes: { stage: { from: 'dormant', to: 'active' } } }]);
    const present = lifecycle.present(await lifecycle.current(dormant));
    expect(present).toMatchObject({ state: 'ready', stage: 'active', factors: { daysSinceLastTransaction: 1 } });
  });

  test('cohort stats aggregate and compare with suppression', async () => {
    const ids = [];
    for (let i = 0; i < 12; i += 1) { const u = await user({ age: 70 }); await order(u, 2); ids.push(u); }
    for (let i = 0; i < 3; i += 1) ids.push(await user({ age: 70 }));
    await lifecycle.computeBatch(ids);
    await lifecycle.rebuildCohortStats();
    const cmp = await lifecycle.compare({ countries: country.toLowerCase(), months: 24 });
    const row = cmp.countries[0];
    expect(row.country).toBe(country);
    expect(row.suppressed).toBe(false);
    expect(row.stages.active.count).toBeGreaterThanOrEqual(12);
    const cohort = cmp.cohorts.find((c) => c.total >= 15);
    expect(cohort.stages.never_activated).toEqual({ count: null, share: null, suppressed: true });
    await expect(lifecycle.compare({ countries: 'US,FR,HT,DE,ES,IT,PT' })).rejects.toMatchObject({ code: 'invalid_countries' });
    await expect(lifecycle.compare({ countries: 'USA' })).rejects.toMatchObject({ code: 'invalid_countries' });
    const one = await lifecycle.current(ids[0]);
    const c = await lifecycle.cohortFor(one);
    expect(c.countryCohort.total).toBeGreaterThanOrEqual(15);
    expect(c.platformCohort.total).toBeGreaterThanOrEqual(c.countryCohort.total);
  });

  test('sweep advances a wrap-around cursor', async () => {
    await pool.query(`DELETE FROM customer_event_ingest_cursors WHERE source = 'lifecycle_users'`);
    const first = await lifecycle.sweep({ batch: 5 });
    expect(first.processed).toBe(5);
    const { rows: [cur] } = await pool.query(`SELECT last_key FROM customer_event_ingest_cursors WHERE source = 'lifecycle_users'`);
    expect(cur.last_key).toMatch(/^[0-9a-f-]{36}$/);
  });
});
