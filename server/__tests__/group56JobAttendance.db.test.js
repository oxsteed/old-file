'use strict';
// D-451 (270, G5-4): POST /jobs/:id/attendance wires jobModel.confirmAttendance
// and the exact address stays hidden from the helper until it exists.
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
let app, jobId, job2Id;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: crew attendance confirmation (270)', () => {
  const mkJob = async () => pool.query(
    `INSERT INTO jobs(client_id, assigned_helper_id, title, description, status, location_address, location_city, location_state, location_zip)
     VALUES($1,$2,'Fix the sink','Leaking trap','accepted','12 Maple Court','Springfield','OH','43015') RETURNING id`,
    [clientId, helperId],
  ).then((r) => r.rows[0].id);
  beforeAll(async () => {
    for (const [id, email] of [[clientId, 'g56a-client'], [helperId, 'g56a-helper'], [strangerId, 'g56a-stranger']]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `${email}-${id}@example.invalid`]);
    }
    jobId = await mkJob();
    job2Id = await mkJob();
    const router = require('../routes/jobs');
    app = express(); app.use(express.json());
    app.use('/jobs', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [[jobId, job2Id]]);
    // Fixture users are left in place like other suites do: deleting any
    // user from this DB fails with "referential integrity query ... gave
    // unexpected result" because the no-delete RULE on
    // oxsteed_credit_partner_funding_records rewrites the RI probe.
    // Pre-existing shared-DB quirk, not this slice.
    await pool.end();
  });

  test('helper sees no exact address before attendance, client always does', async () => {
    const asHelper = (await request(app).get(`/jobs/${jobId}`).set(as(helperId)).expect(200)).body;
    expect(asHelper.location_address).toBeUndefined();
    expect(asHelper.location_city).toBe('Springfield');
    const asClient = (await request(app).get(`/jobs/${jobId}`).set(as(clientId)).expect(200)).body;
    expect(asClient.location_address).toBe('12 Maple Court');
  });

  test('only the assigned helper can confirm attendance, and only once', async () => {
    await request(app).post(`/jobs/${job2Id}/attendance`).set(as(strangerId)).expect(404);
    await request(app).post(`/jobs/${job2Id}/attendance`).set(as(clientId)).expect(404);
    const ok = (await request(app).post(`/jobs/${job2Id}/attendance`).set(as(helperId)).expect(200)).body;
    expect(ok.job.attendance_confirmed_at).toBeTruthy();
    expect(ok.job.location_address).toBe('12 Maple Court');
    await request(app).post(`/jobs/${job2Id}/attendance`).set(as(helperId)).expect(409);
  });

  test('helper sees the exact address after confirming attendance', async () => {
    await request(app).post(`/jobs/${jobId}/attendance`).set(as(helperId)).expect(200);
    const asHelper = (await request(app).get(`/jobs/${jobId}`).set(as(helperId)).expect(200)).body;
    expect(asHelper.location_address).toBe('12 Maple Court');
  });
});
