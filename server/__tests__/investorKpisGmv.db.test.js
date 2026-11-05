'use strict';

// Controller-layer pin for investor GMV: GET /api/investor/kpis reports
// kpis.gmv_cents equal to the registry value, hardcoded to the USD slice,
// and identical for ?period=7d and ?period=1y (GMV is all-time; the period
// parameter moves revenue/completion-rate windows, not GMV). A soft-deleted
// completed job must not count at this layer either. The controller reads
// through the shared pool, so the tables below are the minimal columns its
// queries touch (users, helper_profiles, jobs, platform_ledger,
// subscriptions, payouts); unrelated KPI sections stay zero-valued.

const crypto = require('crypto');
const schema = `investor_kpis_${crypto.randomBytes(6).toString('hex')}`;
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
const { investorGmvCents } = require('../analytics/metricsRegistry');
const { getKpis } = require('../controllers/investorController');

const describeDb = url ? describe : describe.skip;

function callKpis(period) {
  return new Promise((resolve, reject) => {
    const req = { query: { period } };
    const res = {
      json: (body) => resolve(body),
      status: () => res,
    };
    Promise.resolve(getKpis(req, res)).catch(reject);
  });
}

describeDb('investor KPIs controller: GMV', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      role TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), email_verified BOOLEAN DEFAULT FALSE)`);
    await db.query(`CREATE TABLE ${schema}.helper_profiles (user_id UUID PRIMARY KEY,
      is_identity_verified BOOLEAN DEFAULT FALSE, is_background_checked BOOLEAN DEFAULT FALSE,
      avg_rating NUMERIC, total_reviews INT)`);
    await db.query(`CREATE TABLE ${schema}.jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status TEXT NOT NULL DEFAULT 'published', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      bid_count INT DEFAULT 0, deleted_at TIMESTAMPTZ, currency_code TEXT DEFAULT 'USD',
      final_price_cents BIGINT, budget_max NUMERIC(10,2))`);
    await db.query(`CREATE TABLE ${schema}.platform_ledger (id BIGSERIAL PRIMARY KEY,
      job_id UUID, source_type TEXT, currency TEXT DEFAULT 'USD', amount_cents BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.subscriptions (id BIGSERIAL PRIMARY KEY, status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.payouts (id BIGSERIAL PRIMARY KEY, status TEXT,
      amount_cents BIGINT, amount NUMERIC)`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });
  beforeEach(async () => {
    await db.query(`TRUNCATE ${schema}.users, ${schema}.helper_profiles, ${schema}.jobs,
      ${schema}.platform_ledger, ${schema}.subscriptions, ${schema}.payouts`);
  });

  test('gmv_cents matches the registry USD value and is identical for 7d and 1y', async () => {
    await db.query(`INSERT INTO jobs (status, currency_code, final_price_cents, created_at) VALUES
      ('completed', 'USD', 5000, NOW()),
      ('completed', 'USD', 7000, NOW()),
      ('completed', 'USD', 3000, NOW() - INTERVAL '5 years'),
      ('completed', 'USD', NULL, NOW()),
      ('in_progress', 'USD', 99999, NOW()),
      ('cancelled', 'USD', 88888, NOW()),
      ('completed', 'EUR', 60000, NOW())`);
    await db.query(`INSERT INTO jobs (status, currency_code, final_price_cents) VALUES
      ('completed', 'USD', 44444)`);
    await db.query(`UPDATE jobs SET deleted_at = NOW() WHERE final_price_cents = 44444`);

    const registryValue = await investorGmvCents(db, 'USD');
    expect(registryValue).toBe(15000);

    const short = await callKpis('7d');
    const long = await callKpis('1y');
    expect(short.kpis.gmv_cents).toBe(registryValue);
    expect(long.kpis.gmv_cents).toBe(registryValue);
    expect(long.kpis.gmv_cents).toBe(short.kpis.gmv_cents);
    expect(short.period).toBe('7d');
    expect(long.period).toBe('1y');
  });
});
