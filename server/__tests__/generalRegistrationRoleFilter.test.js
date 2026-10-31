'use strict';
// The general registration OTP endpoint must not verify helper-flow rows.
// Helper-flow rows (role 'helper', no default_mode) belong to the helper
// registration flow, which enforces its own consent gate before account
// creation. General-flow helper-mode rows always carry a default_mode, so
// they must keep verifying through this endpoint.
const { mockQuery, resetMocks } = require('./setup');
const settingsCache = require('../services/platformSettingsCache');
jest.spyOn(settingsCache, 'areNewUserRegistrationsEnabled').mockResolvedValue(true);
const crypto = require('crypto');
const controller = require('../controllers/authController');
const future = ms => new Date(Date.now() + ms).toISOString();
const valid = { email: 'synthetic@example.test', password: 'Synthetic1', firstName: 'Test', lastName: 'Person',
  phone: '+1 (937) 555-0100', country: 'US', addressLine1: '123 Test Street', city: 'Springfield',
  state: 'oh', zip: '45502', ageConfirmed: true };
function response() { const res = { statusCode: 200, cookie: jest.fn() }; res.status = jest.fn(code => { res.statusCode = code; return res; }); res.json = jest.fn(body => { res.body = body; return res; }); return res; }
async function call(method, body) { const res = response(); await controller[method]({ body, headers: {}, ip: '127.0.0.1' }, res); return res; }
function pending(extra = {}) { return { id: 1, email: valid.email, expires_at: future(1800000), otp_expires_at: future(900000), otp_attempts: 0,
  otp_code: crypto.createHmac('sha256', process.env.OTP_HMAC_SECRET || process.env.JWT_SECRET).update('123456').digest('hex'),
  first_name: 'Test', last_name: 'Person', phone: valid.phone, zip_code: valid.zip,
  address_line1: valid.addressLine1, city: valid.city, state: 'OH', country: 'US', age_confirmed: true, ...extra }; }
function mockVerifyFlow(row) {
  mockQuery.mockImplementation(async sql => {
    if (sql.startsWith('SELECT * FROM pending_registrations')) return { rows: [row] };
    if (sql.includes('INSERT INTO users')) return { rows: [{ id: 1, email: valid.email, role: 'customer', country: 'US', email_verified: true }] };
    return { rows: [] };
  });
}
beforeEach(() => { resetMocks(); });

describe('general verifyRegistrationOTP role filter', () => {
  test('helper-flow row (role helper, no default_mode) is rejected even with the correct OTP', async () => {
    mockVerifyFlow(pending({ role: 'helper' }));
    const res = await call('verifyRegistrationOTP', { token: 'synthetic', otp: '123456' });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('registration_expired');
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(false);
  });

  test('helper-flow row is rejected before OTP comparison and attempt counting', async () => {
    mockVerifyFlow(pending({ role: 'helper' }));
    const res = await call('verifyRegistrationOTP', { token: 'synthetic', otp: '000000' });
    expect(res.statusCode).toBe(404);
    expect(res.body.code).toBe('registration_expired');
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('otp_attempts'))).toBe(false);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(false);
  });

  test('general helper-mode row (role helper with a default_mode) still verifies', async () => {
    mockVerifyFlow(pending({ role: 'helper', default_mode: 'business_owner' }));
    const res = await call('verifyRegistrationOTP', { token: 'synthetic', otp: '123456' });
    expect(res.statusCode).toBe(201);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(true);
  });

  test('general customer row still verifies', async () => {
    mockVerifyFlow(pending({ role: 'customer', default_mode: 'customer' }));
    const res = await call('verifyRegistrationOTP', { token: 'synthetic', otp: '123456' });
    expect(res.statusCode).toBe(201);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('INSERT INTO users'))).toBe(true);
  });
});
