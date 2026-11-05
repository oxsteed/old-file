'use strict';

// Job completion stamps final_price_cents so investor GMV counts the job.
// Before this stamp no runtime writer of jobs.final_price_cents existed:
// the migration-760 canonical-fields trigger syncs every other money pair
// but NOT final_price, and migration 352 only backfilled rows that already
// had a decimal final_price. A job that completed with an agreed price
// therefore landed in the unpriced bucket and GMV understated. The stamp
// priority mirrors workAgreementController's price fallback
// (final_price_cents, then job_value_cents, then budgets): an explicit
// final price wins, then the decimal final_price converted exactly as
// migration 352 did, then the agreed job value (kept current through
// approved change orders). Budgets, payouts and ledger take are never used.

const crypto = require('crypto');
const schema = `job_co_price_${crypto.randomBytes(6).toString('hex')}`;
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
jest.unmock('../utils/transaction');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue(undefined),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../db');
const { completeJobCore } = require('../controllers/jobController');

const ids = { helper: crypto.randomUUID(), customer: crypto.randomUUID() };
const describeDb = url ? describe : describe.skip;

async function makeJob({ finalPrice = null, finalPriceCents = null, jobValueCents = null } = {}) {
  const jobId = crypto.randomUUID();
  await db.query(
    `INSERT INTO jobs(id, client_id, assigned_helper_id, status, transaction_mode, metadata,
       final_price, final_price_cents, job_value_cents)
     VALUES($1, $2, $3, 'in_progress', 'direct', '{}'::jsonb, $4, $5, $6)`,
    [jobId, ids.customer, ids.helper, finalPrice, finalPriceCents, jobValueCents]
  );
  return jobId;
}

async function readPrice(jobId) {
  const { rows: [row] } = await db.query(
    'SELECT status, final_price, final_price_cents FROM jobs WHERE id = $1', [jobId]);
  return row;
}

async function complete(jobId) {
  return completeJobCore({
    job: { id: jobId, client_id: ids.customer, transaction_mode: 'direct', payment_rail: null, assigned_helper_id: ids.helper },
    jobId, asClient: true,
  });
}

describeDb('job completion stamps final_price_cents', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY)`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY, client_id UUID, assigned_helper_id UUID, status TEXT,
      transaction_mode TEXT, payment_rail TEXT, metadata JSONB,
      completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
      final_price NUMERIC(10,2), final_price_cents BIGINT, job_value_cents BIGINT)`);
    await db.query(`CREATE TABLE ${schema}.work_agreements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID,
      helper_id UUID, customer_id UUID, status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.work_agreement_change_orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agreement_id UUID, status TEXT)`);
    await db.query(`CREATE TABLE ${schema}.appointments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID, status TEXT, updated_at TIMESTAMPTZ)`);
    await db.query(`CREATE TABLE ${schema}.helper_profiles (
      user_id UUID PRIMARY KEY, completed_jobs_count INT DEFAULT 0,
      avg_rating NUMERIC, total_reviews INT, search_rank_boost NUMERIC, updated_at TIMESTAMPTZ)`);
    for (const id of [ids.helper, ids.customer]) await db.query('INSERT INTO users(id) VALUES($1)', [id]);
    await db.query('INSERT INTO helper_profiles(user_id) VALUES($1)', [ids.helper]);
  });
  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });

  test('decimal final_price converts to cents (migration-352 semantics) and wins over job value', async () => {
    const jobId = await makeJob({ finalPrice: 123.45, jobValueCents: 99999 });
    const result = await complete(jobId);
    expect(result.status).toBe('completed');
    const row = await readPrice(jobId);
    expect(Number(row.final_price_cents)).toBe(12345);
    expect(Number(row.final_price)).toBe(123.45);
  });

  test('with no final price, the agreed job value lands priced (the real-world path)', async () => {
    const jobId = await makeJob({ jobValueCents: 77700 });
    await complete(jobId);
    const row = await readPrice(jobId);
    expect(Number(row.final_price_cents)).toBe(77700);
    expect(Number(row.final_price)).toBe(777);
  });

  test('an explicitly recorded final_price_cents is never overwritten', async () => {
    const jobId = await makeJob({ finalPrice: 999.99, finalPriceCents: 5000, jobValueCents: 88888 });
    await complete(jobId);
    const row = await readPrice(jobId);
    expect(Number(row.final_price_cents)).toBe(5000);
  });

  test('a job with no price at all stays unpriced (NULL), not zero-filled', async () => {
    const jobId = await makeJob();
    await complete(jobId);
    const row = await readPrice(jobId);
    expect(row.final_price_cents).toBeNull();
    expect(row.status).toBe('completed');
  });
});
