'use strict';
// D-472 (281, G5-1): completion pays out with no attendance check. A
// physical-site job (it carries a location address) must have attendance
// evidence — attendance confirmation or a recorded arrival — before a
// completion request, a client completion, or the 72 h auto-confirm can
// capture escrow. Remote / no-location jobs are exempt.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/(credit_statement_test|pa_g\d+|g56)$/.test(parsed.pathname)) throw new Error('Disposable database required');
process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); };
  return { authenticate, requireAuth: authenticate };
});
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg'); jest.unmock('../db'); jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { autoConfirmHelperCompletions } = require('../controllers/jobController');
const describeDb = raw ? describe : describe.skip;
const clientId = crypto.randomUUID(), helperId = crypto.randomUUID(), strangerId = crypto.randomUUID();
let app;
const as = (u) => ({ 'x-user': u });
const jobs = {};

describeDb('Groups 5-6: completion requires attendance on physical-site jobs (281)', () => {
  const mkJob = async (key, { address = '12 Maple Court', mode = 'direct', attendance = false, requestedDaysAgo = null } = {}) => {
    const attendedAt = attendance ? new Date().toISOString() : null;
    const requestedAt = requestedDaysAgo == null ? null : new Date(Date.now() - requestedDaysAgo * 864e5).toISOString();
    const requestedBy = requestedDaysAgo == null ? null : helperId;
    const { rows: [job] } = await pool.query(
      `INSERT INTO jobs(client_id, assigned_helper_id, title, description, status, transaction_mode, location_address, location_city, location_state, location_zip,
          attendance_confirmed_at, completion_requested_at, completion_requested_by)
       VALUES($1,$2,'Fix the sink','Leaking trap','in_progress',$3,$4,'Springfield','OH','43015', $5, $6, $7)
       RETURNING id`,
      [clientId, helperId, mode, address, attendedAt, requestedAt, requestedBy],
    );
    jobs[key] = job.id;
    return job.id;
  };
  beforeAll(async () => {
    for (const [id, email] of [[clientId, 'g56c-client'], [helperId, 'g56c-helper'], [strangerId, 'g56c-stranger']]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `${email}-${id}@example.invalid`]);
    }
    await mkJob('physical');
    await mkJob('remote', { address: null });
    await mkJob('autoSkip', { requestedDaysAgo: 4 });
    await mkJob('autoGo', { attendance: true, requestedDaysAgo: 4 });
    const escrowId = await mkJob('escrow', { mode: 'guided_protected' });
    await pool.query(
      `INSERT INTO payments(job_id, payer_id, payee_id, amount, status) VALUES($1,$2,$3,100,'authorized')`,
      [escrowId, clientId, helperId],
    );
    const router = require('../routes/jobs');
    app = express(); app.use(express.json());
    app.use('/jobs', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [Object.values(jobs)]);
    await pool.end();
  });

  test('client completion of an unattended physical job is refused, job stays in progress', async () => {
    const res = await request(app).post(`/jobs/${jobs.physical}/complete`).set(as(clientId)).expect(409);
    expect(res.body.code).toBe('attendance_required');
    const { rows: [job] } = await pool.query('SELECT status FROM jobs WHERE id=$1', [jobs.physical]);
    expect(job.status).toBe('in_progress');
  });

  test('helper completion of an unattended physical job is refused', async () => {
    const res = await request(app).post(`/jobs/${jobs.physical}/complete`).set(as(helperId)).expect(409);
    expect(res.body.code).toBe('attendance_required');
  });

  test('helper completion request on an unattended escrow job is refused before any request is recorded', async () => {
    const res = await request(app).post(`/jobs/${jobs.escrow}/complete`).set(as(helperId)).expect(409);
    expect(res.body.code).toBe('attendance_required');
    const { rows: [job] } = await pool.query('SELECT completion_requested_at FROM jobs WHERE id=$1', [jobs.escrow]);
    expect(job.completion_requested_at).toBeNull();
  });

  test('after attendance is confirmed the same job completes', async () => {
    await request(app).post(`/jobs/${jobs.physical}/attendance`).set(as(helperId)).expect(200);
    const res = await request(app).post(`/jobs/${jobs.physical}/complete`).set(as(clientId)).expect(200);
    expect(res.body.job.status).toBe('completed');
  });

  test('a remote (no-location) job completes with no attendance evidence', async () => {
    const res = await request(app).post(`/jobs/${jobs.remote}/complete`).set(as(clientId)).expect(200);
    expect(res.body.job.status).toBe('completed');
  });

  test('auto-confirm skips the unattended physical job and confirms the attended one', async () => {
    const out = await autoConfirmHelperCompletions({ limit: 50 });
    // Other suites may leave stale completion requests behind, so assert
    // on this file's two jobs, not on the global counts.
    expect(out.confirmed).toBeGreaterThanOrEqual(1);
    expect(out.failures.map((f) => String(f.jobId))).toContain(String(jobs.autoSkip));
    const { rows } = await pool.query('SELECT id, status FROM jobs WHERE id = ANY($1::uuid[])', [[jobs.autoSkip, jobs.autoGo]]);
    const byId = Object.fromEntries(rows.map((r) => [String(r.id), r.status]));
    expect(byId[String(jobs.autoSkip)]).toBe('in_progress');
    expect(byId[String(jobs.autoGo)]).toBe('completed');
  });
});
