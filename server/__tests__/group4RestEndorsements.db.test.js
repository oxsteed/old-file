'use strict';
// Group 4 rest (item 194): skill endorsements from completed engagements
// only, one per client per skill (Emile, 2026-11-23).
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
const { publicCounts } = require('../services/helperEndorsementService');
const describeDb = raw ? describe : describe.skip;
const helper = crypto.randomUUID(), client = crypto.randomUUID(), stranger = crypto.randomUUID();
const jobIds = [];
let doneJob, openJob, skillId, otherSkillId, app;

describeDb('Group 4 rest: skill endorsements (194)', () => {
  beforeAll(async () => {
    for (const id of [helper, client, stranger]) {
      await pool.query(`INSERT INTO users(id,email,password_hash,first_name,last_name,role,is_active,email_verified,id_verified,terms_accepted,terms_accepted_at,terms_version)
        VALUES($1,$2,'x','Endorse','Fixture','customer',TRUE,TRUE,TRUE,TRUE,NOW(),'g4r-test')`, [id, `g4d-${id}@example.invalid`]);
    }
    await pool.query(`INSERT INTO access_grants(user_id,capability,subject_type,subject_key,status,provenance,policy_version)
      VALUES($1,'helper.offer_services','self','self','active','legacy_backfill','helper-policy-1')`, [helper]);
    const { rows: [cat] } = await pool.query('SELECT id FROM categories WHERE is_active IS DISTINCT FROM false ORDER BY id LIMIT 1');
    const { rows: [s1] } = await pool.query(`INSERT INTO helper_skills(user_id,category_id,skill_name) VALUES($1,$2,'Tile setting') RETURNING id`, [helper, cat.id]);
    const { rows: [s2] } = await pool.query(`INSERT INTO helper_skills(user_id,category_id,skill_name) VALUES($1,$2,'Grout repair') RETURNING id`, [helper, cat.id]);
    skillId = s1.id; otherSkillId = s2.id;
    for (const status of ['completed', 'in_progress', 'completed']) {
      const { rows: [j] } = await pool.query(`INSERT INTO jobs(client_id,assigned_helper_id,title,description,status) VALUES($1,$2,'Tile','Fixture',$3) RETURNING id`, [client, helper, status]);
      jobIds.push(j.id);
    }
    [doneJob, openJob] = jobIds;
    app = express(); app.use(express.json());
    app.use('/api/helpers/me', require('../routes/helperWork'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });
  afterAll(async () => {
    await pool.query('DELETE FROM jobs WHERE id = ANY($1::uuid[])', [jobIds]);
    await pool.query('DELETE FROM helper_skills WHERE user_id = $1', [helper]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helper, client, stranger]]);
    await pool.end();
  });

  test('only the customer of a completed job can endorse, once per skill across all their jobs', async () => {
    const post = (user, job, id) => request(app).post(`/api/helpers/me/endorsements/jobs/${job}`).set('x-user', user).send({ helperSkillId: id });
    await post(client, openJob, skillId).expect(409);
    await post(stranger, doneJob, skillId).expect(404);
    await post(helper, doneJob, skillId).expect(404);
    const first = await post(client, doneJob, skillId).expect(201);
    await post(client, doneJob, skillId).expect(409);
    await post(client, jobIds[2], skillId).expect(409);
    await post(client, doneJob, otherSkillId).expect(201);
    const opts = await request(app).get(`/api/helpers/me/endorsements/jobs/${doneJob}`).set('x-user', client).expect(200);
    expect(opts.body.skills.find((s) => s.helperSkillId === skillId).endorsementId).toBe(first.body.endorsement.id);
    expect(await publicCounts(helper)).toEqual({ 'Tile setting': 1, 'Grout repair': 1 });
  });

  test('the helper sees their record; the endorser can withdraw, nobody else can', async () => {
    const mine = await request(app).get('/api/helpers/me/endorsements').set('x-user', helper).expect(200);
    expect(mine.body.skills.map((s) => s.count)).toEqual([1, 1]);
    await request(app).get('/api/helpers/me/endorsements').set('x-user', client).expect(403);
    const { rows: [e] } = await pool.query('SELECT id FROM helper_skill_endorsements WHERE helper_skill_id = $1', [skillId]);
    await request(app).delete(`/api/helpers/me/endorsements/${e.id}`).set('x-user', helper).expect(404);
    await request(app).delete(`/api/helpers/me/endorsements/${e.id}`).set('x-user', client).expect(204);
    expect(await publicCounts(helper)).toEqual({ 'Grout repair': 1 });
  });
});
