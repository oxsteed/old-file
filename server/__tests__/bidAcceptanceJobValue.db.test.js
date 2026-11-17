'use strict';

// Review P1-2-F11 against a real database: accepting a bid records the
// agreed price (jobs.job_value / job_value_cents) for every payment method,
// not just protected payments. Tier-3 escrow funding (POST /payments/intent)
// requires job_value; without it a customer who accepted off_platform could
// never fund escrow once protected payments launch. Pure bookkeeping: no
// money moves here.

const crypto = require('crypto');
const schema = `bid_accept_${crypto.randomBytes(6).toString('hex')}`;
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
const { assignHelper } = require('../controllers/jobController');

const ids = { helper: crypto.randomUUID(), customer: crypto.randomUUID() };
const describeDb = url ? describe : describe.skip;

function invoke(body, userId) {
  const res = {
    statusCode: 200,
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  const next = (err) => { res.error = err; };
  return assignHelper(
    { body, user: { id: userId }, get: () => undefined, impersonated: false },
    res,
    next
  ).then(() => res);
}

describeDb('bid acceptance records the agreed price (P1-2-F11)', () => {
  beforeAll(async () => {
    await db.query(`CREATE SCHEMA ${schema}`);
    // Domain 6 enforce contract: assertHelperCanBeHired calls
    // accessService.can(), whose loadFacts() SELECTs every column below
    // from users (search_path resolves to this schema's table), plus the
    // grant/business lookups that resolve to the public tables. On base
    // (enforcement off) can() early-returned and never queried.
    await db.query(`CREATE TABLE ${schema}.users (
      id UUID PRIMARY KEY, role TEXT, is_active BOOLEAN,
      deleted_at TIMESTAMPTZ, is_suspended BOOLEAN,
      suspended_until TIMESTAMPTZ, is_banned BOOLEAN)`);
    await db.query(`CREATE TABLE ${schema}.jobs (
      id UUID PRIMARY KEY, client_id UUID, assigned_helper_id UUID, status TEXT,
      title TEXT, description TEXT, version INT DEFAULT 1, revision INT DEFAULT 1,
      scheduled_start_at TIMESTAMPTZ, scheduled_precision TEXT,
      location_address TEXT, location_city TEXT, location_state TEXT,
      deleted_at TIMESTAMPTZ, payment_rail TEXT, job_value NUMERIC,
      job_value_cents INT, metadata JSONB, currency_code TEXT DEFAULT 'USD',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.bids (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), job_id UUID, helper_id UUID,
      status TEXT, amount NUMERIC, amount_cents INT, eta_hours NUMERIC,
      expires_at TIMESTAMPTZ, job_revision INT, needs_reconfirm BOOLEAN DEFAULT FALSE,
      payment_method TEXT, cancellation_policy JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`CREATE TABLE ${schema}.helper_cancellation_policies (
      helper_id UUID PRIMARY KEY, oxsteed_enabled BOOLEAN, custom_enabled BOOLEAN,
      custom_policy JSONB)`);
    await db.query(`CREATE TABLE ${schema}.appointments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), customer_id UUID, helper_id UUID,
      job_id UUID, service_description TEXT, scheduled_start_time TIMESTAMPTZ,
      scheduled_end_time TIMESTAMPTZ, estimated_duration_minutes INT,
      location_address TEXT, status TEXT, source TEXT, created_by_user_id UUID)`);
    await db.query(`CREATE UNIQUE INDEX appt_job_unique ON ${schema}.appointments(job_id) WHERE job_id IS NOT NULL`);
    for (const [userId, role] of [[ids.helper, 'helper'], [ids.customer, 'customer']]) {
      await db.query('INSERT INTO users(id, role, is_active) VALUES($1, $2, TRUE)', [userId, role]);
    }
    // The grant is seeded schema-local: under this search_path the
    // unqualified access_grants lookup in loadFacts() resolves here, not to
    // public. (Seeding public.access_grants instead would need a mirror
    // public.users row for its FK, and deleting that row trips Postgres RI
    // triggers that resolve `users` to this schema under the test
    // search_path.) Columns mirror the public table subset loadFacts reads.
    await db.query(`CREATE TABLE ${schema}.access_grants (
      id BIGSERIAL PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      capability VARCHAR(80) NOT NULL, subject_type VARCHAR(30) NOT NULL DEFAULT 'self',
      subject_id VARCHAR(64), subject_key VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active', provenance VARCHAR(40) NOT NULL,
      policy_version VARCHAR(60), expires_at TIMESTAMPTZ, version INTEGER NOT NULL DEFAULT 1)`);
    await db.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
      [ids.helper],
    );
  });
  afterAll(async () => { await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); });

  async function postedJob() {
    const jobId = crypto.randomUUID();
    await db.query(
      `INSERT INTO jobs(id, client_id, status, title, metadata)
       VALUES($1, $2, 'published', 'Fix sink', '{}'::jsonb)`,
      [jobId, ids.customer]
    );
    const bid = (await db.query(
      `INSERT INTO bids(job_id, helper_id, status, amount, amount_cents, eta_hours)
       VALUES($1, $2, 'pending', 100, 10000, 2) RETURNING id`,
      [jobId, ids.helper]
    )).rows[0];
    return { jobId, bidId: bid.id };
  }

  test('off_platform acceptance records the agreed price without moving money', async () => {
    const { jobId, bidId } = await postedJob();

    const res = await invoke({ bid_id: bidId, payment_method: 'off_platform' }, ids.customer);

    expect(res.error).toBeUndefined();
    expect(res.statusCode).toBe(200);
    const job = (await db.query(
      'SELECT status, assigned_helper_id, job_value, job_value_cents, payment_rail FROM jobs WHERE id = $1',
      [jobId]
    )).rows[0];
    expect(job.status).toBe('accepted');
    expect(job.assigned_helper_id).toBe(ids.helper);
    // The P1-2-F11 fix: the agreed price is recorded even for direct payment.
    expect(Number(job.job_value)).toBe(100);
    expect(job.job_value_cents).toBe(10000);
    expect(job.payment_rail).toBe('offline');
    const bid = (await db.query(
      'SELECT status, payment_method FROM bids WHERE id = $1', [bidId]
    )).rows[0];
    expect(bid.status).toBe('accepted');
    expect(bid.payment_method).toBe('off_platform');
  });
});
