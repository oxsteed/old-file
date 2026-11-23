'use strict';
// Group 4 rest (items 196-200): grow into ownership; read-only history record.
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
const helper = crypto.randomUUID(), customer = crypto.randomUUID(), stranger = crypto.randomUUID();
const jobIds = [];
let app, bizId, otherBizId;

describeDb('Group 4 rest: grow into ownership (196-200)', () => {
  beforeAll(async () => {
    for (const id of [helper, customer, stranger]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version,city,state,country)
        VALUES($1,$2,'x','Grow','Owner','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test','Miami','FL','US')`, [id, `g4b-${id}@example.invalid`]);
    }
    await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [helper]);
    await pool.query("INSERT INTO helper_profiles(user_id, profile_headline, service_city, service_state) VALUES ($1,'Tile and grout repair','Miami','FL')", [helper]);
    const { rows: [cat] } = await pool.query('SELECT id FROM categories WHERE is_active IS DISTINCT FROM false ORDER BY id LIMIT 1');
    await pool.query("INSERT INTO helper_skills(user_id, category_id, skill_name, years_exp) VALUES ($1,$2,'Tile repair',4)", [helper, cat.id]);
    const { rows: [j] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status,category_name)
      VALUES($1,$2,'Bathroom tile','Fixture','completed','Handyman') RETURNING id`, [customer, helper]);
    jobIds.push(j.id);
    await pool.query('INSERT INTO reviews(job_id, reviewer_id, reviewee_id, rating, comment) VALUES ($1,$2,$3,5,$4)', [j.id, customer, helper, 'Private praise text']);
    ({ rows: [{ id: bizId }] } = await pool.query("INSERT INTO businesses(user_id, business_name, business_kind) VALUES ($1,'Grow Tile Co','service') RETURNING id", [helper]));
    ({ rows: [{ id: otherBizId }] } = await pool.query("INSERT INTO businesses(user_id, business_name, business_kind) VALUES ($1,'Not yours','service') RETURNING id", [stranger]));
    app = express(); app.use(express.json());
    app.use('/api/helpers/me', require('../routes/helperWork'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM businesses WHERE id = ANY($1::int[])', [[bizId, otherBizId]]);
    await pool.query('DELETE FROM reviews WHERE job_id = ANY($1::uuid[])', [jobIds]);
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await pool.query('DELETE FROM helper_skills WHERE user_id = $1', [helper]);
    await pool.query('DELETE FROM helper_profiles WHERE user_id = $1', [helper]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, customer, stranger]]);
    await pool.end();
  });

  test('overview: prefill, advisory milestones, preview of what carries and what stays; helpers only', async () => {
    const { body } = await request(app).get('/api/helpers/me/business-transition').set('x-user', helper).expect(200);
    expect(body.prefill).toMatchObject({ business_kind: 'service', business_name: 'Grow Owner', description: 'Tile and grout repair', address_city: 'Miami' });
    const byKey = Object.fromEntries(body.milestones.map((m) => [m.key, m]));
    expect(byKey.completed_jobs).toMatchObject({ met: false, current: 1, target: 10 });
    expect(byKey.profile_complete.met).toBe(true);
    expect(byKey.no_open_disputes.met).toBe(true);
    expect(body.preview.carries).toMatchObject({ completedJobs: 1, categories: ['Handyman'], skills: [{ name: 'Tile repair', years: 4 }] });
    expect(body.preview.stays).toEqual(expect.arrayContaining(['ratings_reviews', 'client_relationships']));
    expect(body.ownedBusinesses).toEqual([{ id: bizId, name: 'Grow Tile Co' }]);
    await request(app).get('/api/helpers/me/business-transition').set('x-user', stranger).expect(403);
  });

  test('link creates one read-only record for an owned business; no ratings or client data; intro and revoke', async () => {
    await request(app).post(`/api/helpers/me/business-transition/records/${otherBizId}`).set('x-user', helper).expect(404);
    const { body: first } = await request(app).post(`/api/helpers/me/business-transition/records/${bizId}`).set('x-user', helper).expect(201);
    expect(first.record).toMatchObject({ created: true, readOnly: true, businessName: 'Grow Tile Co', history: { completedJobs: 1 } });
    const { body: again } = await request(app).post(`/api/helpers/me/business-transition/records/${bizId}`).set('x-user', helper).expect(201);
    expect(again.record.created).toBe(false);
    const text = JSON.stringify(first.record);
    for (const leak of ['Private praise text', 'rating', customer, '@example.invalid']) expect(text).not.toContain(leak);
    expect(first.record.intro.steps.map((s) => s.key)).toEqual(['add_services', 'set_hours', 'publish_profile', 'invite_team']);
    await request(app).post(`/api/helpers/me/business-transition/records/${bizId}/dismiss-intro`).set('x-user', helper).expect(200);
    const { body: read } = await request(app).get(`/api/helpers/me/business-transition/records/${bizId}`).set('x-user', helper).expect(200);
    expect(read.record.intro.dismissed).toBe(true);
    await request(app).get(`/api/helpers/me/business-transition/records/${bizId}`).set('x-user', stranger).expect(404);
    await request(app).delete(`/api/helpers/me/business-transition/records/${bizId}`).set('x-user', helper).expect(200);
    await request(app).get(`/api/helpers/me/business-transition/records/${bizId}`).set('x-user', helper).expect(404);
    const { rows: [hp] } = await pool.query('SELECT profile_headline FROM helper_profiles WHERE user_id = $1', [helper]);
    expect(hp.profile_headline).toBe('Tile and grout repair');
  });
});
