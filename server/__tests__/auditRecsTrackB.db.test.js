'use strict';
jest.unmock('pg');
const { Pool } = require('pg');
const registry = require('../analytics/metricsRegistry');

const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const u = new URL(url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || u.pathname !== '/credit_statement_test') {
    throw Error('Requires disposable loopback credit_statement_test');
  }
}

(url ? describe : describe.skip)('audit recs track B, real migrated DB', () => {
  let pool;
  beforeAll(() => { pool = new Pool({ connectionString: url }); });
  afterAll(async () => { await pool.end(); });

  test('Oct 25 #2: food-wallet ledger FKs are gone but the append-only rules still hold', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: fks } = await client.query(`SELECT conname FROM pg_constraint
        WHERE conrelid = 'food_customer_wallet_ledger'::regclass AND contype = 'f'`);
      expect(fks).toEqual([]);
      const { rows: rules } = await client.query(`SELECT rulename FROM pg_rules WHERE tablename = 'food_customer_wallet_ledger'`);
      const ruleNames = rules.map(r => r.rulename);
      expect(ruleNames).toContain('food_customer_wallet_ledger_no_update');
      expect(ruleNames).toContain('food_customer_wallet_ledger_no_delete');
      // No parent rows exist for these ids: with the FKs dropped the
      // insert succeeds, which is exactly what the old schema forbade.
      const { rows: [ledger] } = await client.query(`INSERT INTO food_customer_wallet_ledger
        (account_id, restaurant_id, customer_id, entry_type, amount_cents, balance_after_cents, currency_code)
        VALUES (987654321, 987654321, gen_random_uuid(), 'credit', 1000, 1000, 'USD') RETURNING id`);
      expect(ledger.id).toBeDefined();
      const updated = await client.query('UPDATE food_customer_wallet_ledger SET amount_cents = 2000 WHERE id = $1', [ledger.id]);
      expect(updated.rowCount).toBe(0);
      const deleted = await client.query('DELETE FROM food_customer_wallet_ledger WHERE id = $1', [ledger.id]);
      expect(deleted.rowCount).toBe(0);
      const { rows: [kept] } = await client.query('SELECT amount_cents FROM food_customer_wallet_ledger WHERE id = $1', [ledger.id]);
      expect(Number(kept.amount_cents)).toBe(1000);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  test('Oct 25 #4: chart buckets from the registry match the canonical revenue totals', async () => {
    const marker = 'audit-track-b-parity';
    try {
      await pool.query(`INSERT INTO platform_ledger (source_type, amount_cents, currency, description, created_at)
        VALUES ('job_fee', 10000, 'USD', $1, NOW()),
               ('subscription', 5000, 'USD', $1, NOW()),
               ('refund', -2000, 'USD', $1, NOW()),
               ('service_booking', 99999, 'USD', $1, NOW()),
               ('job_fee', 7777, 'EUR', $1, NOW())`, [marker]);
      const revenue = await registry.platformRevenue(pool, '30 days', 'USD');
      expect(revenue.period_cents).toBe(15000);
      expect(revenue.refunds_period_cents).toBe(2000);
      const rows = await registry.platformRevenueByPeriod(pool, '30 days', 'day', 'USD');
      const totals = rows.reduce((acc, r) => ({
        job_fee: acc.job_fee + r.job_fee_cents,
        subscription: acc.subscription + r.subscription_cents,
        refunds: acc.refunds + r.refunds_cents,
      }), { job_fee: 0, subscription: 0, refunds: 0 });
      expect(totals.job_fee).toBe(10000);
      expect(totals.subscription).toBe(5000);
      expect(totals.refunds).toBe(2000);
      expect(totals.job_fee + totals.subscription).toBe(revenue.period_cents);
      expect(totals.refunds).toBe(revenue.refunds_period_cents);
    } finally {
      await pool.query('DELETE FROM platform_ledger WHERE description = $1', [marker]);
    }
  });

  test('Oct 25 #14: growth erasure queue accepts parked rows and tracks attempts', async () => {
    const subject = 'c'.repeat(64);
    try {
      const { rows: [row] } = await pool.query(`INSERT INTO growth_erasure_queue
        (subject_key, device_keys, reason, status) VALUES ($1, '{}', 'audit-track-b', 'parked') RETURNING verification_attempts`, [subject]);
      expect(Number(row.verification_attempts)).toBe(0);
      await expect(pool.query(`INSERT INTO growth_erasure_queue
        (subject_key, device_keys, reason, status) VALUES ($1, '{}', 'audit-track-b', 'bogus')`, [subject]))
        .rejects.toMatchObject({ code: '23514' });
    } finally {
      await pool.query('DELETE FROM growth_erasure_queue WHERE subject_key = $1', [subject]);
    }
  });
});
