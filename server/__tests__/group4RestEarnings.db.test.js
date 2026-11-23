'use strict';
// Group 4 rest (items 186, 189): one job's earnings breakdown with every
// difference explained, for the assigned helper only.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/(credit_statement_test|pa_g\d+)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => ({ authenticate: (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); } }));
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), other = crypto.randomUUID(), client = crypto.randomUUID();
let jobId, bareJobId, app;

describeDb('Group 4 rest: job earnings breakdown (186, 189)', () => {
  beforeAll(async () => {
    for (const id of [helper, other, client]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Earn','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4e-${id}@example.invalid`]);
    }
    for (const id of [helper, other]) await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [id]);
    const { rows: [job] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,job_value_cents,platform_fee_cents,broker_fee_cents,helper_payout_cents,payout_status,currency_code)
      VALUES($1,$2,'Paid job','Fixture','completed',10000,1500,500,7900,'earned','USD') RETURNING id`, [client, helper]);
    jobId = job.id;
    await pool.query(`INSERT INTO payments(job_id,payer_id,payee_id,amount,platform_fee,helper_payout,status,refunded_amount,refund_reason)
      VALUES($1,$2,$3,100.00,15.00,85.00,'captured',20.00,'Missed a fixture')`, [jobId, client, helper]);
    const { rows: [bare] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status) VALUES($1,$2,'Unpriced','Fixture','completed') RETURNING id`, [client, helper]);
    bareJobId = bare.id;
    app = express(); app.use(express.json());
    app.use('/api/helpers/me', require('../routes/helperWork'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [[jobId, bareJobId]]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, other, client]]);
    await pool.end();
  });

  test('186/189: breakdown itemizes fees, refunds, and any unexplained difference', async () => {
    const { body } = await request(app).get(`/api/helpers/me/jobs/${jobId}/earnings`).set('x-user', helper).expect(200);
    expect(body.breakdown).toEqual({ jobValueCents: 10000, platformFeeCents: 1500, brokerFeeCents: 500, helperPayoutCents: 7900 });
    const codes = Object.fromEntries(body.adjustments.map((a) => [a.code, a]));
    expect(codes.platform_fee.amountCents).toBe(-1500);
    expect(codes.broker_fee.amountCents).toBe(-500);
    expect(codes.refund).toMatchObject({ amountCents: -2000, reason: 'Missed a fixture' });
    expect(codes.other_recorded_difference.amountCents).toBe(-100);
    expect(body.payments[0]).toMatchObject({ amountCents: 10000, refundedCents: 2000 });
  });

  test('186: an unpriced job says so instead of inventing numbers', async () => {
    const { body } = await request(app).get(`/api/helpers/me/jobs/${bareJobId}/earnings`).set('x-user', helper).expect(200);
    expect(body.adjustments).toEqual([{ code: 'not_priced', amountCents: 0 }]);
  });

  test('only the assigned helper reads it; others get 404, non-helpers 403', async () => {
    await request(app).get(`/api/helpers/me/jobs/${jobId}/earnings`).set('x-user', other).expect(404);
    await request(app).get(`/api/helpers/me/jobs/${jobId}/earnings`).set('x-user', client).expect(403);
    await request(app).get('/api/helpers/me/jobs/not-a-uuid/earnings').set('x-user', helper).expect(400);
  });
});
