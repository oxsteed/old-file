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

jest.unmock('pg');
// setup.js stubs transactions for mocked-pg tests; this file needs real ones.
jest.unmock('../utils/transaction');
jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => { req.user = { id: req.headers['x-test-actor'], role: 'customer' }; next(); },
  optionalAuth: (_req, _res, next) => next(),
  requireRole: () => (_req, _res, next) => next(),
}));
jest.mock('../middleware/requireEmailVerified', () => (_req, _res, next) => next());
jest.mock('../middleware/helperOnboardingMiddleware', () => ({ requireOnboardingStep: () => (_req, _res, next) => next() }));
jest.mock('../middleware/checkRestrictions', () => () => (_req, _res, next) => next());
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../services/socketService', () => ({ broadcastToUser: jest.fn(), emitToUser: jest.fn(), getIO: () => null }));

const crypto = require('node:crypto');
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
    }
  }, 30000);

  afterAll(async () => {
    for (const sql of [
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
        expect(edit.status).toBe(409);
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
    const placed = await request(app).post('/api/bids').set('x-test-actor', helpers[1])
      .send({ job_id: job.id, amount: 190, message: 'I can do this tomorrow morning.', eta_hours: 3, job_revision: 1 });
    expect([200, 201]).toContain(placed.status);
    const bidId = placed.body.id || placed.body.bid?.id;
    const edit = await request(app).patch(`/api/jobs/${job.id}`).set('x-test-actor', customer)
      .set('If-Match', `W/"job-${job.id}-v${job.version}"`).send({ title: 'Replace two broken fence panels' });
    expect(edit.status).toBe(200);
    expect(edit.body.bids_flagged_for_reconfirm).toBe(2);
    const bids = await request(app).get(`/api/bids/job/${job.id}`).set('x-test-actor', customer);
    expect(bids.status).toBe(200);
    const revs = await request(app).get(`/api/jobs/${job.id}/revisions`).set('x-test-actor', helpers[1]);
    expect(revs.status).toBe(200);
    expect(revs.body.revisions[0].changes.title).toBeTruthy();
    const blocked = await request(app).post('/api/jobs/assign').set('x-test-actor', customer)
      .send({ bid_id: bidId, payment_method: 'off_platform' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('bid_needs_reconfirm');
    const reconfirmed = await request(app).post(`/api/bids/${bidId}/reconfirm`).set('x-test-actor', helpers[1]).send({});
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
});
