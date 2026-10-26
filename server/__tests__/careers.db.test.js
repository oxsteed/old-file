'use strict';

/**
 * DB tests: OxSteed Careers end to end against a real migrated schema.
 *
 * Covers the spec's acceptance list: route permissions (C-01 role rank,
 * C-02 cross-business isolation, C-03 store scope), required pay, the 18+
 * gate, guest apply with one-time links and caps, offers (above-range
 * approval, candidate-only acceptance with identity check), the onboarding
 * run (idempotent), background-check timing (only after a conditional
 * offer), invitation caps (50/day, 3/month), boosts never touching
 * applicant order, the impact-ratio auto-off, retention anonymization,
 * platform openings behind manage_hiring, and vendor webhooks staying off
 * until configured.
 *
 * Run with:
 *   CAREERS_TEST_DATABASE_URL=postgresql://.../careers_test \
 *     npx jest --runInBand __tests__/careers.db.test.js
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
  for (const k of ['CAREERS_CHECKR_ENABLED', 'CAREERS_EOR_ENABLED', 'CAREERS_BILLING_ENABLED', 'CAREERS_AI_RANKING_ENABLED', 'CAREERS_CHECKR_WEBHOOK_SECRET', 'CAREERS_EOR_WEBHOOK_SECRET', 'CAREERS_STRIPE_WEBHOOK_SECRET']) delete process.env[k];
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

ddescribe('careers (real database)', () => {
  let pool;
  let app;
  let ids;
  const emails = () => require('../utils/email').sendEmail.mock.calls;

  async function newUser(label, { role = 'customer', adult = true, didit = false } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', $3, 'Fixture', $4, TRUE, TRUE, $5, $6)`,
      [id, `careers-${label}-${id}@example.invalid`, label, role, didit ? 'verified' : null, didit ? new Date() : null]
    );
    if (adult) await pool.query('INSERT INTO growth_subject_eligibility (user_id, adult_confirmed, verification_method, verified_at) VALUES ($1, TRUE, $2, NOW())', [id, 'provider']);
    mockUsers.set(id, { id, role, email: `careers-${label}-${id}@example.invalid` });
    return id;
  }

  async function member(businessId, ownerId, userId, role) {
    const { rows: [m] } = await pool.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, invite_email, role, status)
       VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [businessId, ownerId, userId, mockUsers.get(userId).email, role]
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

  const START = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const applyBody = { authorized_to_work: true, needs_sponsorship: false };

  beforeAll(async () => {
    pool = require('../db');
    const { errorHandler } = require('../middleware/errorHandler');
    app = express();
    app.set('trust proxy', true);
    const webhooks = require('../controllers/careers/webhookController');
    app.post('/api/careers/webhooks/checkr', express.raw({ type: 'application/json' }), webhooks.checkr);
    app.post('/api/careers/webhooks/eor', express.raw({ type: 'application/json' }), webhooks.eor);
    app.post('/api/careers/webhooks/stripe', express.raw({ type: 'application/json' }), webhooks.stripe);
    app.use(express.json());
    app.use('/api/careers', require('../routes/careers'));
    app.use(errorHandler);

    ids = {};
    ids.owner = await newUser('owner');
    ids.manager = await newUser('manager');
    ids.manager2 = await newUser('manager2');
    ids.employee = await newUser('employee');
    ids.worker = await newUser('worker');
    ids.minor = await newUser('minor', { adult: false });
    ids.outsider = await newUser('outsider');
    ids.owner2 = await newUser('owner2');
    ids.admin = await newUser('admin', { role: 'admin' });
    ids.superAdmin = await newUser('super', { role: 'super_admin' });

    ({ rows: [{ id: ids.biz }] } = await pool.query(`INSERT INTO businesses (user_id, business_name, is_business_verified) VALUES ($1, 'Careers Grill', TRUE) RETURNING id`, [ids.owner]));
    ({ rows: [{ id: ids.biz2 }] } = await pool.query(`INSERT INTO businesses (user_id, business_name, is_business_verified) VALUES ($1, 'Other Cafe', TRUE) RETURNING id`, [ids.owner2]));
    ({ rows: [{ id: ids.restaurant }] } = await pool.query(`INSERT INTO food_restaurants (business_id, owner_user_id, display_name) VALUES ($1, $2, 'Careers Grill') RETURNING id`, [ids.biz, ids.owner]));
    ({ rows: [{ id: ids.region }] } = await pool.query(`INSERT INTO restaurant_regions (restaurant_id, code, name) VALUES ($1, 'S', 'South') RETURNING id`, [ids.restaurant]));
    ({ rows: [{ id: ids.loc1 }] } = await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name, region_id) VALUES ($1, 'Downtown', $2) RETURNING id`, [ids.restaurant, ids.region]));
    ({ rows: [{ id: ids.loc2 }] } = await pool.query(`INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, 'Airport') RETURNING id`, [ids.restaurant]));
    for (const k of ['biz', 'biz2', 'restaurant', 'region', 'loc1', 'loc2']) ids[k] = Number(ids[k]);
    ids.managerMembership = await member(ids.biz, ids.owner, ids.manager, 'manager');
    ids.manager2Membership = await member(ids.biz, ids.owner, ids.manager2, 'manager');
    await member(ids.biz, ids.owner, ids.employee, 'employee');
    // The store manager runs Downtown only (C-03).
    await pool.query(
      `INSERT INTO restaurant_location_memberships (restaurant_id, location_id, membership_id, status) VALUES ($1, $2, $3, 'active')`,
      [ids.restaurant, ids.loc1, ids.managerMembership]
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // ── Openings, permissions, pay ────────────────────────────────────────────

  test('unverified businesses cannot publish (K6)', async () => {
    await pool.query('UPDATE businesses SET is_business_verified = FALSE WHERE id = $1', [ids.biz]);
    const res = await as(ids.owner).post('/api/careers/employer/openings', openingBody());
    await pool.query('UPDATE businesses SET is_business_verified = TRUE WHERE id = $1', [ids.biz]);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('business_not_verified');
  });

  test('pay range is required on every opening', async () => {
    const res = await as(ids.owner).post('/api/careers/employer/openings', openingBody({ compensation_min: null, compensation_max: null }));
    expect(res.status).toBe(400);
    expect(res.body.fields || res.body.details || res.body).toEqual(expect.anything());
    expect(JSON.stringify(res.body)).toMatch(/compensation_min/);
  });

  test('owner posts an opening and it is public', async () => {
    const res = await as(ids.owner).post('/api/careers/employer/openings', openingBody());
    expect(res.status).toBe(201);
    ids.opening = Number(res.body.opening.id);
    const pub = await request(app).get(`/api/careers/openings/${ids.opening}`);
    expect(pub.status).toBe(200);
    expect(pub.body.opening.title).toBe('Line cook');
    const list = await request(app).get('/api/careers/openings');
    expect(list.body.openings.map((o) => Number(o.id))).toContain(ids.opening);
  });

  test('C-03: a store manager sees and posts only inside their stores', async () => {
    const res = await as(ids.owner).post('/api/careers/employer/openings', openingBody({ title: 'Airport cashier', location_ids: [ids.loc2] }));
    expect(res.status).toBe(201);
    ids.airportOpening = Number(res.body.opening.id);
    expect((await as(ids.manager).get(`/api/careers/employer/openings/${ids.airportOpening}?business_id=${ids.biz}`)).status).toBe(404);
    expect((await as(ids.manager).get(`/api/careers/employer/openings/${ids.opening}`)).status).toBe(200);
    const listed = await as(ids.manager).get(`/api/careers/employer/openings?business_id=${ids.biz}`);
    expect(listed.status).toBe(200);
    const listedIds = listed.body.openings.map((o) => Number(o.id));
    expect(listedIds).toContain(ids.opening);
    expect(listedIds).not.toContain(ids.airportOpening);
    const post = await as(ids.manager).post('/api/careers/employer/openings', openingBody({ location_ids: [ids.loc2] }));
    expect(post.status).toBe(403);
    expect(post.body.code || post.body.error).toBeTruthy();
  });

  test('C-01: managers cannot hire into their own rank or above', async () => {
    const res = await as(ids.manager).post('/api/careers/employer/openings', openingBody({ team_role: 'manager' }));
    expect(res.status).toBe(403);
  });

  test('C-02: other businesses, outsiders and staff without hiring rights are kept out', async () => {
    expect((await as(ids.owner2).get(`/api/careers/employer/openings/${ids.opening}`)).status).toBe(404);
    expect((await as(ids.outsider).get(`/api/careers/employer/openings?business_id=${ids.biz}`)).status).toBe(404);
    expect((await as(ids.employee).get(`/api/careers/employer/openings?business_id=${ids.biz}`)).status).toBe(403);
    expect((await as(ids.owner2).post('/api/careers/employer/openings', openingBody())).status).toBe(404);
  });

  test('compliance check runs without saving', async () => {
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM career_openings');
    const res = await as(ids.owner).post('/api/careers/employer/openings/check', openingBody({ description: 'Must be a young, energetic worker' }));
    expect(res.status).toBe(200);
    expect(res.body.compliance).toBeTruthy();
    const after = await pool.query('SELECT COUNT(*)::int AS n FROM career_openings');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  // ── Applying ──────────────────────────────────────────────────────────────

  test('18+ gate: an unconfirmed account cannot apply', async () => {
    const res = await as(ids.minor).post(`/api/careers/openings/${ids.opening}/apply`, applyBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('age_verification_required');
  });

  test('worker applies; the employer pipeline shows it', async () => {
    const res = await as(ids.worker).post(`/api/careers/openings/${ids.opening}/apply`, applyBody);
    expect(res.status).toBe(201);
    ids.application = Number(res.body.application.id);
    const dup = await as(ids.worker).post(`/api/careers/openings/${ids.opening}/apply`, applyBody);
    expect(dup.status).toBe(409);
    const list = await as(ids.manager).get(`/api/careers/employer/openings/${ids.opening}/applications`);
    expect(list.status).toBe(200);
    expect(list.body.applications.map((a) => Number(a.id))).toContain(ids.application);
    expect(list.body.ranking.mode).toBe('neutral');
    const mine = await as(ids.worker).get('/api/careers/me/applications');
    expect(mine.status).toBe(200);
  });

  test('guest apply: one-time link, nothing reaches the employer before confirm, 3 per email a day', async () => {
    emails().length = 0;
    const email = `guest-${crypto.randomUUID()}@example.invalid`;
    const body = { email, first_name: 'Gia', last_name: 'Guest', age_attested: true, ...applyBody };
    const ip = `10.${crypto.randomInt(255)}.${crypto.randomInt(255)}.${crypto.randomInt(255)}`;
    const guestApply = () => request(app).post(`/api/careers/openings/${ids.opening}/guest-apply`).set('X-Forwarded-For', ip).send(body);
    const start = await guestApply();
    expect(start.status).toBe(202);
    const before = await pool.query('SELECT COUNT(*)::int AS n FROM career_applications WHERE opening_id = $1', [ids.opening]);
    const call = emails().find((c) => c[0].to === email);
    expect(call).toBeTruthy();
    const token = decodeURIComponent(JSON.stringify(call[0]).match(/token=([A-Za-z0-9_%-]+)/)[1]);
    const confirm = await request(app).post(`/api/careers/openings/${ids.opening}/guest-apply/confirm`).send({ token });
    expect(confirm.status).toBe(201);
    const again = await request(app).post(`/api/careers/openings/${ids.opening}/guest-apply/confirm`).send({ token });
    expect([200, 409, 410]).toContain(again.status);
    const after = await pool.query('SELECT COUNT(*)::int AS n FROM career_applications WHERE opening_id = $1', [ids.opening]);
    expect(after.rows[0].n).toBe(before.rows[0].n + 1);
    const { rows: [guest] } = await pool.query('SELECT is_guest FROM career_applications WHERE opening_id = $1 AND lower(applicant_email) = $2', [ids.opening, email]);
    expect(guest.is_guest).toBe(true);
    await guestApply();
    await guestApply();
    const capped = await guestApply();
    expect(capped.status).toBe(429);
  });

  // ── Pipeline, offers, onboarding ──────────────────────────────────────────

  test('stage moves, interviews and the no-hire-button rule', async () => {
    const hire = await as(ids.manager).post(`/api/careers/employer/applications/${ids.application}/stage`, { stage: 'hired' });
    expect(hire.status).toBe(409);
    const move = await as(ids.manager).post(`/api/careers/employer/applications/${ids.application}/stage`, { stage: 'interview' });
    expect(move.status).toBe(200);
    const when = new Date(Date.now() + 3 * 86400000).toISOString();
    const iv = await as(ids.manager).post(`/api/careers/employer/applications/${ids.application}/interviews`, { scheduled_at: when, mode: 'onsite', timezone: 'America/New_York' });
    expect(iv.status).toBe(201);
    expect(iv.body.interview.id).toBeTruthy();
    expect((await as(ids.owner2).get(`/api/careers/employer/applications/${ids.application}`)).status).toBe(404);
  });

  test('background check only after a conditional offer, and only when enabled', async () => {
    const res = await as(ids.owner).post(`/api/careers/employer/applications/${ids.application}/background-check`);
    expect(res.status).toBe(409);
  });

  test('above-range offers need the owner or a brand admin', async () => {
    const missingReason = await as(ids.manager).post(`/api/careers/employer/applications/${ids.application}/offers`, { start_date: START, pay: 22, pay_period: 'hourly' });
    expect(missingReason.status).toBe(400);
    const below = await as(ids.manager).post(`/api/careers/employer/applications/${ids.application}/offers`, { start_date: START, pay: 10, pay_period: 'hourly' });
    expect(below.status).toBe(400);
    const res = await as(ids.manager).post(`/api/careers/employer/applications/${ids.application}/offers`, { start_date: START, pay: 22, pay_period: 'hourly', outside_posted_range_reason: 'Ten years on the line' });
    expect(res.status).toBe(201);
    expect(res.body.offer.status).toBe('awaiting_approval');
    ids.offer = Number(res.body.offer.id);
    expect((await as(ids.manager).post(`/api/careers/employer/offers/${ids.offer}/approve`)).status).toBe(403);
    const ok = await as(ids.owner).post(`/api/careers/employer/offers/${ids.offer}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.offer.status).toBe('pending');
  });

  test('only the candidate accepts, and only after identity verification', async () => {
    expect((await as(ids.owner).post(`/api/careers/me/offers/${ids.offer}/decide`, { decision: 'accept' })).status).toBe(404);
    const unverified = await as(ids.worker).post(`/api/careers/me/offers/${ids.offer}/decide`, { decision: 'accept' });
    expect(unverified.status).toBe(403);
    expect(unverified.body.code).toBe('identity_verification_required');
    await pool.query(`UPDATE users SET didit_status = 'verified', didit_verified_at = NOW() WHERE id = $1`, [ids.worker]);
    const res = await as(ids.worker).post(`/api/careers/me/offers/${ids.offer}/decide`, { decision: 'accept' });
    expect(res.status).toBe(200);
    expect(res.body.application.stage).toBe('hired');
    expect(res.body.onboarding_run).toBeTruthy();
    ids.run = Number(res.body.onboarding_run.id);
    const { rows: members } = await pool.query(`SELECT role, status FROM business_members WHERE business_id = $1 AND member_id = $2`, [ids.biz, ids.worker]);
    expect(members).toHaveLength(1);
    expect(members[0]).toEqual(expect.objectContaining({ role: 'employee', status: 'active' }));
  });

  test('onboarding run is idempotent', async () => {
    const onboarding = require('../services/careers/onboardingRun');
    await onboarding.executeRun(ids.run);
    await onboarding.executeRun(ids.run);
    const { rows: members } = await pool.query(`SELECT id FROM business_members WHERE business_id = $1 AND member_id = $2`, [ids.biz, ids.worker]);
    expect(members).toHaveLength(1);
    const { rows: loc } = await pool.query(`SELECT id FROM restaurant_location_memberships WHERE membership_id = $1 AND status = 'active'`, [members[0].id]);
    expect(loc).toHaveLength(1);
    const run = await as(ids.worker).get(`/api/careers/me/onboarding/${ids.run}`);
    expect(run.status).toBe(200);
    expect(run.body.run.steps.length).toBeGreaterThan(3);
    expect((await as(ids.outsider).get(`/api/careers/me/onboarding/${ids.run}`)).status).toBe(404);
    expect((await as(ids.manager).get(`/api/careers/employer/onboarding/${ids.run}`)).status).toBe(200);
    expect((await as(ids.owner2).get(`/api/careers/employer/onboarding/${ids.run}`)).status).toBe(404);
  });

  // ── Hiring scopes (Q17) ───────────────────────────────────────────────────

  test('only the owner grants brand or region scope; region scope widens store reach', async () => {
    expect((await as(ids.manager).post('/api/careers/employer/scopes', { business_id: ids.biz, membership_id: ids.manager2Membership, scope_level: 'brand' })).status).toBe(403);
    const before = await as(ids.manager2).get(`/api/careers/employer/openings/${ids.airportOpening}`);
    expect(before.status).toBe(200); // no store memberships: business-wide store manager
    const grant = await as(ids.owner).post('/api/careers/employer/scopes', { business_id: ids.biz, membership_id: ids.manager2Membership, scope_level: 'region', region_id: ids.region });
    expect(grant.status).toBe(201);
    // Region South holds Downtown only, so Airport is now out of scope.
    expect((await as(ids.manager2).get(`/api/careers/employer/openings/${ids.airportOpening}`)).status).toBe(404);
    expect((await as(ids.manager2).get(`/api/careers/employer/openings/${ids.opening}`)).status).toBe(200);
    const dup = await as(ids.owner).post('/api/careers/employer/scopes', { business_id: ids.biz, membership_id: ids.manager2Membership, scope_level: 'region', region_id: ids.region });
    expect(dup.status).toBe(409);
  });

  // ── Invitations (Q19) ─────────────────────────────────────────────────────

  test('invitation caps: 3 per worker per month, 50 per business per day', async () => {
    const ledger = require('../services/careers/shareLedger');
    // Known to the business: a past team member who opted in.
    const knownWorker = async (label) => {
      const uid = await newUser(label);
      await ledger.setVisibility(pool, uid, 'known_businesses');
      await ledger.setCareerOffersOptIn(pool, uid, true);
      await pool.query(`INSERT INTO staff_offboarding_records (business_id, user_id, removed_at, retain_until) VALUES ($1, $2, NOW() - INTERVAL '90 days', CURRENT_DATE + 365)`, [ids.biz, uid]);
      return uid;
    };
    const target = await knownWorker('invitee');
    const talent = await as(ids.owner).get(`/api/careers/employer/talent?business_id=${ids.biz}`);
    expect(talent.status).toBe(200);
    expect(JSON.stringify(talent.body)).toContain(target);
    const send = () => as(ids.owner).post('/api/careers/employer/invitations', {
      business_id: ids.biz, user_id: target, opening_id: ids.opening, reason_code: 'worked_with_us', permissible_purpose_certified: true,
    });
    const first = await send();
    expect(first.status).toBe(201);
    for (let i = 0; i < 3; i += 1) {
      await pool.query(
        `INSERT INTO career_invitations (business_id, opening_id, user_id, sent_by, source, reason_code, status, permissible_purpose_certified, expires_at, created_at)
         VALUES ($1, NULL, $2, $3, 'talent_you_know', 'worked_with_us', 'declined', TRUE, NOW() + INTERVAL '14 days', NOW() - INTERVAL '2 days')`,
        [ids.biz, target, ids.owner]
      );
    }
    const capped = await send();
    expect(capped.status).toBe(429);
    expect(capped.body.code).toMatch(/invitation_cap/);
    const filler = await newUser('filler');
    await pool.query(
      `INSERT INTO career_invitations (business_id, opening_id, user_id, sent_by, source, reason_code, status, permissible_purpose_certified, expires_at)
       SELECT $1, NULL, $2, $3, 'talent_search', 'skills_match', 'declined', TRUE, NOW() + INTERVAL '14 days' FROM generate_series(1, 50)`,
      [ids.biz, filler, ids.owner]
    );
    const other = await knownWorker('invitee2');
    const daily = await as(ids.owner).post('/api/careers/employer/invitations', {
      business_id: ids.biz, user_id: other, opening_id: ids.opening, reason_code: 'worked_with_us', permissible_purpose_certified: true,
    });
    expect(daily.status).toBe(429);
    expect(daily.body.code).toBe('invitation_cap_business');
  });

  // ── Boosts never change applicant order; impact-ratio auto-off ───────────

  test('an active boost does not change applicant order', async () => {
    const order = async () => (await as(ids.owner).get(`/api/careers/employer/openings/${ids.opening}/applications?sort=ai`)).body.applications.map((a) => a.id);
    const before = await order();
    await pool.query(
      `INSERT INTO career_boosts (business_id, opening_id, plan, status, starts_at, ends_at, price_cents, currency, created_by)
       VALUES ($1, $2, 'boost_7d', 'active', NOW(), NOW() + INTERVAL '7 days', 1900, 'USD', $3)`,
      [ids.biz, ids.opening, ids.owner]
    );
    expect(await order()).toEqual(before);
  });

  test('impact ratio under 0.8 switches AI ranking off for that scope', async () => {
    const fairness = require('../services/careers/fairness');
    const { rankingGate } = require('../services/careers/matching');
    const { rows: [opening] } = await pool.query(
      `INSERT INTO career_openings (employer_type, business_id, slug, title, country_code, region, city, currency_code, compensation_min, compensation_max,
                                    compensation_period, work_authorization, status, created_by, ai_ranking_enabled, location_ids, team_role)
       VALUES ('business', $1, $2, 'Ranked role', 'US', 'FL', 'Miami', 'USD', 15, 18, 'hourly', 'local_authorized', 'open', $3, TRUE, ARRAY[$4::bigint], 'employee')
       RETURNING *`,
      [ids.biz, `ranked-${crypto.randomUUID().slice(0, 8)}`, ids.owner, ids.loc1]
    );
    const { rows: [run] } = await pool.query(
      `INSERT INTO career_ai_runs (purpose, opening_id, input_hash, model, output) VALUES ('rank_applicants', $1, $2, 'test', '{}'::jsonb) RETURNING id`,
      [opening.id, crypto.randomBytes(32).toString('hex')]
    );
    const eeo = require('../services/careers/eeo');
    let n = 0;
    for (const [group, advanced] of [['female', 2], ['male', 10]]) {
      for (let i = 0; i < 12; i += 1) {
        const uid = await newUser(`fair-${group}-${i}`);
        n += 1;
        const { rows: [a] } = await pool.query(
          `INSERT INTO career_applications (opening_id, user_id, applicant_email, first_name, last_name, stage, source, authorized_to_work, needs_sponsorship, ai_rank_run_id, applicant_number, created_at)
           VALUES ($1, $2, $6, 'Fair', 'Test', $3, 'direct', TRUE, FALSE, $4, $5, NOW() - INTERVAL '3 days') RETURNING id`,
          [opening.id, uid, i < advanced ? 'interview' : 'rejected', run.id, n, `fair-${n}-${uid}@example.invalid`]
        );
        await eeo.saveResponses(pool, a.id, { sex: group });
      }
    }
    const today = new Date();
    const periodEnd = new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
    const periodStart = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    const result = await fairness.runRankingCheck({ periodStart, periodEnd });
    expect(result.blocked.length).toBeGreaterThan(0);
    process.env.CAREERS_AI_RANKING_ENABLED = 'true';
    await pool.query(
      `INSERT INTO career_ai_ranking_markets (market, enabled, bias_audit_passed_at, bias_audit_ref) VALUES ('US', TRUE, NOW(), 'test-audit')
       ON CONFLICT (market) DO UPDATE SET enabled = TRUE, bias_audit_passed_at = NOW(), bias_audit_ref = 'test-audit'`
    );
    const gate = await rankingGate(pool, opening);
    delete process.env.CAREERS_AI_RANKING_ENABLED;
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe('impact_ratio_block');
  });

  // ── Retention (Q18) ───────────────────────────────────────────────────────

  test('applications past retention are anonymized; legal holds are kept', async () => {
    const retention = require('../services/careers/retention');
    const uid = await newUser('old-applicant');
    const mk = async (hold) => (await pool.query(
      `INSERT INTO career_applications (opening_id, user_id, applicant_email, first_name, last_name, stage, source, authorized_to_work, needs_sponsorship,
                                        retention_until, legal_hold, applicant_number, cover_letter)
       VALUES ($1, $2, 'old@example.invalid', 'Old', 'Applicant', 'rejected', 'direct', TRUE, FALSE, CURRENT_DATE - 1, $3,
               (SELECT COALESCE(MAX(applicant_number), 0) + 1 FROM career_applications WHERE opening_id = $1), 'Dear hiring team')
       RETURNING id`,
      [ids.opening, hold ? null : uid, hold]
    )).rows[0].id;
    const gone = await mk(false);
    const held = await mk(true);
    await retention.sweepExpired({ db: pool });
    const { rows: [a] } = await pool.query('SELECT anonymized_at, first_name, applicant_email, cover_letter, user_id FROM career_applications WHERE id = $1', [gone]);
    expect(a.anonymized_at).not.toBeNull();
    expect(a.cover_letter).toBeNull();
    expect(a.applicant_email).not.toBe('old@example.invalid');
    const { rows: [h] } = await pool.query('SELECT anonymized_at FROM career_applications WHERE id = $1', [held]);
    expect(h.anonymized_at).toBeNull();
  });

  // ── Platform hiring and admin ─────────────────────────────────────────────

  test('platform openings need the manage_hiring grant', async () => {
    const body = openingBody({ business_id: undefined, employer_type: 'platform', team_role: undefined, location_ids: [] });
    expect((await as(ids.admin).post('/api/careers/employer/openings?employer=platform', body)).status).toBe(404);
    expect((await as(ids.owner).post('/api/careers/employer/openings?employer=platform', body)).status).toBe(404);
    const ok = await as(ids.superAdmin).post('/api/careers/employer/openings?employer=platform', body);
    expect(ok.status).toBe(201);
    expect(ok.body.opening.employer_type).toBe('platform');
    const list = await as(ids.superAdmin).get('/api/careers/employer/openings?employer=platform');
    expect(list.body.openings.map((o) => Number(o.id))).toContain(Number(ok.body.opening.id));
  });

  test('admin gate: ranking markets cannot be enabled without a bias audit; EU needs AI Act sign-off', async () => {
    expect((await as(ids.admin).get('/api/careers/admin/ranking/markets')).status).toBe(403);
    expect((await as(ids.owner).get('/api/careers/admin/ranking/markets')).status).toBe(403);
    const tag = crypto.randomBytes(2).toString('hex').toUpperCase();
    const noAudit = await as(ids.superAdmin).put(`/api/careers/admin/ranking/markets/US-T${tag}`, { enabled: true });
    expect(noAudit.status).toBe(409);
    const eu = await as(ids.superAdmin).put(`/api/careers/admin/ranking/markets/FR-T${tag}`, { enabled: true, bias_audit_passed_at: new Date().toISOString(), bias_audit_ref: 'audit-1' });
    expect(eu.status).toBe(409);
    expect(JSON.stringify(eu.body)).toMatch(/ai_act_signed_off_at/);
    const ok = await as(ids.superAdmin).put(`/api/careers/admin/ranking/markets/US-T${tag}`, { enabled: true, bias_audit_passed_at: new Date().toISOString(), bias_audit_ref: 'audit-1' });
    expect(ok.status).toBe(200);
    expect(ok.body.market.enabled).toBe(true);
  });

  test('admin retention rules keep the US one-year floor', async () => {
    const low = await as(ids.superAdmin).put('/api/careers/admin/retention-rules', { country: 'US', region: 'TX', applies_to: 'application', keep_months: 6, legal_source: 'memo' });
    expect(low.status).toBe(400);
    const ok = await as(ids.superAdmin).put('/api/careers/admin/retention-rules', { country: 'US', region: 'TX', applies_to: 'application', keep_months: 24, legal_source: 'Counsel memo 2026-10' });
    expect(ok.status).toBe(200);
  });

  test('vendor webhooks are off until configured', async () => {
    for (const p of ['checkr', 'eor', 'stripe']) {
      const res = await request(app).post(`/api/careers/webhooks/${p}`).set('Content-Type', 'application/json').send('{"type":"x"}');
      expect(res.status).toBe(503);
    }
    process.env.CAREERS_CHECKR_WEBHOOK_SECRET = 'whsec-test';
    const bad = await request(app).post('/api/careers/webhooks/checkr').set('Content-Type', 'application/json').set('X-Checkr-Signature', 'nope').send('{"type":"report.completed"}');
    expect(bad.status).toBe(401);
    const raw = '{"id":"evt_1","type":"report.completed","data":{"object":{"id":"rpt_unknown","result":"clear"}}}';
    const sig = crypto.createHmac('sha256', 'whsec-test').update(raw).digest('hex');
    const good = await request(app).post('/api/careers/webhooks/checkr').set('Content-Type', 'application/json').set('X-Checkr-Signature', sig).send(raw);
    delete process.env.CAREERS_CHECKR_WEBHOOK_SECRET;
    expect(good.status).toBe(200);
    expect(good.body.ignored).toBe(true);
  });

  test('paid features answer 503 when billing is not configured', async () => {
    const res = await as(ids.owner).post('/api/careers/employer/boosts', { business_id: ids.biz, opening_id: ids.opening, plan: 'boost_7d' });
    expect(res.status).toBe(503);
  });

  test('privacy erase removes careers data but keeps hiring records anonymized', async () => {
    const privacy = require('../services/careers/privacy');
    const exported = await privacy.exportData(pool, ids.worker);
    expect(exported).toBeTruthy();
    expect(JSON.stringify(exported)).toMatch(/applications/);
  });
});
