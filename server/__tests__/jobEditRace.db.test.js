'use strict';

/**
 * Real-Postgres checks for the job-edit foundation (migration 760):
 * canonical-field triggers, version bumps, and the edit-vs-accept race.
 * Opt-in via JOB_EDIT_TEST_DATABASE_URL (a migrated, disposable, local DB).
 */

const url = process.env.JOB_EDIT_TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) throw new Error('JOB_EDIT_TEST_DATABASE_URL must be a local database');
  process.env.DATABASE_URL = url;
}
process.env.JWT_SECRET = process.env.JWT_SECRET || 'job-edit-db-test-secret-0123456789abcdef';
process.env.REDIS_URL = '';
process.env.FEATURE_PAYMENTS_ENABLED = 'true';

jest.unmock('pg');
// setup.js stubs transactions for mocked-pg tests; this file needs real ones.
jest.unmock('../utils/transaction');
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: req.headers['x-test-role'] || 'customer' }; next(); },
  optionalAuth: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
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
const { acceptCurrentConsents, currentConsentRows } = require('./helpers/currentConsents');
const describeDb = url ? describe : describe.skip;

describeDb('job edit foundation on real Postgres', () => {
  let pool; let app; let request;
  const customer = crypto.randomUUID();
  const helpers = [crypto.randomUUID(), crypto.randomUUID()];
  const jobIds = [];

  async function makeJob() {
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs (client_id, title, description, status, budget_type, budget_min_cents, budget_max_cents, location_city, location_state)
       VALUES ($1, 'Replace the broken fence panel', $2, 'published', 'fixed', 20000, 20000, 'Austin', 'TX') RETURNING *`,
      [customer, 'Fence panel replacement. '.repeat(4)]
    );
    jobIds.push(job.id);
    const { rows: [bid] } = await pool.query(
      `INSERT INTO bids (job_id, helper_id, amount, status, job_revision, expires_at)
       VALUES ($1, $2, 180, 'pending', 1, NOW() + INTERVAL '7 days') RETURNING *`,
      [job.id, helpers[0]]
    );
    return { job, bid };
  }

  beforeAll(async () => {
    pool = require('../db');
    request = require('supertest');
    const express = require('express');
    app = express();
    app.use(express.json());
    app.use('/api/jobs', require('../routes/jobs'));
    app.use('/api/bids', require('../routes/bids'));
    for (const [id, role] of [[customer, 'customer'], [helpers[0], 'helper'], [helpers[1], 'helper']]) {
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role)
         VALUES ($1, $2, 'x', 'Job', 'Edit', $3)`,
        [id, `${id}@job-edit.test`, role]
      );
      await acceptCurrentConsents(pool, id);
    }
  }, 30000);

  test('terms gate uses the latest accepted_at record and denies missing or outdated consent', async () => {
    const gate = require('../middleware/requireTermsAcceptance');
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    try {
      await pool.query('DELETE FROM user_consents WHERE user_id = $1', [customer]);
      await gate({ user: { id: customer } }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();

      await acceptCurrentConsents(pool, customer);
      await pool.query("UPDATE user_consents SET accepted_at = NOW() - INTERVAL '2 minutes' WHERE user_id = $1", [customer]);
      await pool.query(
        `INSERT INTO user_consents (user_id, consent_type, version, ip_hash, user_agent, accepted_at)
         VALUES ($1, $2, '2000-01-01', $3, 'synthetic-consent-fixture', NOW() - INTERVAL '1 minute')`,
        [customer, currentConsentRows()[0].consent_type, 'a'.repeat(64)],
      );
      res.status.mockClear();
      await gate({ user: { id: customer } }, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();

      await acceptCurrentConsents(pool, customer);
      res.status.mockClear();
      await gate({ user: { id: customer } }, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    } finally {
      await pool.query('DELETE FROM user_consents WHERE user_id = $1', [customer]);
      await acceptCurrentConsents(pool, customer);
    }
  });

  afterAll(async () => {
    for (const sql of [
      'DELETE FROM job_payment_reauthorizations WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM payments WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM job_event_outbox WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM job_revisions WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM appointments WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM bids WHERE job_id = ANY($1::uuid[])',
      'DELETE FROM notifications WHERE user_id = ANY($2::uuid[])',
      'DELETE FROM jobs WHERE id = ANY($1::uuid[])',
    ]) await pool.query(sql, sql.includes('$2') ? [jobIds, [customer, ...helpers]] : [jobIds]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[customer, ...helpers]]).catch(() => {});
    await pool.end();
  }, 30000);

  test('cents are canonical; dollars, schedule mirrors and search document follow', async () => {
    const { job } = await makeJob();
    expect(Number(job.budget_min)).toBe(200);
    expect(job.version).toBe(1);
    const { rows: [after] } = await pool.query(
      `UPDATE jobs SET budget_max_cents = 25050, scheduled_start_at = '2030-05-01T09:00:00Z', scheduled_precision = 'date'
        WHERE id = $1 RETURNING *, search_document::text AS doc`,
      [job.id]
    );
    expect(Number(after.budget_max)).toBe(250.5);
    expect(after.version).toBe(2);
    expect(after.scheduled_date.toISOString().slice(0, 10)).toBe('2030-05-01');
    expect(after.scheduled_time).toBeNull();
    expect(after.doc).toMatch(/fenc/);
  });

  test('counter-only updates do not bump the version', async () => {
    const { job } = await makeJob();
    const { rows: [after] } = await pool.query('UPDATE jobs SET bid_count = bid_count + 1 WHERE id = $1 RETURNING version', [job.id]);
    expect(after.version).toBe(job.version);
  });

  test('bid amount_cents mirrors amount', async () => {
    const { bid } = await makeJob();
    expect(Number(bid.amount_cents)).toBe(18000);
  });

  test('material PATCH flags the bid, writes a revision and one outbox row per type', async () => {
    const { job, bid } = await makeJob();
    const res = await request(app).patch(`/api/jobs/${job.id}`).set('x-test-actor', customer)
      .set('If-Match', `W/"job-${job.id}-v${job.version}"`).send({ budget_min_cents: 15000, budget_max_cents: 15000 });
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(2);
    const { rows: [b] } = await pool.query('SELECT needs_reconfirm, expires_at FROM bids WHERE id = $1', [bid.id]);
    expect(b.needs_reconfirm).toBe(true);
    expect(new Date(b.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 48 * 3600e3 + 60e3);
    const { rows: revs } = await pool.query('SELECT is_material FROM job_revisions WHERE job_id = $1', [job.id]);
    expect(revs).toEqual([{ is_material: true }]);
    const { rows: events } = await pool.query('SELECT event_type FROM job_event_outbox WHERE job_id = $1 ORDER BY event_type', [job.id]);
    expect(events.map((e) => e.event_type)).toEqual(['job.material_change', 'job.updated']);
  });

  test('edit vs accept race: never both succeed; the stale bid is never accepted', async () => {
    for (let i = 0; i < 8; i += 1) {
      const { job, bid } = await makeJob();
      const [edit, accept] = await Promise.all([
        request(app).patch(`/api/jobs/${job.id}`).set('x-test-actor', customer)
          .set('If-Match', `W/"job-${job.id}-v${job.version}"`).send({ budget_min_cents: 9000, budget_max_cents: 9000 }),
        request(app).post('/api/jobs/assign').set('x-test-actor', customer)
          .send({ bid_id: bid.id, payment_method: 'off_platform' }),
      ]);
      const outcomes = [edit.status, accept.status];
      expect(outcomes.filter((s) => s === 200).length).toBe(1);
      const { rows: [final] } = await pool.query('SELECT status, revision, budget_max_cents FROM jobs WHERE id = $1', [job.id]);
      if (edit.status === 200) {
        expect(accept.status).toBe(409);
        expect(['bid_needs_reconfirm', 'job_not_acceptable', 'version_conflict']).toContain(accept.body.code);
        expect(final.status).toBe('published');
      } else {
        expect(accept.status).toBe(200);
        // The accept may bump the job version before the edit reads it, in
        // which case the If-Match precondition fails with 412 instead of 409.
        expect([409, 412]).toContain(edit.status);
        expect(final.status).toBe('accepted');
        expect(Number(final.budget_max_cents)).toBe(20000);
      }
    }
  }, 60000);

  test('create → feed search with keyset cursor → owner detail with ETag (real SQL)', async () => {
    const created = await request(app).post('/api/jobs').set('x-test-actor', customer).send({
      title: 'Paint the backyard shed quickly', description: 'Two coats on a small wooden shed, paint provided. '.repeat(2),
      category_name: 'Painting', budget_type: 'fixed', budget_min_cents: 30000, budget_max_cents: 30000,
      location_city: 'Austin', location_state: 'TX', location_country: 'US',
    });
    expect([200, 201]).toContain(created.status);
    jobIds.push(created.body.id || created.body.job?.id);
    for (let i = 0; i < 3; i += 1) await makeJob();
    const page1 = await request(app).get('/api/jobs?search=fenc&limit=2&include_total=false');
    expect(page1.status).toBe(200);
    expect(page1.body.jobs.length).toBe(2);
    expect(page1.body.next_cursor).toBeTruthy();
    expect(page1.body.jobs[0].location_lat).toBeUndefined();
    const page2 = await request(app).get(`/api/jobs?search=fenc&limit=2&include_total=false&cursor=${encodeURIComponent(page1.body.next_cursor)}`);
    expect(page2.status).toBe(200);
    const ids1 = page1.body.jobs.map((j) => j.id);
    expect(page2.body.jobs.some((j) => ids1.includes(j.id))).toBe(false);
    const budget = await request(app).get('/api/jobs?budget_min=250&limit=50');
    expect(budget.status).toBe(200);
    const detail = await request(app).get(`/api/jobs/${ids1[0]}`).set('x-test-actor', customer);
    expect(detail.status).toBe(200);
    expect(detail.headers.etag).toMatch(/^W\/"job-/);
  }, 30000);

  test('bid → material edit → helper reconfirms → owner can hire (real SQL)', async () => {
    const { job } = await makeJob();
    const placed = await request(app).post('/api/bids').set('x-test-actor', helpers[1]).set('x-test-role', 'helper')
      .send({ job_id: job.id, amount: 190, message: 'I can do this tomorrow morning.', eta_hours: 3, job_revision: 1 });
    expect([200, 201]).toContain(placed.status);
    const bidId = placed.body.id || placed.body.bid?.id;
    const edit = await request(app).patch(`/api/jobs/${job.id}`).set('x-test-actor', customer)
      .set('If-Match', `W/"job-${job.id}-v${job.version}"`).send({ title: 'Replace two broken fence panels' });
    expect(edit.status).toBe(200);
    expect(edit.body.bids_flagged_for_reconfirm).toBe(2);
    const bids = await request(app).get(`/api/bids/job/${job.id}`).set('x-test-actor', customer);
    expect(bids.status).toBe(200);
    const revs = await request(app).get(`/api/jobs/${job.id}/revisions`).set('x-test-actor', helpers[1]).set('x-test-role', 'helper');
    expect(revs.status).toBe(200);
    expect(revs.body.revisions[0].changes.title).toBeTruthy();
    const blocked = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bidId, payment_method: 'off_platform' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('bid_needs_reconfirm');
    const reconfirmed = await request(app).post(`/api/bids/${bidId}/reconfirm`).set('x-test-actor', helpers[1]).set('x-test-role', 'helper').send({});
    expect(reconfirmed.status).toBe(200);
    const hired = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bidId, payment_method: 'off_platform' });
    expect(hired.status).toBe(200);
  }, 30000);

  test('outbox worker drains queued events and partition maintenance runs (real SQL)', async () => {
    const { job } = await makeJob();
    await request(app).patch(`/api/jobs/${job.id}`).set('x-test-actor', customer)
      .set('If-Match', `W/"job-${job.id}-v${job.version}"`).send({ notes: 'Side gate is unlocked' });
    await pool.query(`UPDATE job_event_outbox SET next_attempt_at = NOW() WHERE job_id = ANY($1::uuid[])`, [jobIds]);
    const { processJobEventOutbox } = require('../jobs/jobEventOutbox');
    const summary = await processJobEventOutbox(500);
    expect(summary.claimed).toBeGreaterThan(0);
    expect(summary.failed).toBe(0);
    const { rows } = await pool.query(`SELECT status, last_error FROM job_event_outbox WHERE job_id = $1`, [job.id]);
    expect(rows.every((r) => r.status === 'sent')).toBe(true);
    const { maintainJobRevisionPartitions } = require('../jobs/jobRevisionMaintenance');
    const result = await maintainJobRevisionPartitions();
    expect(Array.isArray(result.dropped)).toBe(true);
  }, 30000);

  test('admin rollback restores the previous value through the same pipeline (real SQL)', async () => {
    const { job } = await makeJob();
    const edit = await request(app).patch(`/api/jobs/${job.id}`).set('x-test-actor', customer)
      .set('If-Match', `W/"job-${job.id}-v${job.version}"`).send({ notes: 'Wrong note' });
    const { rows: [rev] } = await pool.query('SELECT id FROM job_revisions WHERE job_id = $1', [job.id]);
    const { rollbackJobRevision } = require('../services/jobEditService');
    const result = await rollbackJobRevision({
      jobId: job.id, revisionId: String(rev.id), actor: { id: customer, role: 'admin' },
      reason: 'Support restored the note', expectedVersion: edit.body.version, preconditionSource: 'body',
    });
    expect(result.job.notes ?? null).toBeNull();
  }, 30000);

  test('approved change order reprices an accepted job in one transaction (real SQL)', async () => {
    const { job, bid } = await makeJob();
    const hired = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bid.id, payment_method: 'off_platform' });
    expect(hired.status).toBe(200);
    const { withTransaction } = require('../utils/transaction');
    const { applyApprovedChangeOrder } = require('../services/jobChangeOrderFinance');
    const { rows: [co] } = await pool.query(
      `SELECT gen_random_uuid() AS id, 2500 AS price_change_cents`
    );
    const out = await withTransaction(pool, (client) => applyApprovedChangeOrder(client, {
      agreement: { id: null, job_id: job.id, helper_id: helpers[0] }, changeOrder: co, actorId: customer,
    }));
    expect(out.adjustment).toMatchObject({ from_value_cents: 18000, to_value_cents: 20500 });
    const { rows: [after] } = await pool.query('SELECT job_value_cents FROM jobs WHERE id = $1', [job.id]);
    expect(Number(after.job_value_cents)).toBe(20500);
  }, 30000);

  test('change-order increase: completion blocked, card re-authorization (decline, retry, 3DS confirm), old hold released', async () => {
    const stripe = require('stripe').__mockInstance;
    stripe.paymentIntents.cancel = jest.fn().mockResolvedValue({ status: 'canceled' });
    const reauth = require('../services/jobPaymentReauthorizationService');
    const { job, bid } = await makeJob();
    // Same helper, same default calendar slot as the previous test's hire: the
    // appointment insert conflicts, and the hire must still commit.
    const hired = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bid.id, payment_method: 'off_platform' });
    expect(hired.status).toBe(200);
    const { rows: [persisted] } = await pool.query('SELECT status, assigned_helper_id FROM jobs WHERE id = $1', [job.id]);
    expect(persisted).toMatchObject({ status: 'accepted', assigned_helper_id: helpers[0] });
    await pool.query('UPDATE jobs SET job_value_cents = 18000 WHERE id = $1', [job.id]);
    const oldPi = `pi_old_${crypto.randomUUID().slice(0, 8)}`;
    const newPi = `pi_new_${crypto.randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO payments (job_id, payer_id, payee_id, stripe_payment_intent_id, amount, platform_fee, status, payment_hold_status, stripe_account_id, metadata)
       VALUES ($1, $2, $3, $4, 180, 0, 'authorized', 'held', 'acct_test', '{}'::jsonb)`,
      [job.id, customer, helpers[0], oldPi]
    );
    const { withTransaction } = require('../utils/transaction');
    const { applyApprovedChangeOrder } = require('../services/jobChangeOrderFinance');
    const out = await withTransaction(pool, (client) => applyApprovedChangeOrder(client, {
      agreement: { id: null, job_id: job.id, helper_id: helpers[0] },
      changeOrder: { id: crypto.randomUUID(), price_change_cents: 2500 }, actorId: customer,
    }));
    expect(out.adjustment.payment_action).toBe('reauthorization_required');

    await pool.query(`UPDATE jobs SET status = 'in_progress' WHERE id = $1`, [job.id]);
    const blocked = await request(app).post(`/api/jobs/${job.id}/complete`).set('x-test-actor', customer).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('payment_reauthorization_required');

    const state = await request(app).get(`/api/jobs/${job.id}/payment-reauthorization`).set('x-test-actor', customer);
    expect(state.status).toBe(200);
    expect(state.body).toMatchObject({ required: true, can_authorize: true, requirement: { card: 'reauthorization_required', authorized_cents: 18000, increase_cents: 2500, target_cents: 20500 } });
    const helperView = await request(app).get(`/api/jobs/${job.id}/payment-reauthorization`).set('x-test-actor', helpers[0]).set('x-test-role', 'helper');
    expect(helperView.body).toMatchObject({ required: true, can_authorize: false });
    expect(helperView.body.requirement.target_cents).toBeUndefined();
    const stranger = await request(app).post(`/api/jobs/${job.id}/payment-reauthorization`).set('x-test-actor', helpers[0]).set('x-test-role', 'helper').send({});
    expect(stranger.status).toBe(403);

    stripe.paymentIntents.create.mockResolvedValueOnce({ id: newPi, client_secret: `${newPi}_secret`, status: 'requires_payment_method' });
    const started = await request(app).post(`/api/jobs/${job.id}/payment-reauthorization`).set('x-test-actor', customer).send({ method: 'card' });
    expect(started.status).toBe(201);
    expect(started.body).toMatchObject({ status: 'requires_confirmation', client_secret: `${newPi}_secret`, stripe_account_id: 'acct_test', attempt: { amount_cents: 20500, status: 'pending' } });
    const createArgs = stripe.paymentIntents.create.mock.calls.at(-1);
    expect(createArgs[0]).toMatchObject({ amount: 20500, capture_method: 'manual', metadata: { job_reauthorization: 'true', job_id: job.id } });
    expect(createArgs[1]).toMatchObject({ stripeAccount: 'acct_test', idempotencyKey: `job-payment-reauth:${job.id}:1` });

    // Retry resumes the same attempt instead of creating another hold.
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({ id: newPi, client_secret: `${newPi}_secret`, status: 'requires_payment_method' });
    const resumed = await request(app).post(`/api/jobs/${job.id}/payment-reauthorization`).set('x-test-actor', customer).send({});
    expect(resumed.body.attempt.id).toBe(started.body.attempt.id);
    expect(stripe.paymentIntents.create).toHaveBeenCalledTimes(1);

    // Decline via webhook: attempt stays open for another card; customer notified via outbox.
    const pi = { id: newPi, metadata: { job_reauthorization: 'true', job_id: job.id } };
    await expect(reauth.applyReauthorizationWebhook('payment_intent.payment_failed',
      { ...pi, last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'Declined' } })).resolves.toBe(true);
    const { rows: [declined] } = await pool.query('SELECT * FROM job_payment_reauthorizations WHERE id = $1', [started.body.attempt.id]);
    expect(declined).toMatchObject({ status: 'pending', failure_code: 'insufficient_funds' });
    const { rows: failedEvents } = await pool.query(`SELECT 1 FROM job_event_outbox WHERE job_id = $1 AND event_type = 'job.payment_reauth_failed'`, [job.id]);
    expect(failedEvents.length).toBe(1);

    // After 3DS succeeds in the browser, confirm moves the payment onto the new intent.
    stripe.paymentIntents.retrieve.mockResolvedValueOnce({ ...pi, status: 'requires_capture', amount: 20500, amount_capturable: 20500 });
    const confirmed = await request(app).post(`/api/jobs/${job.id}/payment-reauthorization/${started.body.attempt.id}/confirm`).set('x-test-actor', customer).send({});
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('authorized');
    const { rows: [payment] } = await pool.query('SELECT * FROM payments WHERE job_id = $1', [job.id]);
    expect(payment).toMatchObject({ stripe_payment_intent_id: newPi, capture_amount_cents: 20500, pending_increase_cents: 0, status: 'authorized' });
    expect(Number(payment.amount)).toBe(205);
    expect(payment.metadata.superseded_payment_intent_ids).toEqual([oldPi]);
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(oldPi, {}, expect.objectContaining({ stripeAccount: 'acct_test' }));
    const { rows: [jobAfter] } = await pool.query('SELECT metadata FROM jobs WHERE id = $1', [job.id]);
    expect(jobAfter.metadata.paymentAdjustmentRequired).toBeUndefined();
    const { rows: [attemptAfter] } = await pool.query('SELECT * FROM job_payment_reauthorizations WHERE id = $1', [started.body.attempt.id]);
    expect(attemptAfter.status).toBe('authorized');
    expect(attemptAfter.previous_intent_canceled_at).not.toBeNull();

    // A late webhook for the same authorization is a no-op.
    await reauth.applyReauthorizationWebhook('payment_intent.amount_capturable_updated', { ...pi, status: 'requires_capture', amount_capturable: 20500 });
    const { rows: okEvents } = await pool.query(`SELECT 1 FROM job_event_outbox WHERE job_id = $1 AND event_type = 'job.payment_reauthorized'`, [job.id]);
    expect(okEvents.length).toBe(1);

    const done = await request(app).post(`/api/jobs/${job.id}/complete`).set('x-test-actor', customer).send({});
    expect(done.status).toBe(200);
  }, 30000);

  test('stale re-authorization attempts expire and release their card hold', async () => {
    const stripe = require('stripe').__mockInstance;
    stripe.paymentIntents.cancel = jest.fn().mockResolvedValue({ status: 'canceled' });
    const { job } = await makeJob();
    const intentId = `pi_stale_${crypto.randomUUID().slice(0, 8)}`;
    await pool.query(
      `INSERT INTO job_payment_reauthorizations (job_id, method, kind, status, attempt, amount_cents, stripe_payment_intent_id, stripe_account_id, expires_at)
       VALUES ($1, 'card', 'replacement', 'pending', 1, 1000, $2, 'acct_test', NOW() - INTERVAL '1 minute')`,
      [job.id, intentId]
    );
    const { expireStaleReauthorizations } = require('../services/jobPaymentReauthorizationService');
    expect(await expireStaleReauthorizations()).toBeGreaterThanOrEqual(1);
    const { rows: [row] } = await pool.query('SELECT status FROM job_payment_reauthorizations WHERE stripe_payment_intent_id = $1', [intentId]);
    expect(row.status).toBe('expired');
    expect(stripe.paymentIntents.cancel).toHaveBeenCalledWith(intentId, {}, expect.objectContaining({ stripeAccount: 'acct_test' }));
  }, 30000);
});
