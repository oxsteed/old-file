'use strict';

/**
 * Parity tests: REVENUE canonical definition + INVESTOR TAKE-RATE formula.
 *
 * Canonical platform revenue (registry): platform take from platform_ledger —
 * source_type IN ('job_fee','subscription') AND amount_cents > 0. Vertical
 * GMVs (food, tool rentals, consulting) are separate metrics, not rival
 * definitions of the same KPI.
 *
 * Take-rate: the OLD investor formula divided ALL-TIME take INCLUDING
 * subscriptions by budget-GMV, so it could exceed 100% by construction.
 * The NEW canonical formula is all-time job_fee take / all-time budget GMV
 * (subscriptions excluded). Investor GMV stays SUM(budget_max) of completed
 * jobs — budgets, not actuals — documented as a known limitation.
 */
const crypto = require('crypto');
const schema = `mreg_rev_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') {
    throw new Error('fixtures require the disposable statement test database');
  }
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg');
jest.unmock('../db');

const db = require('../db');
const registry = require('../analytics/metricsRegistry');

const describeDb = url ? describe : describe.skip;

describeDb('metrics registry: revenue + take-rate parity', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.platform_ledger (
      id SERIAL PRIMARY KEY, source_type VARCHAR(50) NOT NULL,
      amount_cents INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'published',
      budget_max NUMERIC(10,2), budget_min NUMERIC(10,2))`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.platform_ledger, ${schema}.jobs`);
  });

  test('old take-rate formula exceeds 100% by construction; new formula is sane', async () => {
    // Two completed jobs, budgets $1000 and $500 -> budget GMV = $1500 = 150000c
    await db.query(`INSERT INTO jobs (status, budget_max) VALUES
      ('completed', 1000.00), ('completed', 500.00), ('in_progress', 9999.00)`);
    // Platform take: $100 of job fees, $2000 of subscription revenue (all-time)
    await db.query(`INSERT INTO platform_ledger (source_type, amount_cents) VALUES
      ('job_fee', 10000), ('subscription', 200000)`);

    // OLD formula (investorController before the fix):
    const old = await db.query(`
      SELECT (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE source_type IN ('job_fee','subscription') AND amount_cents > 0), 0) FROM platform_ledger)::FLOAT
           / NULLIF((SELECT COALESCE(SUM(COALESCE(budget_max, budget_min, 0) * 100), 0) FROM jobs WHERE status = 'completed'), 0) * 100 AS take_rate`);
    expect(old.rows[0].take_rate).toBeGreaterThan(100);

    // NEW canonical formula (registry):
    const takeRate = await registry.investorTakeRatePct(db);
    expect(takeRate).toBeCloseTo(6.67, 2);
    expect(takeRate).toBeLessThanOrEqual(100);
  });

  test('take-rate excludes in-progress jobs from GMV and negative ledger rows from take', async () => {
    await db.query(`INSERT INTO jobs (status, budget_max) VALUES ('completed', 1000.00), ('in_progress', 5000.00)`);
    await db.query(`INSERT INTO platform_ledger (source_type, amount_cents) VALUES
      ('job_fee', 8000), ('job_fee', -2000), ('subscription', 999999)`);
    // job take = 8000 (the -2000 row is excluded by amount_cents > 0); GMV = 100000; subs excluded
    expect(await registry.investorTakeRatePct(db)).toBeCloseTo(8.0, 2);
  });

  test('take-rate is null when GMV is zero', async () => {
    await db.query(`INSERT INTO platform_ledger (source_type, amount_cents) VALUES ('job_fee', 5000)`);
    expect(await registry.investorTakeRatePct(db)).toBeNull();
  });

  test('platformRevenue honors the period window and splits subscription/refunds', async () => {
    await db.query(`INSERT INTO platform_ledger (source_type, amount_cents, created_at) VALUES
      ('job_fee', 10000, NOW() - INTERVAL '2 days'),
      ('subscription', 5000, NOW() - INTERVAL '2 days'),
      ('job_fee', 7000, NOW() - INTERVAL '60 days'),
      ('refund', -3000, NOW() - INTERVAL '2 days'),
      ('subscription', 99999, NOW() - INTERVAL '400 days')`);
    const rev = await registry.platformRevenue(db, '30 days');
    // total = all-time take (refunds are tracked separately, not netted)
    expect(rev.total_cents).toBe(10000 + 5000 + 7000 + 99999);
    expect(rev.period_cents).toBe(10000 + 5000);
    expect(rev.subscription_period_cents).toBe(5000);
    expect(rev.refunds_period_cents).toBe(3000);
    expect(rev.mtd_cents).toBeGreaterThanOrEqual(rev.period_cents);
  });

  test('canonical period map normalizes 1y to "1 year"', async () => {
    expect(registry.PERIOD_INTERVAL['1y'].interval).toBe('1 year');
    expect(registry.resolvePeriod('1y')).toBe('1y');
    expect(registry.resolvePeriod('bogus')).toBe('30d');
  });
});
