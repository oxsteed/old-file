'use strict';

// Customer 360 upgrade 2: advisory health and risk scores computed from real
// tables, explained per factor, hidden by grant, refreshed from events.

jest.unmock('pg');
jest.unmock('../utils/transaction');
const { disposableDatabaseOptIn } = require('./helpers/statementTestDatabase');

const database = disposableDatabaseOptIn('CUSTOMER360_TEST_DATABASE_URL');
if (database) process.env.DATABASE_URL = database;
const describeDatabase = database ? describe : describe.skip;
const crypto = require('crypto');
const health = require('../services/customer360Health');

jest.setTimeout(120000);

test('scoring is bounded, weighted and explained', () => {
  const quiet = health.score({ daysSinceLogin: 3, accountAgeDays: 400, activity30: 4, activityPrev60: 8,
    failedPayments90: 0, refunds90: 0, openDisputes: 0, openTickets: 0, tickets90: 0, slaBreaches90: 0 });
  expect(quiet).toMatchObject({ churnScore: 0, paymentScore: 0, supportScore: 0, churnBand: 'low' });
  const risky = health.score({ daysSinceLogin: null, accountAgeDays: 5, activity30: 0, activityPrev60: 0,
    failedPayments90: 9, refunds90: 2, openDisputes: 1, openTickets: 3, tickets90: 3, slaBreaches90: 1 });
  expect(risky.churnScore).toBe(45 + 18 + 20);
  expect(risky.churnBand).toBe('high');
  expect(risky.paymentScore).toBe(40 + 15 + 30);
  expect(risky.supportScore).toBe(40 + 15 + 15);
  expect(risky.supportBand).toBe('high');
  for (const rows of Object.values(risky.factors)) {
    expect(rows.reduce((s, f) => s + f.weight, 0)).toBe(100);
    for (const f of rows) expect(f.explanationKey).toMatch(/^health\.factors\./);
  }
  const shown = health.present({ model_version: 'v', computed_at: new Date(), churn_score: 1, churn_band: 'low',
    payment_score: 90, payment_band: 'high', support_score: 2, support_band: 'low', factors: risky.factors },
  { payments: false, support: true });
  expect(shown.advisory).toBe(true);
  expect(shown.payment).toEqual({ state: 'restricted' });
  expect(shown.support.state).toBe('ready');
});

test('health DB test requires an explicit disposable database opt-in', () => {
  expect(database === '' || database.includes('/credit_statement_test')).toBe(true);
});

describeDatabase('customer360 health scores', () => {
  let pool;
  let events;
  let customer;

  beforeAll(async () => {
    pool = require('../db');
    events = require('../services/customer360Events');
    customer = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, last_login_at, created_at)
       VALUES ($1, $2, 'synthetic-unusable', 'Hea', 'Lth', 'customer', NOW() - INTERVAL '120 days', NOW() - INTERVAL '400 days')`,
      [customer, `c360-health-${customer}@example.invalid`]);
  });
  afterAll(async () => { await pool.end?.(); });

  test('scores from source tables, stores factors and records band changes', async () => {
    const first = await health.recompute(customer);
    expect(first.churn_band).not.toBe('low');
    expect(first.payment_band).toBe('low');
    expect(first.support_band).toBe('low');
    const inactivity = first.factors.churn.find((f) => f.key === 'inactivity');
    expect(inactivity).toMatchObject({ value: 120, contribution: 45, weight: 45 });

    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `INSERT INTO instant_payouts (user_id, stripe_account_id, amount_cents, idempotency_key, status) VALUES ($1, 'acct_test', 500, $2, 'failed')`,
        [customer, `c360-health-${crypto.randomUUID()}`]);
      await pool.query(`INSERT INTO support_tickets (user_id, name, email, status) VALUES ($1, 'H', 'h@example.invalid', 'open')`, [customer]);
    }
    const second = await health.recompute(customer);
    expect(second.payment_band).toBe('medium');
    expect(second.support_band).toBe('medium');
    expect(second.factors.payment.find((f) => f.key === 'failedPayments')).toMatchObject({ value: 3, contribution: 40 });

    for (let i = 0; i < 20; i += 1) { if (!(await events.drainInbox()).moved) break; }
    const { rows } = await pool.query(
      `SELECT changes FROM customer_events WHERE customer_id = $1 AND event_type = 'health.band_changed'`, [customer]);
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({ payment_band: { changed: true }, support_band: { changed: true } });
  });

  test('event consumer rescoring advances its cursor and skips derived events', async () => {
    await pool.query(`UPDATE customer360_event_consumers SET last_event_id = 0 WHERE consumer = 'health'`);
    await pool.query(`UPDATE customer_health_scores SET computed_at = NOW() - INTERVAL '2 days' WHERE customer_id = $1`, [customer]);
    let total = 0;
    for (let i = 0; i < 200; i += 1) {
      const r = await health.refreshFromEvents({ maxCustomers: 200 });
      total += r.rescored;
      if (!r.rescored) break;
    }
    expect(total).toBeGreaterThan(0);
    const { rows: [row] } = await pool.query(`SELECT computed_at FROM customer_health_scores WHERE customer_id = $1`, [customer]);
    expect(Date.now() - new Date(row.computed_at).getTime()).toBeLessThan(60_000);
    expect(await health.refreshFromEvents()).toEqual({ rescored: 0 });
  });
});
