'use strict';

/**
 * Customer-first signup (WP-001..WP-003; AC-002, AC-003, AC-005, AC-007)
 * against a real migrated database, through the real controller.
 * Skips unless ACCESS_TEST_DATABASE_URL is a loopback disposable database.
 */

jest.unmock('pg');

const crypto = require('crypto');

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
});
