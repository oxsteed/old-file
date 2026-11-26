'use strict';
// D-459 (265, G5-5 HIGH): POST /jobs/:id/exceptions routes a crew report to
// the helper's business owner (else the client) and tracks it to resolution.
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
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const clientId = crypto.randomUUID(), helperId = crypto.randomUUID(), helper2Id = crypto.randomUUID();
const ownerId = crypto.randomUUID(), strangerId = crypto.randomUUID();
let app, bizId, crewJobId, directJobId;
const as = (u) => ({ 'x-user': u });

describeDb('Groups 5-6: job exceptions (265)', () => {
  const mkJob = async (helper) => pool.query(
    `INSERT INTO jobs(client_id, assigned_helper_id, title, description, status, location_address)
     VALUES($1,$2,'Fix the sink','Leaking trap','accepted','12 Maple Court') RETURNING id`,
    [clientId, helper],
  ).then((r) => r.rows[0].id);
  beforeAll(async () => {
    for (const [id, email] of [[clientId, 'g56e-client'], [helperId, 'g56e-helper'], [helper2Id, 'g56e-helper2'], [ownerId, 'g56e-owner'], [strangerId, 'g56e-stranger']]) {
      await pool.query("INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,phone) VALUES($1,$2,'x','Work','User','customer',TRUE,TRUE,'555-0100')", [id, `${email}-${id}@example.invalid`]);
    }
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id,business_name,business_kind,is_active,timezone) VALUES($1,'Exceptions Co','service',TRUE,'UTC') RETURNING id", [ownerId]));
    await pool.query("INSERT INTO business_members(business_id,owner_id,member_id,invite_email,role,status,accepted_at) VALUES($1,$2,$3,$4,'employee','active',NOW())", [bizId, ownerId, helperId, `g56e-${helperId}@x.invalid`]);
    crewJobId = await mkJob(helperId);
    directJobId = await mkJob(helper2Id);
    const router = require('../routes/jobs');
    app = express(); app.use(express.json());
    app.use('/jobs', router);
    app.use((err, req, res, next) => res.status(err.statusCode || err.status || 500).json({ code: err.code })); // eslint-disable-line no-unused-vars
  });
  afterAll(async () => {
    await pool.query('DELETE FROM job_exceptions WHERE job_id = ANY($1::uuid[])', [[crewJobId, directJobId]]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [[crewJobId, directJobId]]);
    await pool.query('DELETE FROM business_members WHERE business_id = $1', [bizId]);
    await pool.query('DELETE FROM businesses WHERE id = $1', [bizId]);
    // Fixture users are left in place: deleting any user from this DB fails
    // with "referential integrity query ... gave unexpected result" (the
    // no-delete RULE on oxsteed_credit_partner_funding_records).
    await pool.end();
  });

  test('crew report routes to the business owner, is idempotent, and is participant-only', async () => {
    const send = { kind: 'exception', category: 'access_issue', description: 'Gate is locked, no code given', request_id: 'r-1' };
    const e = (await request(app).post(`/jobs/${crewJobId}/exceptions`).set(as(helperId)).send(send).expect(201)).body.exception;
    expect(e.routed_to).toBe(ownerId);
    const again = (await request(app).post(`/jobs/${crewJobId}/exceptions`).set(as(helperId)).send(send).expect(201)).body.exception;
    expect(again.id).toBe(e.id);
    await request(app).post(`/jobs/${crewJobId}/exceptions`).set(as(helperId)).send({ ...send, kind: 'incident', category: 'weather', request_id: 'r-2' }).expect(400);
    await request(app).post(`/jobs/${crewJobId}/exceptions`).set(as(strangerId)).send({ ...send, request_id: 'r-3' }).expect(404);
    await request(app).get(`/jobs/${crewJobId}/exceptions`).set(as(strangerId)).expect(404);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'job_exception_raised', userId: ownerId }));
    const asClient = (await request(app).get(`/jobs/${crewJobId}/exceptions`).set(as(clientId)).expect(200)).body;
    expect(asClient.open_count).toBe(1);
    expect(asClient.exceptions[0]).toMatchObject({ kind: 'exception', status: 'open', can_decide: true });
  });

  test('raiser cannot resolve their own report; the routed manager can', async () => {
    const list = (await request(app).get(`/jobs/${crewJobId}/exceptions`).set(as(ownerId)).expect(200)).body;
    const e = list.exceptions[0];
    expect(e.can_decide).toBe(true);
    await request(app).patch(`/jobs/${crewJobId}/exceptions/${e.id}`).set(as(helperId)).send({ status: 'resolved', resolution: 'done' }).expect(403);
    const ack = (await request(app).patch(`/jobs/${crewJobId}/exceptions/${e.id}`).set(as(ownerId)).send({ status: 'acknowledged', expectedVersion: e.version }).expect(200)).body.exception;
    expect(ack.status).toBe('acknowledged');
    const done = (await request(app).patch(`/jobs/${crewJobId}/exceptions/${e.id}`).set(as(ownerId)).send({ status: 'resolved', resolution: 'Code is 1234', expectedVersion: ack.version }).expect(200)).body.exception;
    expect(done.status).toBe('resolved');
    await request(app).patch(`/jobs/${crewJobId}/exceptions/${e.id}`).set(as(ownerId)).send({ status: 'dismissed', resolution: 'x' }).expect(409);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'job_exception_updated', userId: helperId }));
  });

  test('direct job without a business routes to the client', async () => {
    const e = (await request(app).post(`/jobs/${directJobId}/exceptions`).set(as(helper2Id)).send({ kind: 'missing_instruction', category: 'scope', description: 'What exactly needs fixing?', request_id: 'r-9' }).expect(201)).body.exception;
    expect(e.routed_to).toBe(clientId);
  });
});
