'use strict';
// Group 4 rest (items 185, 190): job-linked helper support and payment
// issue intake. Assigned helper only, retry-safe, staff alerted once.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/(credit_statement_test|pa_g\d+)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => ({ authenticate: (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); } }));
jest.mock('../services/supportNotificationService', () => ({ notifySupportStaff: jest.fn().mockResolvedValue({ sent: 1 }) }));
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { notifySupportStaff } = require('../services/supportNotificationService');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), other = crypto.randomUUID(), client = crypto.randomUUID();
let jobId, app;

describeDb('Group 4 rest: job support and payment issue intake (185, 190)', () => {
  beforeAll(async () => {
    for (const id of [helper, other, client]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Support','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4s-${id}@example.invalid`]);
    }
    for (const id of [helper, other]) await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [id]);
    const { rows: [job] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status) VALUES($1,$2,'Leak fix','Fixture','in_progress') RETURNING id`, [client, helper]);
    jobId = job.id;
    app = express(); app.use(express.json());
    app.use('/api/helpers/me', require('../routes/helperWork'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM support_tickets WHERE metadata->>'job_id' = $1", [jobId]);
    await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, other, client]]);
    await pool.end();
  });

  test('185: the assigned helper files a job ticket carrying the job reference; retry dedupes', async () => {
    const body = { kind: 'job_issue', message: 'Customer is not at the address', clientRequestId: crypto.randomUUID() };
    const first = await request(app).post(`/api/helpers/me/jobs/${jobId}/support`).set('x-user', helper).send(body).expect(201);
    expect(first.body.ticket).toMatchObject({ kind: 'job_issue', priority: 'normal', status: 'open' });
    const again = await request(app).post(`/api/helpers/me/jobs/${jobId}/support`).set('x-user', helper).send(body).expect(200);
    expect(again.body).toMatchObject({ duplicate: true, ticket: { id: first.body.ticket.id } });
    expect(notifySupportStaff).toHaveBeenCalledTimes(1);
    const { rows: [t] } = await pool.query('SELECT category, metadata FROM support_tickets WHERE id = $1', [first.body.ticket.id]);
    expect(t).toMatchObject({ category: 'helper_job', metadata: { job_id: jobId, kind: 'job_issue' } });
    const { rows: msgs } = await pool.query('SELECT content FROM support_messages WHERE ticket_id = $1', [first.body.ticket.id]);
    expect(msgs).toEqual([{ content: 'Customer is not at the address' }]);
  });

  test('190: payment issues are high priority in their own category', async () => {
    const res = await request(app).post(`/api/helpers/me/jobs/${jobId}/support`).set('x-user', helper)
      .send({ kind: 'payment_issue', message: 'Payout missing', clientRequestId: crypto.randomUUID() }).expect(201);
    expect(res.body.ticket.priority).toBe('high');
    const list = await request(app).get(`/api/helpers/me/jobs/${jobId}/support`).set('x-user', helper).expect(200);
    expect(list.body.tickets.map((x) => x.kind).sort()).toEqual(['job_issue', 'payment_issue']);
  });

  test('another helper, the customer, bad input, and a reused key are refused', async () => {
    const send = (user, body) => request(app).post(`/api/helpers/me/jobs/${jobId}/support`).set('x-user', user).send(body);
    const ok = { kind: 'job_issue', message: 'x', clientRequestId: crypto.randomUUID() };
    await send(other, ok).expect(404);
    await send(client, ok).expect(403);
    await send(helper, { ...ok, kind: 'refund_me' }).expect(400);
    await send(helper, { ...ok, clientRequestId: 'nope' }).expect(400);
    await send(helper, ok).expect(201);
    await send(helper, { ...ok, kind: 'payment_issue' }).expect(409);
    await request(app).get(`/api/helpers/me/jobs/${jobId}/support`).set('x-user', other).expect(404);
  });
});
