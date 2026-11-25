'use strict';
// Group 4 rest (items 192, 195): helper reviews, response, quality summary.
// Opt-in, disposable loopback database only; real resolver and SQL.
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
const helper = crypto.randomUUID(), client = crypto.randomUUID(), client2 = crypto.randomUUID(), stranger = crypto.randomUUID();
const jobs = [];
let app;

describeDb('Group 4 rest: reviews and quality summary (192, 195)', () => {
  beforeAll(async () => {
    for (const id of [helper, client, client2, stranger]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Rep','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4r-${id}@example.invalid`]);
    }
    await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [helper]);
    for (const [c, status, rating, ageDays] of [[client, 'completed', 5, 10], [client2, 'completed', 2, 20], [client, 'completed', 4, 120]]) {
      const { rows: [job] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status) VALUES($1,$2,'Fixture','Fixture job',$3) RETURNING id`, [c, helper, status]);
      jobs.push(job.id);
      await pool.query(`INSERT INTO reviews(job_id,reviewer_id,reviewee_id,rating,comment,created_at) VALUES($1,$2,$3,$4,'ok',NOW() - ($5 || ' days')::interval)`, [job.id, c, helper, rating, String(ageDays)]);
    }
    const { rows: [ns] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,no_show_by,change_requested_at) VALUES($1,$2,'NS','Fixture','no_show',$1,NOW()) RETURNING id`, [client, helper]);
    jobs.push(ns.id);
    app = express(); app.use(express.json());
    app.use('/api/helpers/me', require('../routes/helperWork'));
    app.use('/api/reviews', require('../routes/reviews'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobs]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, client, client2, stranger]]);
    await pool.end();
  });

  test('192: helper lists only their own received reviews; non-helpers get 403', async () => {
    const res = await request(app).get('/api/helpers/me/reviews').set('x-user', helper).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.reviews).toHaveLength(3);
    expect(res.body.reviews[0].rating).toBe(5);
    await request(app).get('/api/helpers/me/reviews').set('x-user', stranger).expect(403);
  });

  test('195: summary counts, distribution, trend and job signals come from the record', async () => {
    const { body } = await request(app).get('/api/helpers/me/quality-summary').set('x-user', helper).expect(200);
    expect(body.reviews.total).toBe(3);
    expect(body.reviews.distribution).toEqual({ 1: 0, 2: 1, 3: 0, 4: 1, 5: 1 });
    expect(body.reviews.recentCount).toBe(2);
    expect(body.reviews.recentAverage).toBe(3.5);
    expect(body.reviews.priorAverage).toBe(4);
    expect(body.reviews.trend).toBe('down');
    expect(body.reviews.responseRate).toBe(0);
    expect(body.reviews.lowRatingsAwaitingResponse).toBe(1);
    expect(body.jobs).toEqual({ completed: 3, changesRequested: 1, noShowsReported: 1 });
  });

  test('192: only the reviewee responds, once, and the reviewer is notified', async () => {
    const { body: { reviews } } = await request(app).get('/api/helpers/me/reviews').set('x-user', helper);
    const target = reviews.find((r) => r.rating === 2);
    await request(app).put(`/api/reviews/${target.id}/respond`).set('x-user', stranger).send({ response: 'Not mine' }).expect(404);
    await request(app).put(`/api/reviews/${target.id}/respond`).set('x-user', helper).send({ response: 'x'.repeat(2001) }).expect(400);
    await request(app).put(`/api/reviews/${target.id}/respond`).set('x-user', helper).send({ response: 'Thanks, we fixed it.' }).expect(200);
    await request(app).put(`/api/reviews/${target.id}/respond`).set('x-user', helper).send({ response: 'Again' }).expect(404);
    const call = sendNotification.mock.calls.find(([arg]) => arg.type === 'review_response_posted');
    expect(call[0].userId).toBe(client2);
    const { body } = await request(app).get('/api/helpers/me/quality-summary').set('x-user', helper);
    expect(body.reviews.lowRatingsAwaitingResponse).toBe(0);
    expect(body.reviews.responseRate).toBe(33);
  });

  test('catalog: review_response_posted is cataloged', () => {
    const { NOTIFICATION_TYPES } = require('../utils/notificationTypeCatalog');
    const types = new Set((NOTIFICATION_TYPES || []).map((e) => e.type));
    expect(types.has('review_response_posted')).toBe(true);
  });
});
