'use strict';

/**
 * PR #804 Track B (G-31): a signup started on one device can be resumed on
 * another. The pre-OTP draft is persisted server-side against the pending
 * registration; resume needs the emailed OTP code, never returns the
 * password, and does not consume the code. Skips unless
 * STATEMENT_TEST_DATABASE_URL is the disposable Track B database.
 */

jest.unmock('pg');
jest.unmock('../utils/transaction');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';
function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test_pr804_b$/.test(url.pathname);
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

ddescribe('resume pre-OTP registration on a second device (real database)', () => {
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

  async function signup(extra = {}) {
    process.env.ACCESS_CUSTOMER_FIRST_SIGNUP = 'true';
    const email = `pa-resume-${crypto.randomUUID()}@example.invalid`;
    const start = fakeRes();
    await ctrl.startRegistration(fakeReq({
      email, password: 'Str0ng!Passw0rd', firstName: 'Ada', lastName: 'Fixture', phone: '6145550100',
      zip: '43215', addressLine1: '1 Main St', city: 'Columbus', state: 'OH', country: 'US', ageConfirmed: true,
      signupIntent: 'join_workforce', ...extra,
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

  const resume = async (email, otp) => {
    const res = fakeRes();
    await ctrl.resumeRegistration(fakeReq({ email, otp }), res);
    return res;
  };

  test('correct code returns the token and the typed draft, never the password', async () => {
    const { email, token } = await signup();
    const res = await resume(email, '123456');
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBe(token);
    expect(res.body.otpSent).toBe(true);
    expect(res.body.draft).toMatchObject({
      firstName: 'Ada', lastName: 'Fixture', phone: '+16145550100',
      city: 'Columbus', state: 'OH', zipCode: '43215', signupIntent: 'join_workforce',
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/password_hash|otp_code|Str0ng/);
  });

  test('the resumed code still verifies: resume does not consume the OTP', async () => {
    const { email, token } = await signup();
    const resumed = await resume(email, '123456');
    expect(resumed.statusCode).toBe(200);
    const verified = fakeRes();
    await ctrl.verifyRegistrationOTP(fakeReq({ token, otp: '123456' }), verified);
    expect(verified.statusCode).toBe(201);
    expect(verified.body.user.email).toBe(email);
  });

  test('wrong codes fail with the shared attempt counter and lock out at three', async () => {
    const { email } = await signup();
    const first = await resume(email, '000000');
    expect(first.statusCode).toBe(400);
    expect(first.body.code).toBe('otp_invalid');
    expect(first.body.attemptsRemaining).toBe(2);

    const second = await resume(email, '111111');
    expect(second.statusCode).toBe(400);
    expect(second.body.attemptsRemaining).toBe(1);

    const third = await resume(email, '222222');
    expect(third.statusCode).toBe(429);
    expect(third.body.code).toBe('otp_locked');

    // A correct code no longer helps while locked.
    const locked = await resume(email, '123456');
    expect(locked.statusCode).toBe(429);
    expect(locked.body.code).toBe('otp_locked');
  });

  test('an unknown email answers with the same generic code as a wrong code', async () => {
    const res = await resume(`nobody-${crypto.randomUUID()}@example.invalid`, '123456');
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('otp_invalid');
    expect(res.body.token).toBeUndefined();
  });

  test('an expired code answers otp_expired', async () => {
    const { email, token } = await signup();
    await pool.query(
      `UPDATE pending_registrations SET otp_expires_at = NOW() - interval '1 minute' WHERE token = $1`,
      [token],
    );
    const res = await resume(email, '123456');
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('otp_expired');
  });
});
