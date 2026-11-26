'use strict';
// D-474 (283, G5-36): accepting a bid writes a durable assignment audit
// event — who held the job, who moved it, and when — visible to the job's
// parties through the existing revisions read path and JobRevisionHistory.
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
const { assignHelper } = require('../controllers/jobController');
const describeDb = raw ? describe : describe.skip;
const clientId = crypto.randomUUID(), helperId = crypto.randomUUID();
let app, jobId, bidId;
const as = (u) => ({ 'x-user': u });

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
    next,
  ).then(() => res);
}

describeDb('Groups 5-6: assignment audit trail on bid acceptance (283)', () => {
  beforeAll(async () => {
    for (const [id, email] of [[clientId, 'g56t-client'], [helperId, 'g56t-helper']]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g56t-test','555-0100')", [id, `${email}-${id}@example.invalid`]);
    }
    await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [helperId]);
    ({ rows: [{ id: jobId }] } = await pool.query(
      `INSERT INTO jobs(client_id, title, description, status) VALUES($1,'Fix the sink','Leaking trap','published') RETURNING id`,
      [clientId],
    ));
    ({ rows: [{ id: bidId }] } = await pool.query(
      `INSERT INTO bids(job_id, helper_id, status, amount, amount_cents, eta_hours, expires_at, job_revision, needs_reconfirm)
       VALUES($1,$2,'pending',100,10000,2,NOW() + INTERVAL '7 days',1,FALSE) RETURNING id`,
      [jobId, helperId],
    ));
    const router = require('../routes/jobs');
    app = express(); app.use(express.json());
    app.use('/jobs', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM job_revisions WHERE job_id=$1', [jobId]);
    await pool.query('DELETE FROM appointments WHERE job_id=$1', [jobId]);
    await pool.query('DELETE FROM bids WHERE job_id=$1', [jobId]);
    await pool.query('DELETE FROM jobs WHERE id=$1', [jobId]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helperId, clientId]]);
    await pool.end();
  });

  test('accepting a bid records a material assignment revision and bumps the job version', async () => {
    const res = await invoke({ bid_id: bidId, payment_method: 'off_platform' }, clientId);
    expect(res.error).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(res.body.job.assigned_helper_id).toBe(helperId);
    const { rows: [job] } = await pool.query('SELECT status, version FROM jobs WHERE id=$1', [jobId]);
    expect(job.status).toBe('accepted');
    // The assign UPDATE bumps version (later steps bump it further via the
    // jobs trigger); what the history UI needs is version > 1.
    expect(job.version).toBeGreaterThan(1);
    const { rows: [rev] } = await pool.query(
      `SELECT source, is_material, actor_id, reason, changes FROM job_revisions WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [jobId],
    );
    expect(rev.source).toBe('owner');
    expect(rev.is_material).toBe(true);
    expect(String(rev.actor_id)).toBe(String(clientId));
    expect(rev.reason).toBe('Helper assigned via accepted bid');
    expect(rev.changes.assigned_helper_id.to).toBe(helperId);
    expect(rev.changes.assigned_helper_id.from).toBeNull();
  });

  test('the assigned helper sees the assignment event in the revisions read path', async () => {
    const res = await request(app).get(`/jobs/${jobId}/revisions`).set(as(helperId)).expect(200);
    const rows = res.body.revisions || res.body.data?.revisions || [];
    expect(rows.some((r) => r.source === 'owner' && r.changes?.assigned_helper_id?.to === helperId)).toBe(true);
  });
});
