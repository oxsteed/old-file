'use strict';
// D-473 (282, G5-19): job-linked material usage lines on helper_job_work.
// The assigned helper records description/quantity/cost per line; the
// client reads the same lines with the work record.
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
const describeDb = raw ? describe : describe.skip;
const clientId = crypto.randomUUID(), helperId = crypto.randomUUID(), strangerId = crypto.randomUUID();
let app, jobId;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: job material usage lines (282)', () => {
  beforeAll(async () => {
    for (const [id, email] of [[clientId, 'g56m-client'], [helperId, 'g56m-helper'], [strangerId, 'g56m-stranger']]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g56m-test','555-0100')", [id, `${email}-${id}@example.invalid`]);
    }
    await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [helperId]);
    ({ rows: [{ id: jobId }] } = await pool.query(
      `INSERT INTO jobs(client_id, assigned_helper_id, title, description, status) VALUES($1,$2,'Fix the sink','Leaking trap','in_progress') RETURNING id`,
      [clientId, helperId],
    ));
    const router = require('../routes/helperWork');
    app = express(); app.use(express.json());
    app.use('/helpers/me', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM helper_job_work_materials WHERE job_id=$1', [jobId]);
    await pool.query('DELETE FROM jobs WHERE id=$1', [jobId]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helperId, clientId]]);
    await pool.end();
  });

  test('helper adds a material line and the list carries it with the total', async () => {
    const added = (await request(app).post(`/helpers/me/work-records/${jobId}/materials`).set(as(helperId))
      .send({ description: '40A breaker', quantity: 2, unit: 'pcs', cost_cents: 1850, note: 'Spare fitted' }).expect(201)).body.material;
    expect(added.description).toBe('40A breaker');
    expect(Number(added.quantity)).toBe(2);
    expect(added.cost_cents).toBe(1850);
    const listed = (await request(app).get(`/helpers/me/work-records/${jobId}/materials`).set(as(helperId)).expect(200)).body;
    expect(listed.materials).toHaveLength(1);
    expect(listed.total_cost_cents).toBe(1850);
  });

  test('invalid quantity is refused and a stranger sees nothing', async () => {
    await request(app).post(`/helpers/me/work-records/${jobId}/materials`).set(as(helperId))
      .send({ description: 'Wire', quantity: 0 }).expect(400);
    await request(app).get(`/helpers/me/work-records/${jobId}/materials`).set(as(strangerId)).expect(404);
  });

  test('the client reads the lines with the work record and can remove one', async () => {
    const record = (await request(app).get(`/helpers/me/work-records/${jobId}`).set(as(clientId)).expect(200)).body;
    expect(record.materials).toHaveLength(1);
    expect(record.materials_total_cost_cents).toBe(1850);
    expect(record.materials[0].description).toBe('40A breaker');
    await request(app).delete(`/helpers/me/work-records/${jobId}/materials/${record.materials[0].id}`).set(as(clientId)).expect(200);
    const listed = (await request(app).get(`/helpers/me/work-records/${jobId}/materials`).set(as(helperId)).expect(200)).body;
    expect(listed.materials).toHaveLength(0);
    expect(listed.total_cost_cents).toBe(0);
  });
});
