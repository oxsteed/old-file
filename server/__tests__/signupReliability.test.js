'use strict';
const { mockQuery, resetMocks } = require('./setup');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const controller = require('../controllers/authController');
const { isSignupPasswordValid } = require('../utils/signupValidation');
const { sendOTPEmail } = require('../utils/email');
const hash = jest.spyOn(bcrypt, 'hash');
const future = ms => new Date(Date.now() + ms).toISOString();
const valid = { email: 'synthetic@example.test', password: 'Synthetic1', firstName: 'Test', lastName: 'Person',
  phone: '+1 (937) 555-0100', country: 'US', addressLine1: '123 Test Street', city: 'Springfield',
  state: 'oh', zip: '45502', ageConfirmed: true, defaultMode: 'customer' };
function response() { const res = { statusCode: 200, cookie: jest.fn() }; res.status = jest.fn(code => { res.statusCode = code; return res; }); res.json = jest.fn(body => { res.body = body; return res; }); return res; }
async function call(method, body) { const res = response(); await controller[method]({ body, headers: {}, ip: '127.0.0.1' }, res); return res; }
function pending(extra = {}) { return { id: 1, email: valid.email, expires_at: future(1800000), otp_expires_at: future(900000), otp_attempts: 0,
  otp_code: crypto.createHash('sha256').update('123456').digest('hex'), ...extra }; }
beforeEach(() => { resetMocks(); hash.mockResolvedValue('synthetic-hash'); sendOTPEmail.mockClear(); });

