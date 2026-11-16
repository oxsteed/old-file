'use strict';

/**
 * Customer-first signup (WP-001..WP-003; AC-002, AC-003, AC-005, AC-007)
 * against a real migrated database, through the real controller.
 * Skips unless ACCESS_TEST_DATABASE_URL is a loopback disposable database.
 */

jest.unmock('pg');
jest.unmock('../utils/transaction');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const RAW_URL = process.env.ACCESS_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/(credit_statement_test|pa_t\d+)$/.test(url.pathname);
  } catch { return false; }
}
const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;
if (CAN_RUN_DB) process.env.DATABASE_URL = RAW_URL;

jest.setTimeout(60000);

function fakeRes() {
  const res = { statusCode: 200, body: null, headers: {}, cookies: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.setHeader = res.set;
  res.cookie = (k, v) => { res.cookies[k] = v; return res; };
  res.clearCookie = () => res;
  res.getHeader = (k) => res.headers[k];
  return res;
}
const fakeReq = (body) => ({ body, headers: { 'user-agent': 'jest' }, ip: '127.0.0.1', socket: {}, get: () => undefined, cookies: {} });

ddescribe('customer-first signup (real database)', () => {
  let pool;
  let ctrl;
  let hmac;

  beforeAll(() => {
    pool = require('../db');
    jest.spyOn(require('../services/platformSettingsCache'), 'areNewUserRegistrationsEnabled').mockResolvedValue(true);
    ctrl = require('../controllers/authController');
    const secret = process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET;
    hmac = (otp) => crypto.createHmac('sha256', secret).update(String(otp)).digest('hex');
  });
  afterAll(async () => { delete process.env.ACCESS_CUSTOMER_FIRST_SIGNUP; if (pool) await pool.end(); });

  async function signup(extra, { flag = true } = {}) {
    process.env.ACCESS_CUSTOMER_FIRST_SIGNUP = flag ? 'true' : 'false';
    const email = `pa-signup-${crypto.randomUUID()}@example.invalid`;
    const start = fakeRes();
    await ctrl.startRegistration(fakeReq({
      email, password: 'Str0ng!Passw0rd', firstName: 'Ada', lastName: 'Fixture', phone: '6145550100',
      zip: '43215', addressLine1: '1 Main St', city: 'Columbus', state: 'OH', country: 'US', ageConfirmed: true, ...extra,
    }), start);
    expect(start.statusCode).toBe(200);
    const token = start.body.token;
    await pool.query(
      `UPDATE pending_registrations SET terms_accepted_at = NOW(), terms_version = 'test', otp_code = $2,
              otp_expires_at = NOW() + interval '10 minutes' WHERE token = $1`,
      [token, hmac('123456')],
    );
    return { email, token };
  }
  const verify = async (token) => { const r = fakeRes(); await ctrl.verifyRegistrationOTP(fakeReq({ token, otp: '123456' }), r); return r; };

  function journeyApp() {
    const app = express();
    const accessRoutes = require('../routes/progressiveAccess');
    app.use(express.json());
    app.use('/api/auth', require('../routes/auth'));
    app.use('/api/me', accessRoutes.meRouter);
    app.use('/api/admin/access-requests', accessRoutes.adminRouter);
    app.use('/api/helper-registration', require('../routes/helperRegistration'));
    app.use('/api/bids', require('../routes/bids'));
    app.use('/api/jobs', require('../routes/jobs'));
    app.use('/api/businesses', require('../routes/businesses'));
    app.use(require('../middleware/errorHandler').errorHandler);
    return app;
  }

  const bearer = (call, token) => call.set('Authorization', `Bearer ${token}`);

  async function journeySignup(app, intent) {
    const { token } = await signup({ signupIntent: intent });
    const verified = await request(app).post('/api/auth/register/verify-otp').send({ token, otp: '123456' });
    expect(verified.status).toBe(201);
    expect(verified.body.user).toMatchObject({ role: 'customer', default_mode: 'customer' });
    return verified.body;
  }

  async function approve(app, id, version) {
    const reviewer = { id: crypto.randomUUID(), role: 'super_admin' };
    await pool.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, totp_enabled)
       VALUES ($1, $2, 'x', 'Reviewer', 'Fixture', 'super_admin', TRUE, TRUE, TRUE)`,
      [reviewer.id, `pa-reviewer-${reviewer.id}@example.invalid`],
    );
    const { accessToken } = require('../middleware/auth').generateTokens(reviewer);
    const approval = await bearer(request(app).post(`/api/admin/access-requests/${id}/decision`), accessToken)
      .send({ decision: 'approve', expectedVersion: version });
    expect(approval.status).toBe(200);
    expect(approval.body.request.status).toBe('approved');
    return { grantId: approval.body.grantId, accessToken };
  }

  test('Helper signup, review, onboarding, and first bid keep the customer session (AC-025)', async () => {
    const app = journeyApp();
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
    try {
      const customer = await journeySignup(app, 'find_help');
      const helper = await journeySignup(app, 'offer_services');
      const id = helper.access.nextStep.requestId;
      const submit = await bearer(request(app).post(`/api/me/access-requests/${id}/submit`), helper.accessToken)
        .send({ expectedVersion: 1, answers: { serviceCategories: ['plumbing'], serviceArea: { country: 'US', city: 'Columbus' } } });
      expect(submit.status).toBe(200);

      const jobBody = {
        title: 'Repair a leaking kitchen faucet fixture',
        description: 'The faucet needs a replacement gasket. Please check the fixture and repair it during the day.',
        location_city: 'Columbus',
        location_country: 'US',
      };
      const foreignJob = await bearer(request(app).post('/api/jobs'), customer.accessToken).send(jobBody);
      expect(foreignJob.status).toBe(201);
      const foreignJobId = foreignJob.body.job?.id ?? foreignJob.body.id;
      const bid = () => bearer(request(app).post('/api/bids'), helper.accessToken)
        .send({ job_id: foreignJobId, amount: 80, message: 'I can replace the gasket.' });
      expect((await bid()).body).toMatchObject({ code: 'access_required', capability: 'helper.offer_services' });

      const review = await approve(app, id, submit.body.request.version);
      const profile = await bearer(request(app).put('/api/helper-registration/onboarding/profile'), helper.accessToken)
        .send({ phone: '6145550100', city: 'Columbus', state: 'OH', zip_code: '43215' });
      expect(profile.status).toBe(200);
      // External identity provider result for this disposable fixture.
      await pool.query("UPDATE users SET id_verified = TRUE, didit_status = 'verified' WHERE id = $1", [helper.user.id]);
      const finalized = await bearer(request(app).post('/api/helper-registration/finalize'), helper.accessToken);
      expect(finalized.status).toBe(200);
      const status = await bearer(request(app).get('/api/helper-registration/onboarding/status'), helper.accessToken);
      expect(status.body).toMatchObject({ onboarding_step: 'active', canApplyToJobs: true });

      const [firstBid, ownJob] = await Promise.all([
        bid(),
        bearer(request(app).post('/api/jobs'), helper.accessToken).send(jobBody),
      ]);
      expect(firstBid.status).toBe(201);
      expect(firstBid.body.helper_id).toBe(helper.user.id);
      expect(ownJob.status).toBe(201);
      const ownJobId = ownJob.body.job?.id ?? ownJob.body.id;
      const selfBid = await bearer(request(app).post('/api/bids'), helper.accessToken)
        .send({ job_id: ownJobId, amount: 80 });
      expect(selfBid.body.code).toBe('self_bid_not_allowed');
      const revoke = await bearer(request(app).post(`/api/admin/access-requests/grants/${review.grantId}`), review.accessToken)
        .send({ action: 'revoke', expectedVersion: 1, reasonCode: 'policy_not_met' });
      expect(revoke.status).toBe(200);
      expect((await bid()).body.code).toBe('access_required');
      expect((await pool.query('SELECT role, default_mode FROM users WHERE id = $1', [helper.user.id])).rows[0])
        .toEqual({ role: 'customer', default_mode: 'customer' });
    } finally {
      delete process.env.ACCESS_REQUESTS_ENABLED;
      delete process.env.ACCESS_HELPER_ENFORCEMENT;
    }
  });

  test('an approved Owner signup proposal publishes only one matching owned draft (AC-029)', async () => {
    const app = journeyApp();
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    process.env.ACCESS_BUSINESS_ENFORCEMENT = 'enforce';
    try {
      const owner = await journeySignup(app, 'run_business');
      const id = owner.access.nextStep.requestId;
      const businessName = 'Progressive Fixture Auto Repair';
      const makeDraft = (city) => bearer(request(app).post('/api/businesses'), owner.accessToken)
        .send({
          business_name: businessName, business_type: 'Auto Repair', industry_category: 'auto',
          business_mode: 'services_marketplace', address_city: city, address_state: 'OH',
          address_country: 'US', description: 'Auto repair services for the local community.',
        });
      const publish = (id) => bearer(request(app).post(`/api/businesses/${id}/onboarding/complete`), owner.accessToken);
      const drafts = await Promise.all([makeDraft('Columbus'), makeDraft('Cleveland'), makeDraft('Columbus')]);
      for (const draft of drafts) {
        expect(draft.status).toBe(201);
        expect(draft.body.business.is_listed).toBe(false);
      }
      const [target, wrongCity, duplicate] = drafts.map((draft) => draft.body.business.id);
      expect((await publish(target)).body.code).toBe('access_required');
      const submit = await bearer(request(app).post(`/api/me/access-requests/${id}/submit`), owner.accessToken)
        .send({ expectedVersion: 1, answers: { businessName, businessType: 'llc', serviceArea: { country: 'US', region: 'OH', city: 'Columbus' } } });
      expect(submit.status).toBe(200);
      const review = await approve(app, id, submit.body.request.version);
      expect((await publish(wrongCity)).body.code).toBe('access_required');
      expect((await publish(target)).body.code).toBe('business_setup_incomplete');
      expect((await pool.query('SELECT subject_type FROM access_grants WHERE id = $1', [review.grantId])).rows[0].subject_type)
        .toBe('business_proposal');
      await pool.query('INSERT INTO business_services (business_id, name) VALUES ($1, $3), ($2, $3)', [target, duplicate, 'Brake inspection']);
      const [first, second] = await Promise.all([publish(target), publish(duplicate)]);
      expect([first.status, second.status].sort()).toEqual([200, 403]);
      expect((first.status === 200 ? first : second).body.business.is_listed).toBe(true);
      const [published, denied] = first.status === 200 ? [target, duplicate] : [duplicate, target];
      expect((await publish(denied)).body.code).toBe('access_required');
      expect((await publish(published)).status).toBe(200);
      expect((await pool.query('SELECT subject_type, subject_id, source_request_id, version FROM access_grants WHERE id = $1', [review.grantId])).rows[0])
        .toEqual({ subject_type: 'business', subject_id: String(published), source_request_id: String(id), version: 2 });
      expect((await bearer(request(app).post(`/api/admin/access-requests/grants/${review.grantId}`), review.accessToken)
        .send({ action: 'revoke', expectedVersion: 2, reasonCode: 'policy_not_met' })).status).toBe(200);
      expect((await publish(published)).body.code).toBe('access_required');
      expect((await pool.query('SELECT role, default_mode FROM users WHERE id = $1', [owner.user.id])).rows[0])
        .toEqual({ role: 'customer', default_mode: 'customer' });
    } finally {
      delete process.env.ACCESS_REQUESTS_ENABLED;
      delete process.env.ACCESS_BUSINESS_ENFORCEMENT;
    }
  });

  test('restaurant signup approval binds at Business Workspace publication (WP-060)', async () => {
    const app = journeyApp();
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    process.env.ACCESS_BUSINESS_ENFORCEMENT = 'enforce';
    try {
      const owner = await journeySignup(app, 'run_restaurant');
      const id = owner.access.nextStep.requestId;
      const name = 'Progressive Fixture Bistro';
      const draft = await bearer(request(app).post('/api/businesses'), owner.accessToken)
        .send({
          business_name: name, business_type: 'Restaurant', industry_category: 'food', business_mode: 'food',
          address_city: 'Columbus', address_state: 'OH', address_country: 'US',
        });
      expect(draft.status).toBe(201);
      const businessId = draft.body.business.id;
      const { rows: [restaurant] } = await pool.query('SELECT id, status FROM food_restaurants WHERE business_id = $1', [businessId]);
      expect(restaurant.status).toBe('draft');
      const publish = () => bearer(request(app).post(`/api/businesses/${businessId}/onboarding/complete`), owner.accessToken);
      expect((await publish()).body.code).toBe('access_required');
      const submit = await bearer(request(app).post(`/api/me/access-requests/${id}/submit`), owner.accessToken)
        .send({ expectedVersion: 1, answers: { restaurantName: name, serviceArea: { country: 'US', city: 'Columbus' } } });
      expect(submit.status).toBe(200);
      const { grantId } = await approve(app, id, submit.body.request.version);
      expect((await publish()).body.code).toBe('business_setup_incomplete');
      await pool.query('INSERT INTO food_menu_items (restaurant_id, name, price_cents) VALUES ($1, $2, 1200)', [restaurant.id, 'Soup']);
      expect((await publish()).status).toBe(200);
      expect((await pool.query('SELECT status FROM food_restaurants WHERE id = $1', [restaurant.id])).rows[0].status).toBe('active');
      expect((await pool.query('SELECT subject_type, subject_id FROM access_grants WHERE id = $1', [grantId])).rows[0])
        .toEqual({ subject_type: 'business', subject_id: String(businessId) });
    } finally {
      delete process.env.ACCESS_REQUESTS_ENABLED;
      delete process.env.ACCESS_BUSINESS_ENFORCEMENT;
    }
  });

  test.each([
    ['helper intent via legacy defaultMode', { defaultMode: 'helper' }, 'offer_services', 'helper.offer_services'],
    ['business intent via signupIntent', { signupIntent: 'run_business' }, 'run_business', 'business.own'],
    ['customer intent', { signupIntent: 'find_help' }, 'find_help', null],
  ])('%s creates a customer and keeps the intent (AC-002, AC-007)', async (_n, extra, intent, capability) => {
    const { token } = await signup({ ...extra, returnTo: '/jobs/42?x=1' });
    const res = await verify(token);
    expect(res.statusCode).toBe(201);
    const userId = res.body.user.id;
    const { rows: [u] } = await pool.query('SELECT role::text, default_mode FROM users WHERE id = $1', [userId]);
    expect(u).toEqual({ role: 'customer', default_mode: 'customer' });
    expect((await pool.query('SELECT 1 FROM helper_profiles WHERE user_id = $1', [userId])).rows).toHaveLength(0);
    expect(res.body.access.signupIntent).toBe(intent);
    const { rows: [si] } = await pool.query('SELECT intent, capability, return_to, request_id FROM access_signup_intents WHERE user_id = $1', [userId]);
    expect(si).toMatchObject({ intent, capability, return_to: capability ? '/jobs/42' : '/jobs/42' });
    if (capability) {
      expect(res.body.access.nextStep).toMatchObject({ type: 'application', capability, resumable: true });
      const { rows: reqs } = await pool.query('SELECT status, source, capability FROM access_requests WHERE applicant_id = $1', [userId]);
      expect(reqs).toEqual([{ status: 'draft', source: 'signup', capability }]);
      expect(String(si.request_id)).toBe(res.body.access.nextStep.requestId);
    } else {
      expect(res.body.access.nextStep.type).toBe('none');
    }
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM access_grants WHERE user_id = $1', [userId])).rows[0].n).toBe(0);
  });

  test('a forged privileged mode is rejected at start (AC-007)', async () => {
    process.env.ACCESS_CUSTOMER_FIRST_SIGNUP = 'true';
    const r = fakeRes();
    await ctrl.startRegistration(fakeReq({ email: `pa-forge-${crypto.randomUUID()}@example.invalid`, defaultMode: 'admin' }), r);
    expect(r.statusCode).toBe(400);
  });

  test('two near-simultaneous OTP finalizations create exactly one account and at most one draft (WP-003)', async () => {
    const { email, token } = await signup({ defaultMode: 'helper' });
    const [a, b] = await Promise.all([verify(token), verify(token)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes[0]).toBe(201);
    expect([404, 409]).toContain(codes[1]);
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    expect(rows).toHaveLength(1);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM access_requests WHERE applicant_id = $1', [rows[0].id])).rows[0].n).toBe(1);
  });

  test('application storage failure still yields a usable customer account and a resumable intent (AC-003)', async () => {
    const access = require('../services/access/accessService');
    const spy = jest.spyOn(access, 'createRequest').mockRejectedValueOnce(new Error('db hiccup'));
    const { token } = await signup({ signupIntent: 'run_business' });
    const res = await verify(token);
    spy.mockRestore();
    expect(res.statusCode).toBe(201);
    expect(res.body.access.nextStep).toMatchObject({ type: 'application', capability: 'business.own', requestId: null, resumable: true });
    const userId = res.body.user.id;
    const { rows: [si] } = await pool.query('SELECT capability, request_id FROM access_signup_intents WHERE user_id = $1', [userId]);
    expect(si).toEqual({ capability: 'business.own', request_id: null });
    expect(res.body.accessToken).toBeTruthy();
  });

  test('flag off keeps legacy behavior exactly (compatibility window)', async () => {
    const { token } = await signup({ defaultMode: 'helper' }, { flag: false });
    const res = await verify(token);
    expect(res.statusCode).toBe(201);
    expect(res.body.access).toBeUndefined();
    const { rows: [u] } = await pool.query('SELECT role::text, default_mode FROM users WHERE id = $1', [res.body.user.id]);
    expect(u).toEqual({ role: 'helper', default_mode: 'helper' });
  });

  test('OTP resend: the prior code stops working, the current one finalizes and keeps the intent (AC-005)', async () => {
    const { sendOTPEmail } = require('../utils/email');
    sendOTPEmail.mockClear();
    const { token } = await signup({ defaultMode: 'helper' });
    const resend = fakeRes();
    await ctrl.resendRegistrationOTP(fakeReq({ token }), resend);
    expect(resend.statusCode).toBe(200);
    const freshCode = sendOTPEmail.mock.calls.at(-1)[1];
    expect(freshCode).toMatch(/^\d{6}$/);
    const old = fakeRes();
    await ctrl.verifyRegistrationOTP(fakeReq({ token, otp: freshCode === '123456' ? '654321' : '123456' }), old);
    expect(old.statusCode).toBeGreaterThanOrEqual(400);
    const ok = fakeRes();
    await ctrl.verifyRegistrationOTP(fakeReq({ token, otp: freshCode }), ok);
    expect(ok.statusCode).toBe(201);
    expect(ok.body.access).toMatchObject({ signupIntent: 'offer_services', nextStep: { type: 'application', capability: 'helper.offer_services' } });
    const { rows } = await pool.query('SELECT role::text FROM users WHERE id = $1', [ok.body.user.id]);
    expect(rows[0].role).toBe('customer');
  });

  test('helper referral attribution survives customer-first signup and resumes once without granting access (WP-097, AC-067)', async () => {
    const referrer = await signup({ signupIntent: 'find_help' });
    const referrerResult = await verify(referrer.token);
    expect(referrerResult.statusCode).toBe(201);
    const { rows: [referrerRow] } = await pool.query(
      'SELECT id, referral_code FROM users WHERE email = $1', [referrer.email]
    );

    const referred = await signup({
      defaultMode: 'helper',
      ref: referrerRow.referral_code,
      approval: 'approved',
      returnTo: '/settings/applications?request=helper',
    });
    const referredResult = await verify(referred.token);
    expect(referredResult.statusCode).toBe(201);
    const referredId = referredResult.body.user.id;

    const { rows: [attribution] } = await pool.query(
      `SELECT referred_by, referrals_count FROM users
       WHERE id = $1`, [referredId]
    );
    expect(String(attribution.referred_by)).toBe(String(referrerRow.id));
    const { rows: [referrerAfter] } = await pool.query(
      'SELECT referrals_count FROM users WHERE id = $1', [referrerRow.id]
    );
    expect(Number(referrerAfter.referrals_count)).toBe(1);

    const resume = await require('../services/access/signupIntent').pendingIntent(referredId);
    expect(resume).toMatchObject({ intent: 'offer_services', capability: 'helper.offer_services' });
    const { rows: requests } = await pool.query(
      `SELECT status, source, capability FROM access_requests
       WHERE applicant_id = $1 ORDER BY created_at`, [referredId]
    );
    expect(requests).toEqual([{ status: 'draft', source: 'signup', capability: 'helper.offer_services' }]);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM access_grants WHERE user_id = $1', [referredId])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM affiliate_programs WHERE helper_id = $1', [referredId])).rows[0].n).toBe(0);

    // A second-device/application restart reads the same resumable intent and
    // request; it must not mint a second request or a grant.
    const resumedAgain = await require('../services/access/signupIntent').pendingIntent(referredId);
    expect(resumedAgain).toEqual(resume);
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM access_requests WHERE applicant_id = $1', [referredId])).rows[0].n).toBe(1);
  });
});
