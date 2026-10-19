'use strict';
const crypto = require('crypto');
const schema = `analytics_integrity_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') throw new Error('Disposable DB required');
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg'); jest.unmock('../db');
const db = require('../db');
const { financialMetricSql } = require('../analytics/financialMetrics');
const { helperEarnings } = require('../analytics/helperEarnings');
const metric = async name => { const q = financialMetricSql(name); return (await db.query(q.text, q.params)).rows; };
const viewer = '11111111-1111-4111-8111-111111111111';

(url ? describe : describe.skip)('analytics financial integrity', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE jobs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),title TEXT,assigned_helper_id UUID,
      status TEXT,currency_code TEXT,final_price_cents BIGINT,helper_payout_cents BIGINT,payout_status TEXT,
      budget_max NUMERIC,deleted_at TIMESTAMPTZ,completed_at TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE platform_ledger (job_id UUID,source_type TEXT,currency TEXT,amount_cents BIGINT,created_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE plans (id INTEGER,currency TEXT,amount_cents BIGINT,interval TEXT)`);
    await db.query(`CREATE TABLE subscriptions (plan_id INTEGER,status TEXT)`);
    await db.query(`CREATE TABLE payments (currency TEXT,amount NUMERIC,capture_amount_cents BIGINT,refunded_amount NUMERIC,status TEXT,escrow_status TEXT)`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });
  beforeEach(async () => { await db.query('TRUNCATE jobs,platform_ledger,plans,subscriptions,payments'); });

  test('returns distinct currencies and exact large ledger amounts', async () => {
    await db.query(`INSERT INTO platform_ledger(source_type,currency,amount_cents) VALUES
      ('job_fee','USD',9007199254740993),('subscription','EUR',200),('refund','USD',-500),('job_fee','JPY',1234)`);
    expect(await metric('platform_revenue_cents')).toEqual([
      { currency_code: 'EUR', revenue_cents: '200' }, { currency_code: 'JPY', revenue_cents: '1234' },
      { currency_code: 'USD', revenue_cents: '9007199254740993' },
    ]);
  });

  test('GMV uses recorded prices and fees use the same completed-job/currency cohort', async () => {
    const { rows: [job] } = await db.query(`INSERT INTO jobs(status,currency_code,final_price_cents,budget_max)
      VALUES ('completed','USD',5000,99999) RETURNING id`);
    await db.query(`INSERT INTO jobs(status,currency_code,budget_max) VALUES ('completed','USD',99999)`);
    await db.query(`INSERT INTO platform_ledger(job_id,source_type,currency,amount_cents) VALUES
      ($1,'job_fee','USD',1000),($1,'job_fee','EUR',80000),(NULL,'job_fee','USD',99999),($1,'subscription','USD',99999)`, [job.id]);
    expect(await metric('investor_gmv_cents')).toEqual([{ currency_code: 'USD', gmv_cents: '5000', completed_jobs: 2, unpriced_jobs: 1 }]);
    expect((await metric('investor_take_rate_pct'))[0]).toMatchObject({ currency_code: 'USD', gmv_cents: '5000', fee_cents: '1000', take_rate_pct: 20 });
  });

  test('MRR and held payments retain currency and native minor-unit precision', async () => {
    await db.query(`INSERT INTO plans VALUES (1,'EUR',24000,'year'),(2,'USD',3000,'month'); INSERT INTO subscriptions VALUES(1,'active'),(2,'active')`);
    expect(await metric('mrr_cents')).toEqual([{ currency_code: 'EUR', mrr_cents: '2000' }, { currency_code: 'USD', mrr_cents: '3000' }]);
    await db.query(`INSERT INTO payments VALUES ('JPY',NULL,2000,1,'captured','held'),('KWD',3,NULL,0.001,'captured','held')`);
    expect(await metric('escrow_held_cents')).toEqual([{ currency_code: 'JPY', escrow_held_cents: '1999' }, { currency_code: 'KWD', escrow_held_cents: '2999' }]);
  });

  test('earnings are user- and currency-scoped, paginated, and exclude budget estimates', async () => {
    await db.query(`INSERT INTO jobs(assigned_helper_id,status,currency_code,helper_payout_cents,payout_status,title)
      SELECT $1,'completed','USD',100,'earned','Recorded job' FROM generate_series(1,24)`, [viewer]);
    await db.query(`INSERT INTO jobs(assigned_helper_id,status,currency_code,helper_payout_cents,payout_status,budget_max)
      VALUES ($1,'completed','JPY',9007199254740993,'paid',99999),($1,'completed','USD',NULL,'not_ready',99999),
      ('22222222-2222-4222-8222-222222222222','completed','USD',999999,'paid',0)`, [viewer]);
    const usd = await helperEarnings(db, viewer);
    expect(usd.summary).toMatchObject({ currencyCode: 'USD', lifetimeCents: 2400, availableCents: 2400, completedJobs: 25, unpricedJobs: 1 });
    expect(usd.jobs).toHaveLength(20); expect(usd.pagination.hasMore).toBe(true);
    const next = await helperEarnings(db, viewer, { offset: 20 }); expect(next.jobs).toHaveLength(5);
    const jpy = await helperEarnings(db, viewer, { currencyCode: 'JPY' });
    expect(jpy.summary.lifetimeCents).toBe('9007199254740993'); expect(jpy.summary.completedJobs).toBe(1);
    await expect(helperEarnings(db, viewer, { currencyCode: "USD' OR TRUE" })).rejects.toMatchObject({ status: 400 });
  });

  test('applied audit migration blocks edits, deletion, and truncation', async () => {
    const { rows: [entry] } = await db.query(`INSERT INTO public.analytics_query_audit(admin_user_id,metric_name) VALUES ($1,'synthetic_integrity_check') RETURNING id`, [viewer]);
    for (const sql of [
      'UPDATE public.analytics_query_audit SET success=TRUE WHERE id=$1',
      'DELETE FROM public.analytics_query_audit WHERE id=$1',
    ]) await expect(db.query(sql, [entry.id])).rejects.toMatchObject({ code: '23514' });
    await expect(db.query('TRUNCATE public.analytics_query_audit')).rejects.toMatchObject({ code: '23514' });
  });
});
