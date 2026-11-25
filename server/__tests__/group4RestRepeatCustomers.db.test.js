'use strict';
// Group 4 rest (item 193): repeat customer follow-up.
const raw = process.env.ACCESS_TEST_DATABASE_URL;
if (raw) {
  const parsed = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\/(credit_statement_test|pa_g\d+)$/.test(parsed.pathname)) throw new Error('Disposable database required');
  process.env.DATABASE_URL = raw;
}
jest.mock('../middleware/auth', () => ({ authenticate: (req, res, next) => { const id = req.get('x-user'); if (!id) return res.sendStatus(401); req.user = { id }; next(); } }));
jest.mock('../services/notificationService', () => ({ sendNotification: jest.fn().mockResolvedValue({ success: true }) }));
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');
const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const pool = require('../db');
const { sendNotification } = require('../services/notificationService');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), past = crypto.randomUUID(), current = crypto.randomUUID();
const jobIds = [];
let app;

describeDb('Group 4 rest: repeat customer follow-up (193)', () => {
  beforeAll(async () => {
    for (const id of [helper, past, current]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Repeat','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4p-${id}@example.invalid`]);
    }
    await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [helper]);
    for (const [c, status] of [[past, 'completed'], [past, 'closed'], [current, 'in_progress']]) {
      const { rows: [j] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status) VALUES($1,$2,'Garden','Fixture',$3) RETURNING id`, [c, helper, status]);
      jobIds.push(j.id);
    }
    app = express(); app.use(express.json());
    app.use('/api/helpers/me', require('../routes/helperWork'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM helper_rebook_invites WHERE helper_id = $1', [helper]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, past, current]]);
    await pool.end();
  });

  test('lists only customers with completed work, first name only', async () => {
    const { body } = await request(app).get('/api/helpers/me/repeat-customers').set('x-user', helper).expect(200);
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0]).toMatchObject({ customerId: past, firstName: 'Repeat', completedJobs: 2, canInvite: true });
    expect(JSON.stringify(body)).not.toContain('@example.invalid');
    await request(app).get('/api/helpers/me/repeat-customers').set('x-user', past).expect(403);
  });

  test('invite notifies once, then the 30-day cooldown applies; no completed work means 404', async () => {
    await request(app).post(`/api/helpers/me/repeat-customers/${past}/invite`).set('x-user', helper).send({ message: 'Spring cleanup slots open' }).expect(201);
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: past, type: 'helper_rebook_invite', action_url: `/helpers/${helper}` }));
    await request(app).post(`/api/helpers/me/repeat-customers/${past}/invite`).set('x-user', helper).send({}).expect(429);
    await request(app).post(`/api/helpers/me/repeat-customers/${current}/invite`).set('x-user', helper).send({}).expect(404);
    await request(app).post(`/api/helpers/me/repeat-customers/${past}/invite`).set('x-user', helper).send({ message: 'x'.repeat(501) }).expect(400);
    const { body } = await request(app).get('/api/helpers/me/repeat-customers').set('x-user', helper);
    expect(body.customers[0].canInvite).toBe(false);
    expect(body.customers[0].nextInviteAt).toBeTruthy();
    await pool.query("UPDATE helper_rebook_invites SET sent_at = NOW() - interval '31 days' WHERE helper_id = $1", [helper]);
    await request(app).post(`/api/helpers/me/repeat-customers/${past}/invite`).set('x-user', helper).send({}).expect(201);
  });

  test('concurrent invites cannot both pass the cooldown', async () => {
    await pool.query("UPDATE helper_rebook_invites SET sent_at = NOW() - interval '60 days' WHERE helper_id = $1", [helper]);
    const results = await Promise.all([1, 2].map(() => request(app).post(`/api/helpers/me/repeat-customers/${past}/invite`).set('x-user', helper).send({})));
    expect(results.map((r) => r.status).sort()).toEqual([201, 429]);
  });
});
