'use strict';

/**
 * Real-Postgres checks for the payment layers (migrations 762-764): currency
 * exponent / bid-currency / timezone triggers, the country tax gate, rail
 * selection at acceptance and rail switching. Opt-in via
 * JOB_EDIT_TEST_DATABASE_URL (a migrated, disposable, local DB).
 */

const url = process.env.JOB_EDIT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('JOB_EDIT_TEST_DATABASE_URL must be a local database');
  process.env.DATABASE_URL = url;
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'payment-layers-db-test-secret-0123456789';
process.env.REDIS_URL = '';
process.env.FEATURE_PAYMENTS_ENABLED = 'true';

jest.unmock('pg');
jest.unmock('../utils/transaction');
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: req.headers['x-test-role'] || 'customer' }; next(); },
  optionalAuth: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/adminAuth', () => ({
  requireAdmin: (req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: 'admin' }; next(); },
  requireSuperAdmin: (req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: 'super_admin' }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/requireEmailVerified', () => (_req, _res, next) => next());
jest.mock('../middleware/helperOnboardingMiddleware', () => ({
  requireOnboardingStep: () => (_req, _res, next) => next(),
  requireHelperWorkEligible: (_req, _res, next) => next(),
}));
jest.mock('../middleware/checkRestrictions', () => () => (_req, _res, next) => next());
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn(), emitToUser: jest.fn(), getIO: () => null }));

const crypto = require('node:crypto');
const { acceptCurrentConsents } = require('./helpers/currentConsents');
const describeDb = url ? describe : describe.skip;

const FLAG_ENV = ['FEATURE_PAYMENT_RAILS', 'FEATURE_RAIL_OFFLINE_GATING', 'FEATURE_JOB_TIMEZONES'];

