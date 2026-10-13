'use strict';

// Review P1-3-F14 against a real database: job completion checks agreement
// state. A proposed-but-undecided change order means the agreed price is in
// flux, so completing (and capturing escrow) fails closed until both parties
// decide the change order.

const crypto = require('crypto');
const schema = `job_co_guard_${crypto.randomBytes(6).toString('hex')}`;
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

async function makeJob() {
  const jobId = crypto.randomUUID();
  await db.query(
    `INSERT INTO jobs(id, client_id, assigned_helper_id, status, transaction_mode, metadata)
     VALUES($1, $2, $3, 'in_progress', 'direct', '{}'::jsonb)`,
    [jobId, ids.customer, ids.helper]
  );
  return jobId;
}

async function jobStatus(jobId) {
  return (await db.query('SELECT status FROM jobs WHERE id = $1', [jobId])).rows[0].status;
}

describeDb('job completion agreement guard (P1-3-F14)', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`CREATE TABLE ${schema}.users (id UUID PRIMARY KEY)`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY, client_id UUID, assigned_helper_id UUID, status TEXT,
      transaction_mode TEXT, payment_rail TEXT, metadata JSONB,
      completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`);
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

  test('completion is refused while a change order is undecided', async () => {
    const jobId = await makeJob();
    const a = (await db.query(
      `INSERT INTO work_agreements(job_id, helper_id, customer_id, status)
       VALUES($1, $2, $3, 'active') RETURNING id`,
      [jobId, ids.helper, ids.customer])).rows[0];
    await db.query(
      `INSERT INTO work_agreement_change_orders(agreement_id, status) VALUES($1, 'proposed')`,
      [a.id]);

    await expect(completeJobCore({
      job: { id: jobId, client_id: ids.customer, transaction_mode: 'direct', payment_rail: null, assigned_helper_id: ids.helper },
      jobId, asClient: true,
    })).rejects.toMatchObject({ code: 'change_order_pending', status: 409 });
    expect(await jobStatus(jobId)).toBe('in_progress');
  });

  test('completion proceeds once the change order is decided', async () => {
    const jobId = await makeJob();
    const a = (await db.query(
      `INSERT INTO work_agreements(job_id, helper_id, customer_id, status)
       VALUES($1, $2, $3, 'active') RETURNING id`,
      [jobId, ids.helper, ids.customer])).rows[0];
    await db.query(
      `INSERT INTO work_agreement_change_orders(agreement_id, status) VALUES($1, 'rejected')`,
      [a.id]);

    const result = await completeJobCore({
      job: { id: jobId, client_id: ids.customer, transaction_mode: 'direct', payment_rail: null, assigned_helper_id: ids.helper },
      jobId, asClient: true,
    });

    expect(result.status).toBe('completed');
    expect(await jobStatus(jobId)).toBe('completed');
  });

  test('completion proceeds with no agreement at all', async () => {
    const jobId = await makeJob();
    const result = await completeJobCore({
      job: { id: jobId, client_id: ids.customer, transaction_mode: 'direct', payment_rail: null, assigned_helper_id: ids.helper },
      jobId, asClient: true,
    });
    expect(result.status).toBe('completed');
  });
});
