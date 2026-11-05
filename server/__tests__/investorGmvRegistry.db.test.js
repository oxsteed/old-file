'use strict';

// Registry-layer pin for investor GMV: SUM(final_price_cents) of
// non-deleted completed jobs, sliced by currency, all-time. The SQL layer
// already pins this (analyticsFinancialIntegrity), but nothing called
// investorGmvCents directly, so a registry refactor could silently change
// what the investor dashboard reports. Budgets are never GMV: a completed
// job with a huge budget and no recorded price contributes 0, not its
// budget, and stays visible only via the unpriced count in the SQL layer.

const crypto = require('crypto');
const schema = `investor_gmv_${crypto.randomBytes(6).toString('hex')}`;
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

const describeDb = url ? describe : describe.skip;

describeDb('investor GMV registry definition', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), status TEXT NOT NULL DEFAULT 'published',
      currency_code TEXT DEFAULT 'USD', final_price_cents BIGINT, budget_max NUMERIC(10,2),
      deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });
  beforeEach(async () => { await db.query(`TRUNCATE ${schema}.jobs`); });

  test('priced completed jobs sum; in-progress, cancelled, soft-deleted and non-USD rows are excluded', async () => {
    await db.query(`INSERT INTO jobs (status, currency_code, final_price_cents, budget_max) VALUES
      ('completed', 'USD', 5000, 99999),
      ('completed', 'USD', 7000, 99999),
      ('in_progress', 'USD', 99999, 99999),
      ('cancelled', 'USD', 88888, 88888),
      ('completed', 'EUR', 60000, 60000)`);
    await db.query(`INSERT INTO jobs (status, currency_code, final_price_cents) VALUES
      ('completed', 'USD', 44444)`);
    // Soft-delete the last row after insert: it must not count.
    await db.query(`UPDATE jobs SET deleted_at = NOW() WHERE final_price_cents = 44444`);
    expect(await investorGmvCents(db, 'USD')).toBe(12000);
    expect(await investorGmvCents(db, 'EUR')).toBe(60000);
    expect(await investorGmvCents(db, 'usd')).toBe(12000);
  });

  test('all-time: an old-dated completed job is included; a NULL-price completed job adds 0', async () => {
    await db.query(`INSERT INTO jobs (status, currency_code, final_price_cents, created_at) VALUES
      ('completed', 'USD', 3000, NOW() - INTERVAL '5 years'),
      ('completed', 'USD', NULL, NOW()),
      ('completed', 'USD', 2000, NOW())`);
    expect(await investorGmvCents(db, 'USD')).toBe(5000);
  });

  test('no priced completed jobs returns 0, not null', async () => {
    await db.query(`INSERT INTO jobs (status, currency_code, final_price_cents) VALUES
      ('completed', 'USD', NULL), ('in_progress', 'USD', 1000)`);
    expect(await investorGmvCents(db, 'USD')).toBe(0);
    expect(await investorGmvCents(db, 'EUR')).toBe(0);
  });
});
