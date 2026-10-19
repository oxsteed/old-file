'use strict';
// Investor drill-through is aggregate-only and reconciles with the KPI.
const crypto = require('crypto');
const schema = `investor_ev_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') throw new Error('Disposable database required');
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg'); jest.unmock('../db');
const db = require('../db');
const { investorEvidence } = require('../analytics/investorEvidence');
const { buildMetricSql, validateBuilderQuery } = require('../analytics/queryBuilder');

(url ? describe : describe.skip)('investor aggregate evidence', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema};
      CREATE TABLE jobs(id UUID PRIMARY KEY, deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ, status TEXT,
        currency_code TEXT, final_price_cents BIGINT, budget_max NUMERIC, client_id UUID, assigned_helper_id UUID);
      CREATE TABLE platform_ledger(id BIGSERIAL PRIMARY KEY, job_id UUID, source_type TEXT, currency TEXT,
        amount_cents BIGINT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });

  test('revenue buckets reconcile with the governed KPI and never carry record ids', async () => {
    for (let i = 0; i < 4; i += 1) {
      await db.query(`INSERT INTO platform_ledger(job_id,source_type,currency,amount_cents,created_at) VALUES($1,'job_fee','usd',100,NOW()-INTERVAL '1 day')`, [crypto.randomUUID()]);
    }
    await db.query(`INSERT INTO platform_ledger(job_id,source_type,currency,amount_cents,created_at) VALUES(NULL,'subscription','eur',999,NOW()-INTERVAL '2 days')`);
    const out = await investorEvidence(db, 'platform_revenue_cents', '30d');
    const built = buildMetricSql(validateBuilderQuery({ metric: 'platform_revenue_cents', period: '30d' }), {});
    const { rows: kpi } = await db.query(built.text, built.params);
    for (const row of kpi) {
      const total = out.totals.find(t => t.currency_code === row.currency_code);
      expect(Number(total.amount_cents)).toBe(Number(row.revenue_cents));
    }
    const usd = out.buckets.find(b => b.currency_code === 'USD');
    expect(usd).toMatchObject({ records: 4, suppressed: false });
    expect(Number(usd.amount_cents)).toBe(400);
    // One EUR subscription payment: the bucket is suppressed, the total stays.
    const eur = out.buckets.find(b => b.currency_code === 'EUR');
    expect(eur).toEqual({ suppressed: true, bucket: expect.anything(), currency_code: 'EUR', source_type: 'subscription' });
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/ledger_id|job_id|"id"/);
  });

  test('completion rate and GMV evidence are aggregate; unknown metrics are refused', async () => {
    const helper = crypto.randomUUID();
    for (const [status, price] of [['completed', 1000], ['completed', 2000], ['completed', null], ['cancelled', null]]) {
      await db.query(`INSERT INTO jobs(id,created_at,status,currency_code,final_price_cents,assigned_helper_id) VALUES($1,NOW()-INTERVAL '1 day',$2,'USD',$3,$4)`,
        [crypto.randomUUID(), status, price, helper]);
    }
    const completion = await investorEvidence(db, 'job_completion_rate_pct', '7d');
    expect(completion.totals[0]).toEqual({ records: 4, completed: 3, cancelled: 1 });
    const gmv = await investorEvidence(db, 'investor_gmv_cents', '30d');
    expect(gmv.period_sensitive).toBe(false);
    expect(gmv.buckets[0]).toMatchObject({ currency_code: 'USD', records: 3, unpriced: 1, suppressed: false });
    expect(Number(gmv.buckets[0].gmv_cents)).toBe(3000);
    await expect(investorEvidence(db, 'escrow_held_cents', '30d')).rejects.toMatchObject({ statusCode: 404 });
    expect(JSON.stringify([completion, gmv])).not.toContain(helper);
  });
});
