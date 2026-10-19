'use strict';

/**
 * Parity tests: MRR and ESCROW_HELD.
 *
 * Old behavior: superAdminController.getDashboardStats returned hardcoded
 * `mrr: 0` and `escrow_held: 0` (no client consumes them today, so computing
 * them properly changes no UI — it just stops the API lying).
 *
 * Canonical (registry):
 *   mrr_cents: SUM over active subscriptions of the plan amount, yearly
 *     plans normalized /12.
 *   escrow_held_cents: SUM over payments with escrow_status IN
 *     ('held','disputed') AND status IN ('authorized','captured') of
 *     COALESCE(capture_amount_cents, amount*100) − refunded, floored at 0
 *     per payment.
 */
const crypto = require('crypto');
const schema = `mreg_mrresc_${crypto.randomBytes(6).toString('hex')}`;
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

describeDb('metrics registry: MRR + escrow held parity', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.plans (
      id SERIAL PRIMARY KEY, currency TEXT DEFAULT 'USD', amount_cents INTEGER NOT NULL, interval VARCHAR(20) NOT NULL DEFAULT 'month')`);
    await db.query(`CREATE TABLE ${schema}.subscriptions (
      id SERIAL PRIMARY KEY, plan_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active')`);
    await db.query(`CREATE TABLE ${schema}.payments (
      id SERIAL PRIMARY KEY, currency TEXT DEFAULT 'USD', escrow_status VARCHAR(30) DEFAULT 'none',
      status VARCHAR(30) NOT NULL DEFAULT 'pending',
      amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      capture_amount_cents INTEGER, refunded_amount NUMERIC(10,2) NOT NULL DEFAULT 0)`);
  });

  afterAll(async () => {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  });

  describe('mrrCents', () => {
    beforeEach(async () => {
      await db.query(`TRUNCATE ${schema}.plans, ${schema}.subscriptions`);
      await db.query(`INSERT INTO plans (id, amount_cents, interval) VALUES
        (1, 2000, 'month'), (2, 24000, 'year')`);
    });

    test('sums active subscriptions, normalizing yearly plans /12', async () => {
      await db.query(`INSERT INTO subscriptions (plan_id, status) VALUES
        (1, 'active'), (1, 'active'), (2, 'active'),
        (1, 'cancelled'), (1, 'trialing'), (2, 'past_due')`);
      // 2×$20/mo + 1×$240/yr÷12 = 4000 + 2000 = 6000
      expect(await registry.mrrCents(db)).toBe(6000);
    });

    test('returns 0 with no active subscriptions (old hardcoded value only matched this case)', async () => {
      await db.query(`INSERT INTO subscriptions (plan_id, status) VALUES (1, 'cancelled')`);
      expect(await registry.mrrCents(db)).toBe(0);
    });
  });

  describe('escrowHeldCents', () => {
    beforeEach(async () => {
      await db.query(`TRUNCATE ${schema}.payments`);
      await db.query(`INSERT INTO payments
        (escrow_status, status, amount, capture_amount_cents, refunded_amount) VALUES
        ('held', 'authorized', 100.00, NULL, 0),        -- 10000, amount fallback
        ('disputed', 'captured', 0, 5000, 10.00),       -- 5000-1000 = 4000
        ('held', 'captured', 0, 3000, 50.00),           -- 3000-5000 <0 -> 0
        ('released', 'captured', 999.00, NULL, 0),      -- excluded: released
        ('held', 'pending', 777.00, NULL, 0),           -- excluded: not captured
        ('none', 'authorized', 555.00, NULL, 0)`);      // excluded: no hold
    });

    test('sums net held funds, floored per payment, excluding released/pending', async () => {
      expect(await registry.escrowHeldCents(db)).toBe(14000);
    });

    test('returns 0 when nothing is held (the only case the old hardcoded 0 got right)', async () => {
      await db.query(`TRUNCATE ${schema}.payments`);
      await db.query(`INSERT INTO payments (escrow_status, status, amount) VALUES ('released', 'captured', 100.00)`);
      expect(await registry.escrowHeldCents(db)).toBe(0);
    });
  });
});
