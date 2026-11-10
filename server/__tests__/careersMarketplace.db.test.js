'use strict';

/**
 * DB tests: the Careers marketplace layer (docs/careers/marketplace.md)
 * against a real migrated schema: search filters and paging, save/follow/
 * alerts, report-a-job moderation, employer pages with reviews, Q&A and
 * salaries, screeners with deal-breakers, application messaging, interview
 * self-scheduling (book, confirm, reschedule, ICS, reminders), the résumé
 * builder, AI match and video rooms staying off until flagged, plans and
 * referral payouts (two distinct admins), agency access, candidate alerts
 * and shortlists, analytics + CSV, availability, and erasure.
 *
 * Run with:
 *   CAREERS_TEST_DATABASE_URL=postgresql://.../careers_test \
 *     npx jest --runInBand __tests__/careersMarketplace.db.test.js
 */
jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.CAREERS_TEST_DATABASE_URL || '';

function isTrackDatabase(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && url.pathname === '/careers_test';
  } catch { return false; }
}

const CAN_RUN_DB = isTrackDatabase(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable careers_test database', () => {
  expect(isTrackDatabase(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env.DATABASE_URL = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'careers-test-secret';
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'a'.repeat(64);
  for (const k of ['CAREERS_PLANS_ENABLED', 'CAREERS_REFERRALS_ENABLED', 'CAREERS_AI_MATCH_ENABLED', 'CAREERS_AI_RESUME_PARSE_ENABLED', 'CAREERS_VIDEO_ROOM_ENABLED', 'CAREERS_CALENDAR_GOOGLE_ENABLED', 'CAREERS_CALENDAR_MICROSOFT_ENABLED', 'CAREERS_SMS_ENABLED', 'CAREERS_CHECKR_ENABLED', 'CAREERS_EOR_ENABLED', 'CAREERS_BILLING_ENABLED', 'CAREERS_AI_RANKING_ENABLED', 'CAREERS_CHECKR_WEBHOOK_SECRET', 'CAREERS_EOR_WEBHOOK_SECRET', 'CAREERS_STRIPE_WEBHOOK_SECRET']) delete process.env[k];
}

// The test names the caller in a header instead of a JWT; everything after
// authentication (hiring access, scopes, grants) is the real code.
const mockUsers = new Map();
function mockFakeAuth(req, res, next) {
  const id = req.get('x-test-user');
  const u = id && mockUsers.get(id);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { ...u };
  return next();
}
jest.mock('../middleware/auth', () => ({
  authenticate: (...a) => mockFakeAuth(...a),
  requireAuth: (...a) => mockFakeAuth(...a),
  optionalAuth: (req, res, next) => (req.get('x-test-user') ? mockFakeAuth(req, res, next) : next()),
}));
jest.mock('../middleware/adminAuth', () => {
  const actual = jest.requireActual('../middleware/adminAuth');
  return {
    ...actual,
    requireAdmin: (req, res, next) => mockFakeAuth(req, res, () => {
      if (!['admin', 'super_admin'].includes(req.user.role)) return res.status(403).json({ error: 'Admins only' });
      req.isSuper = req.user.role === 'super_admin';
      return next();
    }),
    requireAdminTotp: (_req, _res, next) => next(),
  };
});
jest.mock('../utils/email', () => ({ sendEmail: jest.fn().mockResolvedValue({ ok: true }) }));

jest.setTimeout(120000);

ddescribe('careers marketplace (real database)', () => {
  let pool;
  let app;
  const ids = {};
  const emails = () => require('../utils/email').sendEmail.mock.calls;

  async function newUser(label, { role = 'customer', ageDays = 30 } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, created_at)
       VALUES ($1, $2, 'x', $3, 'Fixture', $4, TRUE, TRUE, NOW() - make_interval(days => $5::int))`,
      [id, `mk-${label}-${id}@example.invalid`, label, role, ageDays]
    );
    await pool.query('INSERT INTO growth_subject_eligibility (user_id, adult_confirmed, verification_method, verified_at) VALUES ($1, TRUE, $2, NOW())', [id, 'provider']);
    mockUsers.set(id, { id, role, email: `mk-${label}-${id}@example.invalid` });
    return id;
  }

  async function member(businessId, ownerId, userId, role, status = 'active') {
    const { rows: [m] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status, accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '90 days') RETURNING id`,
      [businessId, ownerId, userId, mockUsers.get(userId).email, role, status]
    );
    return Number(m.id);
  }

  const as = (userId) => ({
    get: (url) => request(app).get(url).set('x-test-user', userId),
    post: (url, body = {}) => request(app).post(url).set('x-test-user', userId).send(body),
    patch: (url, body = {}) => request(app).patch(url).set('x-test-user', userId).send(body),
    put: (url, body = {}) => request(app).put(url).set('x-test-user', userId).send(body),
    del: (url) => request(app).delete(url).set('x-test-user', userId),
  });

  const openingBody = (over = {}) => ({
    business_id: ids.biz,
    title: 'Line cook',
    department: 'restaurant',
    path_stage: 'part_time',
    employment_type: 'part_time',
    workplace_type: 'onsite',
    country_code: 'US',
    region: 'FL',
    city: 'Miami',
    timezone: 'America/New_York',
    currency_code: 'USD',
    compensation_min: 15,
    compensation_max: 19,
    compensation_period: 'hourly',
    work_authorization: 'local_authorized',
    description: 'Prep and line work on a busy grill.',
    team_role: 'employee',
    location_ids: [ids.loc1],
    status: 'open',
    allow_guest_applications: true,
    ...over,
  });
  const applyBody = { authorized_to_work: true, needs_sponsorship: false };
  const E = '/api/careers/employer';

  beforeAll(async () => {
    pool = require('../db');
    const { errorHandler } = require('../middleware/errorHandler');
    app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use('/api/careers', require('../routes/careers'));
    app.use(errorHandler);

    ids.owner = await newUser('owner');
    ids.manager = await newUser('manager');
    ids.worker = await newUser('worker');
    ids.worker2 = await newUser('worker2');
    ids.former = await newUser('former');
    ids.newbie = await newUser('newbie', { ageDays: 1 });
    ids.outsider = await newUser('outsider');
    ids.agencyOwner = await newUser('agency');
    // Super admins hold every admin permission (moderate_careers, manage_hiring).
    ids.admin = await newUser('admin', { role: 'super_admin' });
    ids.admin2 = await newUser('admin2', { role: 'super_admin' });
    const { rows: [mk] } = await pool.query(
      `INSERT INTO businesses (user_id, business_name, is_business_verified, profile_slug) VALUES ($1, 'Market Grill', TRUE, $2) RETURNING id`,
      [ids.owner, `market-grill-${crypto.randomUUID().slice(0, 8)}`]
    );
    ids.biz = Number(mk.id);
    ({ rows: [{ id: ids.agency }] } = await pool.query(`INSERT INTO businesses (user_id, business_name, is_business_verified) VALUES ($1, 'Staffing Pros', TRUE) RETURNING id`, [ids.agencyOwner]));
    ids.agency = Number(ids.agency);
    ({ rows: [{ id: ids.restaurant }] } = await pool.query(`INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'Market Grill') RETURNING id`, [ids.biz, ids.owner]));
    ({ rows: [{ id: ids.loc1 }] } = await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Downtown') RETURNING id`, [ids.restaurant]));
    ids.loc1 = Number(ids.loc1);
    await member(ids.biz, ids.owner, ids.manager, 'manager');
    await member(ids.biz, ids.owner, ids.former, 'employee', 'revoked');

    const a = await as(ids.owner).post(`${E}/openings`, openingBody({ title: 'Grill cook', same_day_hire: true, urgently_hiring: true, industry: 'food_service', experience_level: 'entry' }));
    expect(a.status).toBe(201);
    ids.opening = Number(a.body.opening.id);
    const b = await as(ids.owner).post(`${E}/openings`, openingBody({ title: 'Dishwasher', compensation_min: 12, compensation_max: 14 }));
    expect(b.status).toBe(201);
    ids.opening2 = Number(b.body.opening.id);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ── Search ────────────────────────────────────────────────────────────────

  test('search filters, sort and pagination', async () => {
    const urgent = await request(app).get('/api/careers/openings?same_day=true&q=cook');
    expect(urgent.status).toBe(200);
    const urgentIds = urgent.body.openings.map((o) => Number(o.id));
    expect(urgentIds).toContain(ids.opening);
    expect(urgentIds).not.toContain(ids.opening2);
    const byPay = await request(app).get('/api/careers/openings?sort=pay_high&pay_period=hourly&page_size=10&page=1');
    expect(byPay.status).toBe(200);
    expect(byPay.body.openings.length).toBeLessThanOrEqual(10);
    const pays = byPay.body.openings.map((o) => Number(o.compensation_max));
    expect([...pays].sort((x, y) => y - x)).toEqual(pays);
    expect(byPay.body.total).toBeGreaterThanOrEqual(2);
    expect(byPay.body.page).toBe(1);
    const bad = await request(app).get('/api/careers/openings?sort=nonsense');
    expect(bad.status).toBe(200);
    // Views de-duplicate per viewer.
    const v1 = await request(app).post(`/api/careers/openings/${ids.opening}/events`).set('X-Forwarded-For', '10.9.9.9').send({ metric: 'view' });
    const v2 = await request(app).post(`/api/careers/openings/${ids.opening}/events`).set('X-Forwarded-For', '10.9.9.9').send({ metric: 'view' });
    expect(v1.status).toBe(202);
    expect(v1.body.counted).toBe(true);
    expect(v2.body.counted).toBe(false);
    expect((await request(app).post(`/api/careers/openings/${ids.opening}/events`).send({ metric: 'apply' })).status).toBe(400);
  });

  test('only consented batches count public search impressions once per viewer per day', async () => {
    const draft = await as(ids.owner).post(`${E}/openings`, openingBody({ title: 'Draft opening', status: 'draft' }));
    expect(draft.status).toBe(201);
    const draftId = draft.body.opening.id;
    const endpoint = '/api/careers/openings/impressions';
    const guest = () => request(app).post(endpoint).set('X-Forwarded-For', '10.9.9.12');
    const totals = async () => {
      const { rows } = await pool.query(
        `SELECT o.id, COALESCE(m.impressions, 0) AS impressions
           FROM career_openings o
           LEFT JOIN career_opening_metrics_daily m ON m.opening_id = o.id AND m.day = CURRENT_DATE
          WHERE o.id = ANY($1::bigint[]) ORDER BY o.id`,
        [[ids.opening, ids.opening2, draftId]]
      );
      return Object.fromEntries(rows.map((row) => [row.id, row.impressions]));
    };
    const payload = { opening_ids: [ids.opening2, ids.opening, String(ids.opening), draftId, '9223372036854775807'], analytics_consent: true };

    expect((await request(app).get('/api/careers/openings?page=1')).status).toBe(200);
    expect((await guest().send({ opening_ids: payload.opening_ids })).status).toBe(204);
    expect((await guest().set('Sec-GPC', '1').send(payload)).status).toBe(204);
    for (const opening_ids of [[], {}, [true], ['9223372036854775808'], Array(61).fill(ids.opening)]) {
      expect((await guest().send({ ...payload, opening_ids })).status).toBe(400);
    }
    expect((await request(app).post(`/api/careers/openings/${ids.opening}/events`).send({ metric: 'impression' })).status).toBe(400);
    expect(await totals()).toEqual({ [ids.opening]: 0, [ids.opening2]: 0, [draftId]: 0 });

    const attempts = await Promise.all([guest().send(payload), guest().send(payload)]);
    expect(attempts.map((attempt) => attempt.status)).toEqual([204, 204]);
    expect(await totals()).toEqual({ [ids.opening]: 1, [ids.opening2]: 1, [draftId]: 0 });

    expect((await as(ids.worker).post(endpoint, { ...payload, opening_ids: [ids.opening] })).status).toBe(204);
    expect(await totals()).toEqual({ [ids.opening]: 2, [ids.opening2]: 1, [draftId]: 0 });
    const dashboard = await as(ids.owner).get(`${E}/analytics?business_id=${ids.biz}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.openings.find((row) => Number(row.id) === ids.opening).impressions).toBe(2);
  });

  // ── Save, follow, alerts ─────────────────────────────────────────────────

  test('save and track jobs, follow employers', async () => {
    const w = as(ids.worker);
    expect((await w.post('/api/careers/me/saved-jobs', { opening_id: ids.opening })).status).toBe(201);
    expect((await w.patch(`/api/careers/me/saved-jobs/${ids.opening}`, { status: 'interviewing' })).status).toBe(400);
    expect((await w.patch(`/api/careers/me/saved-jobs/${ids.opening}`, { status: 'archived' })).status).toBe(200);
    const tracker = await w.get('/api/careers/me/tracker');
    expect(tracker.status).toBe(200);
    expect(JSON.stringify(tracker.body)).toContain('Grill cook');
    expect((await w.post('/api/careers/me/follows', { business_id: ids.biz })).status).toBe(201);
    const page = await w.get(`/api/careers/openings/${ids.opening}`);
    expect(page.body.opening.viewer.following).toBe(true);
    const follows = await w.get('/api/careers/me/follows');
    expect(follows.body.follows.map((f) => Number(f.business_id))).toContain(ids.biz);
    // A new opening reaches followers once.
    const n = await as(ids.owner).post(`${E}/openings`, openingBody({ title: 'Prep cook' }));
    expect(n.status).toBe(201);
    ids.opening3 = Number(n.body.opening.id);
    const seeker = require('../services/careers/marketplace/seeker');
    const r1 = await seeker.notifyFollowers(pool);
    const r2 = await seeker.notifyFollowers(pool);
    expect(r1.notified).toBeGreaterThanOrEqual(1);
    expect(r2.notified).toBe(0);
  });

  test('job alerts: validation, run, and no repeats', async () => {
    const w = as(ids.worker2);
    expect((await w.post('/api/careers/me/alerts', { name: 'x', criteria: {} })).status).toBe(400);
    const res = await w.post('/api/careers/me/alerts', { name: 'Cooks', criteria: { q: 'cook' }, frequency: 'instant' });
    expect(res.status).toBe(201);
    ids.alert = Number(res.body.alert.id);
    await pool.query("UPDATE career_job_alerts SET last_checked_at = NOW() - INTERVAL '2 days' WHERE id = $1", [ids.alert]);
    const seeker = require('../services/careers/marketplace/seeker');
    const first = await seeker.runDueAlerts(pool);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query('SELECT opening_id FROM career_job_alert_deliveries WHERE alert_id = $1', [ids.alert]);
    expect(rows.map((r) => Number(r.opening_id))).toEqual(expect.arrayContaining([ids.opening]));
    await pool.query("UPDATE career_job_alerts SET last_checked_at = NOW() - INTERVAL '2 days' WHERE id = $1", [ids.alert]);
    // Batches are capped; keep running until everything was delivered once.
    let last = null;
    for (let i = 0; i < 5; i += 1) {
      await pool.query("UPDATE career_job_alerts SET last_checked_at = NOW() - INTERVAL '2 days' WHERE id = $1", [ids.alert]);
      last = await seeker.runDueAlerts(pool);
      if (!last.sent) break;
    }
    expect(last.sent).toBe(0);
    const { rows: [{ n, d }] } = await pool.query('SELECT COUNT(*)::int AS n, COUNT(DISTINCT opening_id)::int AS d FROM career_job_alert_deliveries WHERE alert_id = $1', [ids.alert]);
    expect(n).toBe(d);
    expect(n).toBeGreaterThanOrEqual(rows.length);
    expect((await as(ids.worker).del(`/api/careers/me/alerts/${ids.alert}`)).status).toBe(404);
    expect((await w.patch(`/api/careers/me/alerts/${ids.alert}`, { paused: true })).body.alert.paused).toBe(true);
  });

  test('report this job reaches admin moderation, once per reporter', async () => {
    const r = await as(ids.worker).post(`/api/careers/openings/${ids.opening2}/report`, { reason: 'scam', details: 'Asked for a fee' });
    expect(r.status).toBe(201);
    const again = await as(ids.worker).post(`/api/careers/openings/${ids.opening2}/report`, { reason: 'scam' });
    // A repeat report is accepted quietly and not counted twice.
    expect(again.body.duplicate).toBe(true);
    expect((await request(app).post(`/api/careers/openings/${ids.opening2}/report`).send({ reason: 'nope' })).status).toBe(400);
    expect((await as(ids.worker).get('/api/careers/admin/opening-reports')).status).toBe(403);
    const list = await as(ids.admin).get('/api/careers/admin/opening-reports');
    expect(list.status).toBe(200);
    expect(list.body.reports.map((x) => Number(x.opening_id))).toContain(ids.opening2);
    const done = await as(ids.admin).post(`/api/careers/admin/opening-reports/${ids.opening2}/resolve`, { outcome: 'dismiss', note: 'Checked with owner' });
    expect(done.status).toBe(200);
  });

  // ── Employer pages, reviews, Q&A, salaries ─────────────────────────────────

  test('employer directory and public page', async () => {
    const upd = await as(ids.owner).patch(`${E}/company-page?business_id=${ids.biz}`, { about: 'Family grill since 1999', same_day_hiring: true });
    expect(upd.status).toBe(200);
    expect((await as(ids.manager).patch(`${E}/company-page?business_id=${ids.biz}`, { about: 'x' })).status).toBe(200);
    const dir = await request(app).get('/api/careers/employers?q=Market');
    expect(dir.status).toBe(200);
    const entry = dir.body.employers.find((e) => Number(e.business_id ?? e.id) === ids.biz);
    expect(entry).toBeTruthy();
    const page = await request(app).get(`/api/careers/employers/b-${ids.biz}`);
    expect(page.status).toBe(200);
    expect(JSON.stringify(page.body)).toContain('Grill cook');
    expect((await request(app).get('/api/careers/employers/no-such-employer-xyz')).status).toBe(404);
  });

  test('reviews: only people who worked there, moderation and reports', async () => {
    const body = { overall: 4, headline: 'Good first job', pros: 'Fair managers', cons: 'Busy weekends' };
    expect((await as(ids.outsider).post(`/api/careers/employers/b-${ids.biz}/reviews`, body)).status).toBe(403);
    expect((await as(ids.owner).post(`/api/careers/employers/b-${ids.biz}/reviews`, body)).body.code).toBe('review_not_eligible');
    const ok = await as(ids.former).post(`/api/careers/employers/b-${ids.biz}/reviews`, body);
    expect(ok.status).toBe(201);
    expect(ok.body.review.status).toBe('published');
    ids.review = Number(ok.body.review.id);
    expect((await as(ids.former).post(`/api/careers/employers/b-${ids.biz}/reviews`, body)).status).toBe(409);
    const list = await request(app).get(`/api/careers/employers/b-${ids.biz}/reviews`);
    expect(list.body.reviews.length).toBe(1);
    expect(JSON.stringify(list.body)).not.toMatch(/author_user_id|example\.invalid/);
    const resp = await as(ids.owner).post(`${E}/reviews/${ids.review}/respond?business_id=${ids.biz}`, { response: 'Thank you for the feedback!' });
    expect(resp.status).toBe(200);
    expect((await as(ids.worker).post(`/api/careers/reviews/${ids.review}/report`, { reason: 'false_information' })).status).toBe(200);
    const queue = await as(ids.admin).get('/api/careers/admin/content');
    expect(queue.status).toBe(200);
    const mod = await as(ids.admin).post(`/api/careers/admin/content/review/${ids.review}/moderate`, { decision: 'publish' });
    expect(mod.status).toBe(200);
  });

  test('Q&A is moderated before it is public; salaries need a work record', async () => {
    const q = await as(ids.worker).post(`/api/careers/employers/b-${ids.biz}/questions`, { body: 'Do you offer weekend-only shifts?' });
    expect(q.status).toBe(201);
    expect(q.body.question.status).toBe('pending');
    let pub = await request(app).get(`/api/careers/employers/b-${ids.biz}/questions`);
    expect(pub.body.questions.length).toBe(0);
    await as(ids.admin).post(`/api/careers/admin/content/question/${q.body.question.id}/moderate`, { decision: 'publish' });
    pub = await request(app).get(`/api/careers/employers/b-${ids.biz}/questions`);
    expect(pub.body.questions.length).toBe(1);
    const ans = await as(ids.owner).post(`${E}/questions/${q.body.question.id}/answers?business_id=${ids.biz}`, { body: 'Yes, Saturday and Sunday shifts.' });
    expect(ans.status).toBe(201);
    expect((await as(ids.newbie).post(`/api/careers/employers/b-${ids.biz}/salaries`, { job_title: 'Cook', pay_amount: 16, pay_period: 'hourly' })).status).toBe(403);
    expect((await as(ids.former).post(`/api/careers/employers/b-${ids.biz}/salaries`, { job_title: 'Cook', pay_amount: 16, pay_period: 'hourly' })).status).toBe(201);
    const ins = await request(app).get('/api/careers/salaries?title=cook');
    expect(ins.status).toBe(200);
    // One report is below the minimum, so no individual figure is shown.
    expect(JSON.stringify(ins.body)).not.toContain('"16"');
  });

  // ── Screeners ─────────────────────────────────────────────────────────────

  test('screeners: protected questions refused, deal-breakers auto-reject with a clear reason', async () => {
    const bad = await as(ids.owner).put(`${E}/openings/${ids.opening}/screeners`, { questions: [{ prompt: 'How old are you?' }] });
    expect(bad.status).toBe(400);
    const cust = await as(ids.owner).put(`${E}/openings/${ids.opening}/screeners`, { questions: [{ prompt: 'Why this job?', dealbreaker: true }] });
    expect(cust.status).toBe(400);
    const ok = await as(ids.owner).put(`${E}/openings/${ids.opening}/screeners`, {
      auto_reject: true,
      questions: [
        { preset_code: 'drivers_license', dealbreaker: true, expected: { answer: true } },
        { preset_code: 'years_experience', expected: { min: 1 } },
        { prompt: 'What is your favourite dish to cook?', answer_type: 'text', required: false },
      ],
    });
    expect(ok.status).toBe(200);
    const pub = await request(app).get(`/api/careers/openings/${ids.opening}`);
    const qs = pub.body.opening.screener_questions;
    expect(qs.length).toBe(3);
    expect(JSON.stringify(qs)).not.toMatch(/expected|dealbreaker/);
    const [license, years] = qs;
    const missing = await as(ids.worker2).post(`/api/careers/openings/${ids.opening}/apply`, applyBody);
    expect(missing.status).toBe(400);
    const res = await as(ids.worker2).post(`/api/careers/openings/${ids.opening}/apply`, {
      ...applyBody, screener_answers: { [license.id]: false, [years.id]: 3 }, save_screener_defaults: true,
    });
    expect(res.status).toBe(201);
    const { rows: [row] } = await pool.query('SELECT stage, rejection_reason_code, screener_passed FROM career_applications WHERE id = $1', [res.body.application.id]);
    expect(row.stage).toBe('rejected');
    expect(row.rejection_reason_code).toBe('requirements_not_met');
    expect(row.screener_passed).toBe(false);
    const defaults = await as(ids.worker2).get('/api/careers/me/screener-defaults');
    expect(defaults.body.defaults.drivers_license).toBe(false);
    // The passing worker goes through.
    const pass = await as(ids.worker).post(`/api/careers/openings/${ids.opening}/apply`, {
      ...applyBody, screener_answers: { [license.id]: true, [years.id]: 2 },
    });
    expect(pass.status).toBe(201);
    ids.application = Number(pass.body.application.id);
    const view = await as(ids.owner).get(`${E}/applications/${ids.application}`);
    expect(view.status).toBe(200);
    expect(view.body.application.screener_passed).toBe(true);
    expect(view.body.application.screener_answers.length).toBe(3);
  });

  // ── Messaging ─────────────────────────────────────────────────────────────

  test('messaging: scoped to the application, both directions, reports and moderation', async () => {
    emails().length = 0;
    const send = await as(ids.manager).post(`${E}/applications/${ids.application}/messages`, { body: 'Hi! Can you come in Thursday?' });
    expect(send.status).toBe(201);
    expect((await as(ids.outsider).post(`${E}/applications/${ids.application}/messages`, { body: 'hello there' })).status).toBe(404);
    expect((await as(ids.worker2).get(`/api/careers/me/applications/${ids.application}/messages`)).status).toBe(404);
    const inbox = await as(ids.worker).get('/api/careers/me/messages');
    expect(inbox.body.threads[0].unread).toBe(1);
    const thread = await as(ids.worker).get(`/api/careers/me/applications/${ids.application}/messages`);
    expect(thread.status).toBe(200);
    expect(thread.body.messages[0].sender_label).toBe('Market Grill');
    const reply = await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/messages`, { body: 'Yes, Thursday works.' });
    expect(reply.status).toBe(201);
    const team = await as(ids.owner).get(`${E}/messages?business_id=${ids.biz}`);
    expect(team.body.threads.map((t) => Number(t.application_id))).toContain(ids.application);
    expect((await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/messages`, { body: '' })).status).toBe(400);
    const tpl = await as(ids.owner).post(`${E}/message-templates?business_id=${ids.biz}`, { name: 'Invite', body: 'Thanks for applying to {openingTitle} at {employerName}.' });
    expect(tpl.status).toBe(201);
    const viaTpl = await as(ids.owner).post(`${E}/applications/${ids.application}/messages`, { template_id: tpl.body.template.id });
    expect(viaTpl.status).toBe(201);
    expect(viaTpl.body.message.body).toContain('Grill cook');
    const rep = await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/messages/${send.body.message.id}/report`, { reason: 'spam' });
    expect(rep.status).toBe(201);
    const reports = await as(ids.admin).get('/api/careers/admin/message-reports');
    expect(reports.body.reports.map((x) => Number(x.message_id))).toContain(Number(send.body.message.id));
    const hide = await as(ids.admin).post(`/api/careers/admin/message-reports/${send.body.message.id}/resolve`, { outcome: 'hide', reason: 'Off-platform pay request' });
    expect(hide.status).toBe(200);
    // Nothing in audit metadata carries message text.
    const { rows: audits } = await pool.query("SELECT after_state, metadata FROM business_audit_log WHERE action = 'careers.message.sent' AND business_id = $1", [ids.biz]);
    expect(JSON.stringify(audits)).not.toContain('Thursday');
  });

  // ── Interview scheduling ──────────────────────────────────────────────────

  test('self-scheduling: availability, proposal, booking, confirm, ICS, reschedule, reminders', async () => {
    const av = await as(ids.manager).put(`${E}/availability?business_id=${ids.biz}`, {
      timezone: 'America/New_York',
      windows: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, start_minute: 9 * 60, end_minute: 17 * 60 })),
    });
    expect(av.status).toBe(200);
    const slots = await as(ids.manager).get(`${E}/applications/${ids.application}/slots?duration_minutes=30`);
    expect(slots.status).toBe(200);
    expect(slots.body.slots.length).toBeGreaterThan(0);
    expect((await as(ids.worker).post(`/api/careers/employer/applications/${ids.application}/proposals`, {})).status).toBe(404);
    const prop = await as(ids.manager).post(`${E}/applications/${ids.application}/proposals`, { auto: true, mode: 'phone', timezone: 'America/New_York', duration_minutes: 30 });
    expect(prop.status).toBe(201);
    const mine = await as(ids.worker).get(`/api/careers/me/applications/${ids.application}/proposals`);
    expect(mine.body.proposals.length).toBe(1);
    const p = mine.body.proposals[0];
    expect((await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/proposals/${p.id}/book`, { starts_at: '2020-01-01T00:00:00Z' })).status).toBe(400);
    const book = await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/proposals/${p.id}/book`, { starts_at: p.slots[0] });
    expect(book.status).toBe(201);
    ids.interview = Number(book.body.interview.id);
    expect((await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/proposals/${p.id}/book`, { starts_at: p.slots[1] })).status).toBe(409);
    // The booked time is no longer offered.
    const after = await as(ids.manager).get(`${E}/applications/${ids.application}/slots?duration_minutes=30`);
    expect(after.body.slots).not.toContain(p.slots[0]);
    expect((await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/interviews/${ids.interview}/confirm`)).status).toBe(200);
    const ics = await as(ids.worker).get(`/api/careers/me/applications/${ids.application}/interviews/${ids.interview}/ics`);
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toMatch(/text\/calendar/);
    expect(ics.headers['x-content-type-options']).toBe('nosniff');
    expect(ics.text).toContain('BEGIN:VEVENT');
    expect((await as(ids.worker).post(`/api/careers/me/applications/${ids.application}/interviews/${ids.interview}/reschedule`, { reason: 'Exam that day' })).status).toBe(200);
    const moved = new Date(new Date(p.slots[0]).getTime() + 86400000).toISOString();
    const rs = await as(ids.manager).post(`${E}/applications/${ids.application}/interviews/${ids.interview}/reschedule`, { scheduled_at: moved });
    expect(rs.status).toBe(200);
    const ics2 = await as(ids.manager).get(`${E}/applications/${ids.application}/interviews/${ids.interview}/ics`);
    expect(ics2.text).toMatch(/SEQUENCE:1/);
    const note = await as(ids.manager).post(`${E}/applications/${ids.application}/interviews/${ids.interview}/notes`, { note: 'Strong grill experience', rating: 4, recommendation: 'advance' });
    expect(note.status).toBe(201);
    expect((await as(ids.worker).get(`/api/careers/employer/applications/${ids.application}/interviews/${ids.interview}/notes`)).status).toBe(404);
    // Reminder: once, within 24 hours.
    await pool.query("UPDATE career_interviews SET scheduled_at = NOW() + INTERVAL '3 hours' WHERE id = $1", [ids.interview]);
    const scheduling = require('../services/careers/marketplace/scheduling');
    expect((await scheduling.sendReminders(pool)).sent).toBeGreaterThanOrEqual(1);
    expect((await scheduling.sendReminders(pool)).sent).toBe(0);
    // Video room stays off until flagged.
    expect((await as(ids.worker).get(`/api/careers/me/applications/${ids.application}/interviews/${ids.interview}/room`)).status).toBe(503);
    // The room key is a capability secret: the team view only says a room exists.
    await pool.query("UPDATE career_interviews SET video_room_key = $2 WHERE id = $1", [ids.interview, crypto.randomUUID()]);
    const teamView = await as(ids.manager).get(`${E}/applications/${ids.application}`);
    expect(teamView.status).toBe(200);
    expect(JSON.stringify(teamView.body)).not.toContain('video_room_key');
    expect(teamView.body.application.interviews.find((i) => String(i.id) === String(ids.interview)).has_video_room).toBe(true);
    await pool.query('UPDATE career_interviews SET video_room_key = NULL WHERE id = $1', [ids.interview]);
  });

  test('calendar connect is off until configured; callbacks reject bad state', async () => {
    const off = await as(ids.manager).post(`${E}/calendar/google/connect`, {});
    expect(off.status).toBe(503);
    expect(off.body.code).toBe('provider_not_configured');
    process.env.CAREERS_CALENDAR_GOOGLE_ENABLED = 'true';
    process.env.CAREERS_GOOGLE_CLIENT_ID = 'test-client';
    process.env.CAREERS_GOOGLE_CLIENT_SECRET = 'test-secret';
    try {
      const on = await as(ids.manager).post(`${E}/calendar/google/connect`, { return_to: 'https://evil.example/' });
      expect(on.status).toBe(200);
      const url = new URL(on.body.url);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('scope')).toContain('calendar.freebusy');
      const cb = await request(app).get('/api/careers/calendar/google/callback?state=forged&code=x');
      expect(cb.status).toBe(302);
      expect(cb.headers.location).toMatch(/calendar=error/);
      expect(cb.headers.location).not.toContain('evil.example');
    } finally {
      delete process.env.CAREERS_CALENDAR_GOOGLE_ENABLED;
      delete process.env.CAREERS_GOOGLE_CLIENT_ID;
      delete process.env.CAREERS_GOOGLE_CLIENT_SECRET;
    }
  });

  // ── Résumé builder and AI ─────────────────────────────────────────────────

  test('résumé builder: structured entries labelled self-reported, PDF download, parse off by default', async () => {
    const w = as(ids.worker);
    const job = await w.post('/api/careers/me/profile/structured/work', { title: 'Line cook', employer_name: 'Corner Diner', start_month: '2022-01', end_month: '2024-06', description: 'Grill and prep' });
    expect(job.status).toBe(201);
    expect(job.body.entry.verification).toBe('self_reported');
    expect((await w.post('/api/careers/me/profile/structured/work', { title: '' })).status).toBe(400);
    expect((await w.post('/api/careers/me/profile/structured/education', { school: 'Miami Dade College', credential: 'Culinary certificate', end_year: 2021 })).status).toBe(201);
    const list = await w.get('/api/careers/me/profile/structured');
    expect(list.body.work.length).toBe(1);
    expect((await as(ids.worker2).del(`/api/careers/me/profile/structured/work/${job.body.entry.id}`)).status).toBe(404);
    const pdf = await w.get('/api/careers/me/profile/resume.pdf?lang=ar');
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['x-content-type-options']).toBe('nosniff');
    const parse = await w.post('/api/careers/me/profile/resume/parse', { text: 'Line cook at Corner Diner 2022-2024' });
    expect(parse.status).toBe(503);
    expect(parse.body.code).toBe('provider_not_configured');
  });

  test('résumé parsing (flag on): redacted input, suggestions stay self-reported until the worker saves them', async () => {
    process.env.CAREERS_AI_RESUME_PARSE_ENABLED = 'true';
    try {
      const resume = require('../services/careers/marketplace/resume');
      let seen = null;
      const generateImpl = async ({ data, task }) => {
        seen = { data, task };
        return { output: {
          work_history: [{ employer_name: 'Harbor Cafe', title: 'Prep cook', city: '', start_month: '2020-03', end_month: '2021-12', is_current: false, description: '' }],
          education: [], licenses: [{ name: 'Food handler card', issuer: '', number_last4: '', expires_month: '' }], skills: ['grill'],
        }, model: 'test', digest: 'sha256:test' };
      };
      const text = `${'Prep cook at Harbor Cafe from March 2020 to December 2021, knife work, sauces, inventory. '.repeat(3)} Reach me at worker@example.com or 305-555-0100.`;
      const out = await resume.parseResume(pool, ids.worker, { pastedText: text, generateImpl });
      expect(out.available).toBe(true);
      expect(out.verification).toBe('self_reported');
      expect(seen.task).toBe('careers_extract');
      expect(JSON.stringify(seen.data)).not.toMatch(/example\.com|555-0100/);
      const before = (await as(ids.worker).get('/api/careers/me/profile/structured')).body.work.length;
      const imp = await as(ids.worker).post('/api/careers/me/profile/resume/import', { work_history: out.suggestions.work_history, licenses: out.suggestions.licenses });
      expect(imp.status).toBe(201);
      const after = (await as(ids.worker).get('/api/careers/me/profile/structured')).body;
      expect(after.work.length).toBe(before + 1);
      expect(after.work.every((w) => w.verification === 'self_reported')).toBe(true);
      const unreadable = await resume.parseResume(pool, ids.worker, { pastedText: 'too short', generateImpl });
      expect(unreadable).toEqual({ available: false, reason: 'unreadable_file' });
      const down = await resume.parseResume(pool, ids.worker, { pastedText: text, generateImpl: async () => null });
      expect(down.reason).toBe('model_unavailable');
    } finally {
      delete process.env.CAREERS_AI_RESUME_PARSE_ENABLED;
    }
  });

  test('AI match stays off until flagged and never auto-rejects', async () => {
    const res = await as(ids.owner).post(`${E}/applications/${ids.application}/ai-match`);
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) expect(res.body.match.available).toBe(false);
    const { rows: [a] } = await pool.query('SELECT stage FROM career_applications WHERE id = $1', [ids.application]);
    expect(a.stage).not.toBe('rejected');
  });

  // ── Preferences and talent ────────────────────────────────────────────────

  test('available now needs online status; employers see it in search', async () => {
    const w = as(ids.worker);
    expect((await w.patch('/api/careers/me/preferences', { available_now_hours: 4 })).status).toBe(400);
    const ok = await w.patch('/api/careers/me/preferences', { show_online_status: true, available_now_hours: 4, sms_opt_in: true });
    expect(ok.status).toBe(200);
    expect(ok.body.preferences.available_now).toBe(true);
    expect(ok.body.preferences.sms_opt_in).toBe(true);
    const { rows: [np] } = await pool.query('SELECT sms_careers FROM notification_preferences WHERE user_id = $1', [ids.worker]);
    expect(np.sms_careers).toBe(true);
    expect((await w.patch('/api/careers/me/preferences', { available_now_hours: 5 })).status).toBe(400);
  });

  // ── Plans and referrals ───────────────────────────────────────────────────

  test('plans off: unlimited; plans on: free tier limits and webhook upgrades', async () => {
    const off = await as(ids.owner).get(`${E}/plan?business_id=${ids.biz}`);
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
    expect(off.body.entitlements.plans_enabled).toBe(false);
    process.env.CAREERS_PLANS_ENABLED = 'true';
    try {
      const a1 = await as(ids.owner).post(`${E}/candidate-alerts?business_id=${ids.biz}`, { name: 'Cooks nearby', criteria: { near_location: ids.loc1, radius_km: 20 } });
      expect(a1.status).toBe(201);
      const a2 = await as(ids.owner).post(`${E}/candidate-alerts?business_id=${ids.biz}`, { name: 'More cooks', criteria: { near_location: ids.loc1 } });
      expect(a2.status).toBe(402);
      expect(a2.body.code).toBe('plan_limit');
      expect((await as(ids.owner).get(`${E}/analytics.csv?business_id=${ids.biz}`)).status).toBe(402);
      expect((await as(ids.manager).post(`${E}/plan/checkout?business_id=${ids.biz}`, { plan: 'starter' })).status).toBe(403);
      const plans = require('../services/careers/marketplace/plans');
      const evt = (type, object) => ({ id: `evt_${crypto.randomUUID()}`, type, data: { object } });
      const sub = { id: `sub_${crypto.randomUUID()}`, customer: 'cus_test', status: 'active', metadata: { business_id: String(ids.biz), plan: 'growth' }, items: { data: [] }, current_period_end: Math.floor(Date.now() / 1000) + 2592000 };
      const e = evt('customer.subscription.created', sub);
      expect((await plans.applyStripeEvent(pool, e)).plan).toBe('growth');
      expect((await plans.applyStripeEvent(pool, e)).duplicate).toBe(true);
      ids.subscription = sub.id;
      const a3 = await as(ids.owner).post(`${E}/candidate-alerts?business_id=${ids.biz}`, { name: 'More cooks', criteria: { near_location: ids.loc1 } });
      expect(a3.status).toBe(201);
      const csv = await as(ids.owner).get(`${E}/analytics.csv?business_id=${ids.biz}`);
      expect(csv.status).toBe(200);
      expect(csv.text.split('\r\n')[0]).toContain('opening_id');
    } finally {
      delete process.env.CAREERS_PLANS_ENABLED;
    }
  });

  test('referrals: attribution rules, accrual, two distinct admins before payout', async () => {
    process.env.CAREERS_REFERRALS_ENABLED = 'true';
    process.env.CAREERS_PLANS_ENABLED = 'true';
    try {
      const mine = await as(ids.agencyOwner).get('/api/careers/me/referrals');
      expect(mine.status).toBe(200);
      const code = mine.body.referrals.code;
      expect(code).toMatch(/^[A-Z0-9]{8}$/);
      // The growth subscription above is "paid", so this business is too late.
      const late = await as(ids.owner).post(`${E}/referral?business_id=${ids.biz}`, { code });
      expect(late.status).toBe(409);
      await pool.query('DELETE FROM career_employer_subscriptions WHERE business_id = $1', [ids.biz]);
      const own = await as(ids.agencyOwner).post(`${E}/referral?business_id=${ids.agency}`, { code });
      expect(own.status).toBe(400);
      expect((await as(ids.manager).post(`${E}/referral?business_id=${ids.biz}`, { code })).status).toBe(403);
      const ok = await as(ids.owner).post(`${E}/referral?business_id=${ids.biz}`, { code });
      expect(ok.status).toBe(201);
      const plans = require('../services/careers/marketplace/plans');
      await plans.applyStripeEvent(pool, { id: `evt_${crypto.randomUUID()}`, type: 'customer.subscription.updated', data: { object: { id: ids.subscription, customer: 'cus_test', status: 'active', metadata: { business_id: String(ids.biz), plan: 'starter' }, items: { data: [] } } } });
      const inv = `in_${crypto.randomUUID()}`;
      const paid = await plans.applyStripeEvent(pool, { id: `evt_${crypto.randomUUID()}`, type: 'invoice.paid', data: { object: { id: inv, subscription: ids.subscription, amount_paid: 4900, currency: 'usd' } } });
      expect(paid.commission).toBeTruthy();
      const list = await as(ids.admin).get('/api/careers/admin/referral-commissions');
      const c = list.body.commissions.find((x) => String(x.id) === String(paid.commission));
      expect(c.stripe_invoice_id).toBe(inv);
      expect(c.amount_cents).toBe(Math.floor((4900 * 1500) / 10000));
      expect((await as(ids.admin).post(`/api/careers/admin/referral-commissions/${c.id}/paid`, { reference: 'ACH-1' })).status).toBe(409);
      expect((await as(ids.admin).post(`/api/careers/admin/referral-commissions/${c.id}/approve`)).body.approvals).toBe(1);
      expect((await as(ids.admin).post(`/api/careers/admin/referral-commissions/${c.id}/approve`)).status).toBe(409);
      expect((await as(ids.admin2).post(`/api/careers/admin/referral-commissions/${c.id}/approve`)).body.status).toBe('approved');
      expect((await as(ids.admin).post(`/api/careers/admin/referral-commissions/${c.id}/paid`, {})).status).toBe(400);
      expect((await as(ids.admin).post(`/api/careers/admin/referral-commissions/${c.id}/paid`, { reference: 'ACH-1' })).status).toBe(200);
      // A refund after payout cannot silently claw back a paid row.
      const refunded = await plans.applyStripeEvent(pool, { id: `evt_${crypto.randomUUID()}`, type: 'charge.refunded', data: { object: { invoice: inv } } });
      expect(refunded.voided).toBe(0);
    } finally {
      delete process.env.CAREERS_REFERRALS_ENABLED;
      delete process.env.CAREERS_PLANS_ENABLED;
    }
  });

  // ── Agencies ──────────────────────────────────────────────────────────────

  test('agency: client approval, posts for the client, sees only its own openings, revocable', async () => {
    const req1 = await as(ids.agencyOwner).post(`${E}/agency-links?business_id=${ids.agency}`, { client_business_id: ids.biz, permissions: ['post_openings', 'manage_pipeline'] });
    expect(req1.status).toBe(201);
    const linkId = req1.body.link.id;
    // Before approval the agency has no access.
    expect((await as(ids.agencyOwner).post(`${E}/openings`, openingBody({ agency_business_id: ids.agency, title: 'Temp cook' }))).status).toBe(404);
    expect((await as(ids.agencyOwner).post(`${E}/agency-links/${linkId}/decide?business_id=${ids.agency}`, { decision: 'approve' })).status).toBe(404);
    const dec = await as(ids.owner).post(`${E}/agency-links/${linkId}/decide?business_id=${ids.biz}`, { decision: 'approve' });
    expect(dec.status).toBe(200);
    const post = await as(ids.agencyOwner).post(`${E}/openings`, openingBody({ agency_business_id: ids.agency, title: 'Temp cook' }));
    expect(post.status).toBe(201);
    const agencyOpening = Number(post.body.opening.id);
    expect((await request(app).get(`/api/careers/openings/${agencyOpening}`)).body.opening.via_agency).toBe(true);
    expect((await as(ids.agencyOwner).post(`${E}/openings`, openingBody({ agency_business_id: ids.agency, team_role: 'manager' }))).status).toBe(403);
    expect((await as(ids.agencyOwner).get(`${E}/openings/${agencyOpening}`)).status).toBe(200);
    expect((await as(ids.agencyOwner).get(`${E}/openings/${ids.opening}`)).status).toBe(404);
    expect((await as(ids.agencyOwner).get(`${E}/applications/${ids.application}`)).status).toBe(404);
    const dash = await as(ids.agencyOwner).get(`${E}/analytics?business_id=${ids.biz}&agency_business_id=${ids.agency}`);
    expect(dash.status).toBe(200);
    expect(dash.body.openings.map((o) => Number(o.id))).toEqual([agencyOpening]);
    const { rows: logs } = await pool.query("SELECT business_id FROM business_audit_log WHERE action = 'careers.opening.created' AND target_id = $1", [String(agencyOpening)]);
    expect(logs.map((l) => Number(l.business_id)).sort()).toEqual([ids.biz, ids.agency].sort());
    expect((await as(ids.owner).post(`${E}/agency-links/${linkId}/revoke?business_id=${ids.biz}`)).status).toBe(200);
    expect((await as(ids.agencyOwner).get(`${E}/openings/${agencyOpening}`)).status).toBe(404);
  });

  // ── Candidate sourcing ────────────────────────────────────────────────────

  test('shortlists respect consent; candidate alerts notify with counts only', async () => {
    const sl = await as(ids.owner).post(`${E}/shortlists?business_id=${ids.biz}`, { name: 'Weekend cooks' });
    expect(sl.status).toBe(201);
    const sid = sl.body.shortlist.id;
    // Not searchable → cannot be added.
    expect((await as(ids.owner).post(`${E}/shortlists/${sid}/members?business_id=${ids.biz}`, { user_id: ids.outsider })).status).toBe(404);
    // Searchable workers are visible.
    expect((await as(ids.worker).patch('/api/careers/me/profile', { visibility: 'searchable' })).status).toBe(200);
    const add = await as(ids.owner).post(`${E}/shortlists/${sid}/members?business_id=${ids.biz}`, { user_id: ids.worker, note: 'Great on grill' });
    expect(add.status).toBe(201);
    const members = await as(ids.owner).get(`${E}/shortlists/${sid}/members?business_id=${ids.biz}`);
    expect(members.body.members.length).toBe(1);
    expect((await as(ids.agencyOwner).get(`${E}/shortlists/${sid}/members?business_id=${ids.agency}`)).status).toBe(404);
    const candidates = require('../services/careers/marketplace/candidates');
    // Put the store and the worker in the same postal area, then run the job.
    const postal = `T${crypto.randomInt(100000, 999999)}`;
    const { rows: [gc] } = await pool.query(
      `INSERT INTO geo_postal_centroids (country, postal_code, place_name, lat, lng, geog, h3_r5, h3_r7, source_version)
       VALUES ('US', $1, 'Miami', 25.77, -80.19, ST_SetSRID(ST_MakePoint(-80.19, 25.77), 4326)::geography, '85754e67fffffff', '87754e64dffffff', 'tmk')
       RETURNING id`, [postal]
    );
    await pool.query('UPDATE career_profiles SET postal_centroid_id = $2 WHERE user_id = $1', [ids.worker, gc.id]);
    await pool.query('UPDATE restaurant_locations SET latitude = 25.771, longitude = -80.191 WHERE id = $1', [ids.loc1]);
    await pool.query("UPDATE career_candidate_alerts SET last_run_at = NOW() - INTERVAL '2 hours' WHERE business_id = $1", [ids.biz]);
    emails().length = 0;
    const run = await candidates.runCandidateAlerts(pool);
    expect(run.alerts).toBeGreaterThanOrEqual(1);
    expect(run.notified).toBeGreaterThanOrEqual(1);
    const { rows: hits } = await pool.query(
      'SELECT h.user_id FROM career_candidate_alert_hits h JOIN career_candidate_alerts a ON a.id = h.alert_id WHERE a.business_id = $1', [ids.biz]
    );
    expect(hits.map((h) => h.user_id)).toContain(ids.worker);
    // The notice names a count, never a person.
    expect(JSON.stringify(emails())).not.toMatch(/mk-worker-/);
    const again = await candidates.runCandidateAlerts(pool);
    expect(again.notified).toBe(0);
  });

  test('analytics funnel counts the pipeline', async () => {
    const dash = await as(ids.owner).get(`${E}/analytics?business_id=${ids.biz}&days=30`);
    expect(dash.status).toBe(200);
    const row = dash.body.openings.find((o) => Number(o.id) === ids.opening);
    expect(row.applications).toBeGreaterThanOrEqual(2);
    expect(row.screened_out).toBeGreaterThanOrEqual(1);
    expect(row.views).toBeGreaterThanOrEqual(1);
    expect((await as(ids.worker).get(`${E}/analytics?business_id=${ids.biz}`)).status).toBe(404);
  });

  // ── Erasure ───────────────────────────────────────────────────────────────

  test('anonymizing an application removes messages, notes, AI scores and screener answers', async () => {
    const retention = require('../services/careers/retention');
    const { withTransaction } = require('../utils/transaction');
    await withTransaction(pool, (c) => retention.anonymizeApplication(c, ids.application, { reason: 'test' }), 'test_anonymize');
    const { rows: [t] } = await pool.query('SELECT COUNT(*)::int AS n FROM career_message_threads WHERE application_id = $1', [ids.application]);
    const { rows: [n] } = await pool.query('SELECT COUNT(*)::int AS n FROM career_interview_notes WHERE interview_id = $1', [ids.interview]);
    const { rows: [a] } = await pool.query('SELECT screener_answers FROM career_applications WHERE id = $1', [ids.application]);
    expect(t.n).toBe(0);
    expect(n.n).toBe(0);
    expect(a.screener_answers).toBeNull();
  });
});
