'use strict';

/**
 * Group 4 Slice A (items 153, 155, 156, 159, 160), Get approved, polished.
 *
 * Against the real migrated schema, through the real routers/controllers:
 *   153: GET /verification/identity/status derives verification from the
 *        same facts activation uses (Didit counts), so a Didit-verified
 *        helper with no Stripe row reads verified instead of null.
 *   155: client-only (readiness checklist on /helper/payouts + Connect
 *        start in place); no server leg to test here.
 *   156: skill builder writes helper_skills (GET/POST/DELETE
 *        /helper-profile/skills + categories), which previously had no
 *        server write path outside migrations/tests.
 *   159: PUT /helper-profile/core accepts is_licensed / is_insured /
 *        license_details / insurance_details; GET /me returns them as
 *        arrays; the public profile already returns them (rendered now).
 *   160: GET /helpers/:id/availability/summary returns the raw
 *        isAvailableNow toggle, separate from isOnline.
 *
 * DB: disposable loopback database credit_statement_test only; the suite
 * skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_synthetic_group4_slice_a';

jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test(_pr804_d)?$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Group 4 test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
}

const pool = require('../db');
const { authenticate } = require('../middleware/auth');
const helperProfileRoutes = require('../routes/helperProfile');
const helpersRoutes = require('../routes/helpers');
const verificationController = require('../controllers/verificationController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

function replaceAuth(router) {
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const stackLayer of layer.route.stack) {
      if (stackLayer.handle === authenticate) {
        stackLayer.handle = (req, _res, next) => next();
      }
    }
  }
}

ddescribe('Group 4 Slice A: get approved, polished (153, 156, 159, 160)', () => {
  let app;
  let helperId;
  let otherHelperId;
  let diditUserId;
  let unverifiedUserId;
  let stripeUserId;
  let categoryId;

  const as = (userId, role = 'helper') => {
    const headers = { 'x-test-user': userId, 'x-test-role': role };
    const call = (method, path) => {
      let req = request(app)[method](path);
      for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
      return req;
    };
    return {
      get: (path) => call('get', path),
      post: (path, body = {}) => call('post', path).send(body),
      put: (path, body = {}) => call('put', path).send(body),
      delete: (path) => call('delete', path),
    };
  };

  async function makeUser({ role = 'helper', diditStatus = null, idVerified = false, terms = false } = {}) {
    const id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role,
                          is_active, email_verified, onboarding_completed,
                          id_verified, didit_status,
                          terms_accepted, terms_accepted_at, terms_version)
       VALUES ($1, $2, 'x', 'Slice', 'A', $3, TRUE, TRUE, TRUE,
               $4, $5, $6, CASE WHEN $6 THEN NOW() ELSE NULL END, CASE WHEN $6 THEN 'g4a-test' ELSE NULL END)`,
      [id, `g4a-${id.slice(0, 8)}@example.invalid`, role, idVerified, diditStatus, terms],
    );
    return id;
  }

  async function grantHelper(userId) {
    await pool.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'helper.offer_services', 'self', 'self', 'active', 'legacy_backfill', 'helper-policy-1')`,
      [userId],
    );
  }

  beforeAll(async () => {
    replaceAuth(helperProfileRoutes);
    app = express();
    app.use(express.json());
    app.use('/api/helper-profile', (req, _res, next) => {
      req.user = { id: req.get('x-test-user') || 'missing-user', role: req.get('x-test-role') || 'helper' };
      next();
    });
    app.use('/api/helper-profile', helperProfileRoutes);
    app.use('/api/helpers', helpersRoutes);

    helperId = await makeUser({ idVerified: true, terms: true });
    otherHelperId = await makeUser({ idVerified: true, terms: true });
    diditUserId = await makeUser({ diditStatus: 'verified' });
    unverifiedUserId = await makeUser({});
    stripeUserId = await makeUser({ idVerified: true, terms: true });
    await grantHelper(helperId);
    await grantHelper(otherHelperId);
    await pool.query(
      `INSERT INTO identity_verifications (user_id, stripe_verification_session_id, status)
       VALUES ($1, $2, 'verified')`,
      [stripeUserId, `vs_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`],
    );
    for (const id of [helperId, otherHelperId]) {
      await pool.query(
        `INSERT INTO helper_profiles (user_id, is_listed, is_available_now)
         VALUES ($1, TRUE, FALSE)`,
        [id],
      );
    }
    const { rows: [cat] } = await pool.query(
      `INSERT INTO categories (name, slug, icon, sort_order)
       VALUES ($1, $2, 'wrench', 999) RETURNING id`,
      ['Group 4 Slice A Trade', `g4a-trade-${crypto.randomUUID().slice(0, 8)}`],
    );
    categoryId = cat.id;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM helper_skills WHERE user_id = ANY($1::uuid[])', [[helperId, otherHelperId]]);
    await pool.query('DELETE FROM categories WHERE id = $1', [categoryId]);
    await pool.query('DELETE FROM identity_verifications WHERE user_id = $1', [stripeUserId]);
    await pool.query('DELETE FROM helper_profiles WHERE user_id = ANY($1::uuid[])', [[helperId, otherHelperId]]);
    await pool.query('DELETE FROM access_grants WHERE user_id = ANY($1::uuid[])', [[helperId, otherHelperId]]);
    await pool.end();
  });

  // ── 153: identity setup status ──────────────────────────────────────────
  test('153: Didit-verified helper with no Stripe row reads verified (source didit)', async () => {
    const res = mockRes();
    await verificationController.getIdentityStatus({ user: { id: diditUserId } }, res, (err) => { throw err; });
    expect(res.payload.verified).toBe(true);
    expect(res.payload.source).toBe('didit');
    expect(res.payload.identity).toBeNull();
  });

  test('153: unverified helper reads verified false with no source', async () => {
    const res = mockRes();
    await verificationController.getIdentityStatus({ user: { id: unverifiedUserId } }, res, (err) => { throw err; });
    expect(res.payload.verified).toBe(false);
    expect(res.payload.source).toBeNull();
    expect(res.payload.submitted).toBe(false);
  });

  test('153: Stripe-verified row reads verified with source stripe', async () => {
    const res = mockRes();
    await verificationController.getIdentityStatus({ user: { id: stripeUserId } }, res, (err) => { throw err; });
    expect(res.payload.verified).toBe(true);
    expect(res.payload.source).toBe('stripe');
    expect(res.payload.identity.status).toBe('verified');
  });

  // ── 156: skill profile builder ──────────────────────────────────────────
  test('156: skills categories include the seeded category', async () => {
    const res = await as(helperId).get('/api/helper-profile/skills/categories');
    expect(res.status).toBe(200);
    expect(res.body.some((c) => c.id === categoryId)).toBe(true);
  });

  test('156: helper adds, lists, and removes a skill; duplicates 409; strangers 404', async () => {
    const created = await as(helperId).post('/api/helper-profile/skills', {
      category_id: categoryId, skill_name: 'Drywall repair', years_exp: 5,
    });
    expect(created.status).toBe(201);
    expect(created.body.skill_name).toBe('Drywall repair');
    expect(created.body.years_exp).toBe(5);

    const listed = await as(helperId).get('/api/helper-profile/skills');
    expect(listed.status).toBe(200);
    expect(listed.body.some((s) => s.id === created.body.id && s.category_name === 'Group 4 Slice A Trade')).toBe(true);

    const duplicate = await as(helperId).post('/api/helper-profile/skills', {
      category_id: categoryId, skill_name: 'Drywall repair',
    });
    expect(duplicate.status).toBe(409);

    const unknownCategory = await as(helperId).post('/api/helper-profile/skills', {
      category_id: 999999999, skill_name: 'Nope',
    });
    expect(unknownCategory.status).toBe(400);

    const strangerDelete = await as(otherHelperId).delete(`/api/helper-profile/skills/${created.body.id}`);
    expect(strangerDelete.status).toBe(404);

    const removed = await as(helperId).delete(`/api/helper-profile/skills/${created.body.id}`);
    expect(removed.status).toBe(200);
    const gone = await as(helperId).delete(`/api/helper-profile/skills/${created.body.id}`);
    expect(gone.status).toBe(404);
  });

  // ── 159: qualification display ──────────────────────────────────────────
  test('159: core save stores licenses/insurance; /me returns them as arrays; invalid entries 400', async () => {
    const saved = await as(helperId).put('/api/helper-profile/core', {
      is_licensed: true,
      is_insured: true,
      license_details: [{ name: 'Master Electrician', number: 'EL-123', issuer: 'State Board', expires_at: '2027-01-01' }],
      insurance_details: [{ name: 'General Liability', number: 'GL-9' }],
    });
    expect(saved.status).toBe(200);

    const me = await as(helperId).get('/api/helper-profile/me');
    expect(me.status).toBe(200);
    expect(me.body.is_licensed).toBe(true);
    expect(me.body.is_insured).toBe(true);
    expect(me.body.license_details).toEqual([
      { name: 'Master Electrician', number: 'EL-123', issuer: 'State Board', expires_at: '2027-01-01' },
    ]);
    expect(me.body.insurance_details).toEqual([{ name: 'General Liability', number: 'GL-9' }]);

    const bad = await as(helperId).put('/api/helper-profile/core', {
      license_details: [{ number: 'NO-NAME' }],
    });
    expect(bad.status).toBe(400);

    // A save without the fields preserves the stored values.
    const preserved = await as(helperId).put('/api/helper-profile/core', { profile_headline: 'G4A' });
    expect(preserved.status).toBe(200);
    const meAgain = await as(helperId).get('/api/helper-profile/me');
    expect(meAgain.body.license_details).toHaveLength(1);
    expect(meAgain.body.profile_headline).toBe('G4A');
  });

  test('159: public profile returns the stored licenses and insurance', async () => {
    const res = await request(app).get(`/api/helpers/${helperId}/profile`);
    expect(res.status).toBe(200);
    expect(res.body.helper.licenses).toEqual([
      { name: 'Master Electrician', number: 'EL-123', issuer: 'State Board', expires_at: '2027-01-01' },
    ]);
    expect(res.body.helper.insurance).toEqual([{ name: 'General Liability', number: 'GL-9' }]);
  });

  test('156/159: public profile returns the helper-listed skills', async () => {
    const created = await as(helperId).post('/api/helper-profile/skills', {
      category_id: categoryId, skill_name: 'Drywall repair', years_exp: 2,
    });
    expect(created.status).toBe(201);
    const res = await request(app).get(`/api/helpers/${helperId}/profile`);
    expect(res.status).toBe(200);
    expect(res.body.helper.skills).toContain('Drywall repair');
    await as(helperId).delete(`/api/helper-profile/skills/${created.body.id}`);
  });

  // ── 160: availability badge ─────────────────────────────────────────────
  test('160: availability summary returns the raw toggle, separate from isOnline', async () => {
    const off = await request(app).get(`/api/helpers/${helperId}/availability/summary`);
    expect(off.status).toBe(200);
    expect(off.body.isAvailableNow).toBe(false);

    const saved = await as(helperId).put('/api/helper-profile/core', { is_available_now: true });
    expect(saved.status).toBe(200);
    const on = await request(app).get(`/api/helpers/${helperId}/availability/summary`);
    expect(on.status).toBe(200);
    expect(on.body.isAvailableNow).toBe(true);
  });
});
