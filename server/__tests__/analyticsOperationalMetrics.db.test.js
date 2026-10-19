'use strict';
const crypto = require('crypto');
const schema = `analytics_ops_${crypto.randomBytes(6).toString('hex')}`;
const url = process.env.STATEMENT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1','localhost'].includes(target.hostname) || target.pathname !== '/credit_statement_test') throw new Error('Disposable database required');
  target.searchParams.set('options', `-c search_path=${schema},public`);
  process.env.DATABASE_URL = target.toString();
}
jest.unmock('pg'); jest.unmock('../db');
const db = require('../db');
const { buildMetricSql, validateBuilderQuery } = require('../analytics/queryBuilder');
const { computeMetricValue, computeMetricObservation, validateRuleInput } = require('../analytics/metricAlerts');
const { businessInvoiceAnalytics }=require('../analytics/businessInvoiceAnalytics');

(url ? describe : describe.skip)('operational metric cohorts and previous windows', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema};
      CREATE TABLE jobs(id UUID PRIMARY KEY,deleted_at TIMESTAMPTZ,created_at TIMESTAMPTZ,status TEXT NOT NULL DEFAULT 'published');
      CREATE TABLE disputes(id UUID PRIMARY KEY,job_id UUID REFERENCES jobs(id),status TEXT);
      CREATE TABLE payments(id BIGSERIAL PRIMARY KEY,status TEXT,refunded_amount NUMERIC,created_at TIMESTAMPTZ);
      CREATE TABLE main_app_payout_requests(id BIGSERIAL PRIMARY KEY,status TEXT,created_at TIMESTAMPTZ);
      CREATE TABLE business_invoices(id BIGSERIAL PRIMARY KEY,business_id INTEGER,invoice_number TEXT,
        currency_code VARCHAR(3),status TEXT,total NUMERIC(12,2),paid_at TIMESTAMPTZ)`);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA ${schema} CASCADE`); await db.end(); });
  beforeEach(async () => { await db.query('TRUNCATE disputes,jobs,payments,main_app_payout_requests,business_invoices'); });

  test('business revenue keeps currencies/businesses separate and excludes unpaid invoices',async()=>{
    await db.query(`INSERT INTO business_invoices(business_id,invoice_number,currency_code,status,total,paid_at) VALUES
      (1,'USD-1','USD','paid',123.45,NOW()),(1,'JPY-1','JPY','paid',5678,NOW()),
      (2,'OTHER','USD','paid',9999,NOW()),(1,'UNPAID','USD','sent',9000,NOW())`);
    const usd=await businessInvoiceAnalytics(db,1,{currencyCode:'USD'});
    expect(usd.summary).toEqual({revenue:'123.45',paid_invoices:1});
    expect(usd.accounts).toEqual(['JPY','USD']);
    expect(usd.invoices.map(row=>row.invoice_number)).toEqual(['USD-1']);
    expect((await businessInvoiceAnalytics(db,1,{currencyCode:'JPY'})).summary.revenue).toBe('5678.00');
  });

  test('two disputes on one job count once; deleted and old jobs are excluded', async () => {
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
    await db.query(`INSERT INTO jobs VALUES($1,NULL,NOW()-INTERVAL '1 day'),($2,NULL,NOW()-INTERVAL '1 day'),
      ($3,NOW(),NOW()-INTERVAL '1 day'),($4,NULL,NOW()-INTERVAL '60 days')`, ids);
    for (const jobId of [ids[0],ids[0],ids[2],ids[3]]) await db.query('INSERT INTO disputes VALUES($1,$2,\'resolved\')', [crypto.randomUUID(),jobId]);
    const query = buildMetricSql(validateBuilderQuery({ metric: 'dispute_rate_pct', period: '7d' }), {});
    const { rows: [r] } = await db.query(query.text,query.params);
    expect(r).toEqual({ dispute_rate_pct: 50,disputed: 1,total: 2 });
    expect(await computeMetricValue(db,'dispute_rate_pct',{ period: '7d' })).toBe(r.dispute_rate_pct);
  });

  test('job completion rate is one cohort for dashboards, builder, alerts and evidence', async () => {
    const { jobCompletionRate } = require('../analytics/operationalMetrics');
    const { metricEvidenceSql } = require('../analytics/metricEvidence');
    const registry = require('../analytics/metricsRegistry');
    const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
    await db.query(`INSERT INTO jobs(id,deleted_at,created_at,status) VALUES
      ($1,NULL,NOW()-INTERVAL '1 day','completed'),($2,NULL,NOW()-INTERVAL '1 day','cancelled'),
      ($3,NULL,NOW()-INTERVAL '1 day','published'),($4,NOW(),NOW()-INTERVAL '1 day','completed'),
      ($5,NULL,NOW()-INTERVAL '60 days','completed')`, ids);
    const dashboard = await jobCompletionRate(db, registry.PERIOD_INTERVAL['7d'].interval);
    expect(dashboard).toEqual({ completion_rate_pct: 50, completed: 1, decided: 2 });
    const query = validateBuilderQuery({ metric: 'job_completion_rate_pct', period: '7d' });
    const built = buildMetricSql(query, {});
    const { rows: [builder] } = await db.query(built.text, built.params);
    expect(builder).toEqual(dashboard);
    expect(await computeMetricValue(db, 'job_completion_rate_pct', { period: '7d' })).toBe(50);
    const evidence = metricEvidenceSql(query, {}, registry, built);
    const { rows } = await db.query(evidence.text, evidence.params);
    expect(rows.map(r => r.job_id).sort()).toEqual([ids[0], ids[1]].sort());
  });

  test('refund count rate includes partial refunds and excludes uncollected payments', async () => {
    await db.query(`INSERT INTO payments(status,refunded_amount,created_at) VALUES
      ('captured',5,NOW()-INTERVAL '1 day'),('released',0,NOW()-INTERVAL '1 day'),
      ('pending',10,NOW()-INTERVAL '1 day'),('refunded',30,NOW()-INTERVAL '45 days')`);
    expect(await computeMetricValue(db,'refund_rate_pct',{ period: '7d' })).toBe(50);
  });

  test('previous-period comparison uses disjoint windows and persists a defined percentage', async () => {
    await db.query(`INSERT INTO main_app_payout_requests(status,created_at)
      SELECT 'failed',NOW()-INTERVAL '1 day' FROM generate_series(1,4);
      INSERT INTO main_app_payout_requests(status,created_at)
      SELECT 'failed',NOW()-INTERVAL '8 days' FROM generate_series(1,2)`);
    const rule = validateRuleInput({ metric_name: 'payout_failure_count', operator: '>', threshold: 50,
      params: { period: '7d', comparison: 'previous_period_pct' } });
    expect(await computeMetricObservation(db,rule.metric_name,rule.params)).toEqual({ value: 4,previous: 2,compared: 100 });
  });

  test('zero baseline and empty rate cohorts stay unknown', async () => {
    expect(await computeMetricValue(db,'refund_rate_pct',{})).toBeNull();
    expect(await computeMetricObservation(db,'payout_failure_count',{period:'7d',comparison:'previous_period_pct'}))
      .toEqual({ value: 0,previous: 0,compared: null });
  });
});