describe('new registration validation', () => {
  test.each([undefined, false, 'true', 1, null])('age must be the actual boolean true: %p', async ageConfirmed => {
    const res = await call('startRegistration', { ...valid, ageConfirmed });
    expect(res.statusCode).toBe(400); expect(res.body.fields.ageConfirmed).toBeTruthy(); expect(mockQuery).not.toHaveBeenCalled();
  });
  test.each([
    ['abcdefgh', false], ['Abcdefgh', false], ['abcdefg1', false], ['abcdefg!', false],
    ['Abcdefg1', true], ['Abcdefg!', true], ['abcdef1!', true], ['Abcdef1!', true],
    ['A1aaaaa', false], ['A1aaaaaa', true], ['A1' + 'a'.repeat(126), true], ['A1' + 'a'.repeat(127), false],
  ])('password policy %s -> %s at helper and direct API', async (password, allowed) => {
    expect(isSignupPasswordValid(password)).toBe(allowed);
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1, expires_at: future(1800000) }] });
    const res = await call('startRegistration', { ...valid, password });
    expect(res.statusCode).toBe(allowed ? 200 : 400);
    if (allowed) expect(hash).toHaveBeenCalledWith(password, expect.any(Number));
    else expect(mockQuery).not.toHaveBeenCalled();
  });
  test.each(['customer', 'helper', 'business_owner'])('preserves launch mode, referral and explicit consent: %s', async defaultMode => {
    const expires = future(1800000);
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1, expires_at: expires }] });
    const res = await call('startRegistration', { ...valid, defaultMode, ref: 'REFTEST', password: ' A1aaaaa ' });
    expect(res.body.registrationExpiresAt).toBe(expires);
    expect(hash).toHaveBeenCalledWith(' A1aaaaa ', expect.any(Number));
    const args = mockQuery.mock.calls[1][1]; expect(args[11]).toBe(true); expect(args[13]).toBe('REFTEST'); expect(args[14]).toBe(defaultMode);
    expect(mockQuery.mock.calls[1][0]).toMatch(/expires_at = NOW\(\) \+ interval '30 minutes'/);
    expect(mockQuery.mock.calls[1][0]).not.toMatch(/otp_locked_until\s*=/);
  });
  test.each([
    ['FR', 'Île-de-France', '75001', '+33123456789', 'Île-de-France'],
    ['GB', 'England', 'SW1A 1AA', '+442071234567', 'England'],
    ['CA', 'on', 'K1A 0B1', '+16135550100', 'ON'],
    ['HT', '', '', '+50937000000', null], ['HK', '', '', '+85255550100', null],
  ])('country-aware region/postal handling %s', async (country, state, zip, phone, storedRegion) => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await call('startRegistration', { ...valid, country, state, zip, phone });
    expect(res.statusCode).toBe(200); expect(mockQuery.mock.calls[1][1][9]).toBe(storedRegion);
  });
  test.each(['1234567', '+123456789012', '937abc5550100', '++19375550100'])('rejects invalid US phone %s as a field error', async phone => {
    const res = await call('startRegistration', { ...valid, phone }); expect(res.statusCode).toBe(400); expect(res.body.fields.phone).toBeTruthy();
  });
  test('duplicate email retains 409 and recovery-safe error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }] }); const res = await call('startRegistration', valid);
    expect(res.statusCode).toBe(409); expect(res.body.error).toMatch(/already registered/);
  });
});
describe('verification metadata and recovery', () => {
  test.each([['FR','Île-de-France'],['GB','England'],['US','oh']])('verified account preserves correct region casing %s', async (country,state) => {
    mockQuery.mockImplementation(async sql => {
      if (sql.startsWith('SELECT * FROM pending_registrations')) return {rows:[pending({...valid,country,state,first_name:'Test',last_name:'Person',age_confirmed:true})]};
      if (sql.includes('INSERT INTO users')) return {rows:[{id:1,email:valid.email,role:'customer',country,email_verified:true}]};
      return {rows:[]};
    });
    const res = await call('verifyRegistrationOTP', { token:'synthetic',otp:'123456' });
    expect(res.statusCode).toBe(201);
    const insertion = mockQuery.mock.calls.find(([sql])=>sql.includes('INSERT INTO users'));
    expect(insertion[1][7]).toBe(country==='US'?'OH':state);
  });
  test.each(['acceptTerms', 'verifyRegistrationOTP', 'resendRegistrationOTP'])('%s distinguishes expired registration', async method => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); const res = await call(method, { token: 'synthetic', otp: '123456' });
    expect(res.statusCode).toBe(404); expect(res.body.code).toBe('registration_expired');
  });
  test.each(['acceptTerms', 'resendRegistrationOTP'])('%s supplies authoritative cooldown timestamps', async method => {
    mockQuery.mockResolvedValueOnce({ rows: [pending()] }).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const before = Date.now(); const res = await call(method, { token: 'synthetic' });
    expect(res.statusCode).toBe(200); expect(Date.parse(res.body.resendAvailableAt)).toBeGreaterThanOrEqual(before + 60000);
    expect(Date.parse(res.body.otpExpiresAt)).toBeGreaterThan(before + 800000); expect(res.body.registrationExpiresAt).toBeTruthy();
    expect(sendOTPEmail).toHaveBeenCalledTimes(1);
  });
  test.each(['acceptTerms', 'resendRegistrationOTP'])('%s cannot bypass resend cooldown', async method => {
    mockQuery.mockResolvedValueOnce({ rows: [pending({ otp_last_sent_at: future(-1000) })] });
    const res = await call(method, { token: 'synthetic' }); expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('resend_cooldown'); expect(res.body.retryAfterMs).toBeGreaterThan(58000); expect(res.body.resendAvailableAt).toBeTruthy();
    expect(mockQuery).toHaveBeenCalledTimes(1); expect(sendOTPEmail).not.toHaveBeenCalled();
  });
  test.each(['acceptTerms', 'resendRegistrationOTP', 'verifyRegistrationOTP'])('%s preserves active lockouts', async method => {
    const lock = future(3600000); mockQuery.mockResolvedValueOnce({ rows: [pending({ otp_locked_until: lock })] });
    const res = await call(method, { token: 'synthetic', otp: '123456' }); expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe('otp_locked'); expect(res.body.lockoutUntil).toBe(lock); expect(res.body.retryAfterMs).toBeGreaterThan(3500000);
    expect(mockQuery).toHaveBeenCalledTimes(1); expect(sendOTPEmail).not.toHaveBeenCalled();
  });
  test.each([['000000', 900000, 'otp_invalid'], ['123456', -1, 'otp_expired']])('distinguishes wrong versus expired OTP %s', async (otp, expiry, code) => {
    mockQuery.mockResolvedValueOnce({ rows: [pending({ otp_expires_at: future(expiry) })] }).mockResolvedValueOnce({ rows: [{ id: 1 }] });
    const res = await call('verifyRegistrationOTP', { token: 'synthetic', otp }); expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe(code); expect(res.body.attemptsRemaining).toBe(2);
  });
  test('third incorrect attempt returns the new lockout deadline', async () => {
    const lock = future(3600000); mockQuery.mockResolvedValueOnce({ rows: [pending({ otp_attempts: 2 })] }).mockResolvedValueOnce({ rows: [{ id: 1, otp_locked_until: lock }] });
    const res = await call('verifyRegistrationOTP', { token: 'synthetic', otp: '000000' });
    expect(res.statusCode).toBe(429); expect(res.body.code).toBe('otp_locked'); expect(res.body.lockoutUntil).toBe(lock);
  });
});