describeDb('payment layers on real Postgres', () => {
  let pool; let app; let request; let railPolicy;
  const customer = crypto.randomUUID();
  const helper = crypto.randomUUID();
  const jobIds = [];
  let savedPolicy;

  async function makeJob({ country = 'US', currency = 'USD', status = 'published', min = 20000 } = {}) {
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs (client_id, title, description, status, budget_type, budget_min_cents, budget_max_cents,
                         location_city, location_country, location_country_code, currency_code)
       VALUES ($1, 'Paint the garden shed', $2, $3, 'fixed', $4, $4, 'Town', $5, $6, $7) RETURNING *`,
      [customer, 'Two coats of exterior paint. '.repeat(4), status, min, country, country, currency]
    );
    jobIds.push(job.id);
    return job;
  }

  // Minor units of the job currency (the canonical column).
  async function makeBid(job, amountMinor = 18000) {
    const { rows: [bid] } = await pool.query(
      `INSERT INTO bids (job_id, helper_id, amount_cents, status, job_revision, expires_at)
       VALUES ($1, $2, $3, 'pending', 1, NOW() + INTERVAL '7 days') RETURNING *`,
      [job.id, helper, amountMinor]
    );
    return bid;
  }

  beforeAll(async () => {
    pool = require('../db');
    railPolicy = require('../services/paymentRailPolicy');
    request = require('supertest');
    const express = require('express');
    app = express();
    app.use(express.json());
    app.use('/api/jobs', require('../routes/jobs'));
    app.use('/api/bids', require('../routes/bids'));
    app.use('/api/payment-layers', require('../routes/paymentLayers'));
    for (const [id, role] of [[customer, 'customer'], [helper, 'helper']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES ($1, $2, 'x', 'Pay', 'Layers', $3)`,
        [id, `${id}@payment-layers.test`, role]
      );
      await acceptCurrentConsents(pool, id);
    }
    const { rows } = await pool.query(`SELECT * FROM payment_country_policies WHERE country_code = 'CA'`);
    savedPolicy = rows[0];
  }, 30000);

  afterEach(() => {
    for (const key of FLAG_ENV) delete process.env[key];
    railPolicy.clearPolicyCache();
  });

  afterAll(async () => {
    if (savedPolicy) {
      await pool.query(
        `UPDATE payment_country_policies SET enabled = $2, tax_review_cleared = $3, offline_rail_enabled = $4, stripe_rail_enabled = $5 WHERE country_code = $1`,
        ['CA', savedPolicy.enabled, savedPolicy.tax_review_cleared, savedPolicy.offline_rail_enabled, savedPolicy.stripe_rail_enabled]
      ).catch(() => {});
    }
    for (const sql of [
      'DELETE FROM job_rail_switch_requests WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM offline_payment_confirmations WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM payments WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM job_event_outbox WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM job_revisions WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM appointments WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM bids WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM notifications WHERE user_id = ANY($2::uuid[])',
      'DELETE FROM jobs WHERE id = ANY($1::uuid[])',
    ]) await pool.query(sql, sql.includes('$2') ? [jobIds, [customer, helper]] : [jobIds]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[customer, helper]]).catch(() => {});
    await pool.end();
  }, 30000);

  test('zero-decimal currencies mirror whole units; bids default to the job currency', async () => {
    const job = await makeJob({ country: 'US', currency: 'JPY', min: 1500 });
    expect(Number(job.budget_min)).toBe(1500);
    const bid = await makeBid(job, 1200);
    expect(bid.currency_code).toBe('JPY');
    expect(Number(bid.amount_cents)).toBe(1200);
    expect(Number(bid.amount)).toBe(1200);
  });

  test('a bid in another currency is rejected by the database (decision #11)', async () => {
    const job = await makeJob({ country: 'CA', currency: 'CAD' });
    await expect(pool.query(
      `INSERT INTO bids (job_id, helper_id, amount, currency_code, status, job_revision) VALUES ($1, $2, 100, 'USD', 'pending', 1)`,
      [job.id, helper]
    )).rejects.toMatchObject({ code: '23514' });
  });

  test('the bid API returns 409 bid_currency_mismatch', async () => {
    const job = await makeJob({ country: 'CA', currency: 'CAD' });
    const res = await request(app).post('/api/bids').set('x-test-actor', helper).set('x-test-role', 'helper')
      .send({ job_id: job.id, amount: 150, currency_code: 'USD', message: 'I can paint this shed this week.' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('bid_currency_mismatch');
  });

  test('date-only schedules anchor at 09:00 in the job time zone', async () => {
    const job = await makeJob();
    const { rows: [after] } = await pool.query(
      `UPDATE jobs SET timezone = 'America/Toronto', scheduled_start_at = '2030-06-03T09:00:00Z', scheduled_precision = 'date'
        WHERE id = $1 RETURNING scheduled_start_at, scheduled_date`,
      [job.id]
    );
    expect(after.scheduled_start_at.toISOString()).toBe('2030-06-03T13:00:00.000Z');
  });

  test('a country cannot be enabled before its tax review clears (decision #13)', async () => {
    await expect(pool.query(`UPDATE payment_country_policies SET enabled = TRUE, tax_review_cleared = FALSE WHERE country_code = 'HT'`))
      .rejects.toMatchObject({ code: '23514' });
    const res = await request(app).put('/api/payment-layers/admin/country-policies/HT').set('x-test-actor', customer).send({ enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('country_tax_review_pending');
  });

  test('flags off: acceptance is unchanged and records the legacy rail', async () => {
    const job = await makeJob();
    const bid = await makeBid(job);
    const res = await request(app).post('/api/jobs/assign').set('x-test-actor', customer).send({ bid_id: bid.id, payment_method: 'off_platform' });
    expect(res.status).toBe(200);
    const { rows: [after] } = await pool.query('SELECT payment_rail, settlement_currency FROM jobs WHERE id = $1', [job.id]);
    expect(after.payment_rail).toBe('offline');
  });

  test('engine on: a disabled country blocks every rail', async () => {
    process.env.FEATURE_PAYMENT_RAILS = 'true';
    const job = await makeJob({ country: 'KE', currency: 'KES' });
    const bid = await makeBid(job, 500000);
    const options = await request(app).get(`/api/payment-layers/jobs/${job.id}/options`).query({ bid_id: bid.id }).set('x-test-actor', customer);
    expect(options.status).toBe(200);
    expect(options.body.rails.every((r) => !r.available && r.reason === 'country_tax_review_pending')).toBe(true);
    const res = await request(app).post('/api/jobs/assign').set('x-test-actor', customer).send({ bid_id: bid.id, payment_rail: 'offline', offline_ack: true });
    expect(res.status).toBe(409);
  });

  test('engine on: offline needs the not-covered acknowledgement, then a switch to card needs both parties', async () => {
    process.env.FEATURE_PAYMENT_RAILS = 'true';
    await pool.query(`UPDATE payment_country_policies SET tax_review_cleared = TRUE, enabled = TRUE, offline_rail_enabled = TRUE WHERE country_code = 'CA'`);
    railPolicy.clearPolicyCache();
    const job = await makeJob({ country: 'CA', currency: 'CAD' });
    const bid = await makeBid(job, 15000);
    const noAck = await request(app).post('/api/jobs/assign').set('x-test-actor', customer).send({ bid_id: bid.id, payment_rail: 'offline' });
    expect(noAck.status).toBe(422);
    expect(noAck.body.code).toBe('offline_ack_required');
    const ok = await request(app).post('/api/jobs/assign').set('x-test-actor', customer).send({ bid_id: bid.id, payment_rail: 'offline', offline_ack: true });
    expect(ok.status).toBe(200);
    const { rows: [after] } = await pool.query('SELECT payment_rail, settlement_currency, offline_ack_at FROM jobs WHERE id = $1', [job.id]);
    expect(after).toMatchObject({ payment_rail: 'offline', settlement_currency: 'CAD' });
    expect(after.offline_ack_at).not.toBeNull();

    // Back to a more protected rail: CA card rail needs the stripe flag in
    // the country, so first prove a disabled rail cannot be requested.
    const blocked = await request(app).post(`/api/payment-layers/jobs/${job.id}/rail-switch`).set('x-test-actor', customer).send({ to_rail: 'stripe' });
    expect(blocked.status).toBe(409);

    // Helper-initiated switch to offline is a no-op target (already offline);
    // use the US path for the consent flow.
    const us = await makeJob();
    const usBid = await makeBid(us);
    expect((await request(app).post('/api/jobs/assign').set('x-test-actor', customer).send({ bid_id: usBid.id, payment_rail: 'offline', offline_ack: true })).status).toBe(200);
    const asked = await request(app).post(`/api/payment-layers/jobs/${us.id}/rail-switch`).set('x-test-actor', helper).set('x-test-role', 'helper').send({ to_rail: 'stripe' });
    expect(asked.status).toBe(201);
    const requestId = asked.body.request.id;
    const self = await request(app).post(`/api/payment-layers/jobs/${us.id}/rail-switch/${requestId}/respond`).set('x-test-actor', helper).set('x-test-role', 'helper').send({ accept: true });
    expect(self.status).toBe(403);
    const accepted = await request(app).post(`/api/payment-layers/jobs/${us.id}/rail-switch/${requestId}/respond`).set('x-test-actor', customer).send({ accept: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ status: 'accepted', rail: 'stripe' });
    const { rows: [switched] } = await pool.query('SELECT payment_rail FROM jobs WHERE id = $1', [us.id]);
    expect(switched.payment_rail).toBe('stripe');
  });

  test('offline payment confirmation records each side', async () => {
    process.env.FEATURE_PAYMENT_RAILS = 'true';
    const job = await makeJob();
    const bid = await makeBid(job);
    expect((await request(app).post('/api/jobs/assign').set('x-test-actor', customer).send({ bid_id: bid.id, payment_rail: 'offline', offline_ack: true })).status).toBe(200);
    const missing = await request(app).post(`/api/payment-layers/jobs/${job.id}/offline-payment/confirm`).set('x-test-actor', helper).set('x-test-role', 'helper').send({});
    expect(missing.status).toBe(400);
    const res = await request(app).post(`/api/payment-layers/jobs/${job.id}/offline-payment/confirm`).set('x-test-actor', helper).set('x-test-role', 'helper').send({ acknowledge_not_covered: true });
    expect(res.status).toBe(200);
    expect(res.body.confirmation.helper_confirmed_at).toBeTruthy();
    expect(res.body.confirmation.customer_ack_not_covered_at).toBeTruthy();
  });
});
