'use strict';

// Review W4 regression tests: P1-111, P2-653, P2-654, P3-912, P3-941, P3-1107.
const { mockQuery, resetMocks } = require('./setup');
const jwt = require('jsonwebtoken');

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

const { verifyAuthenticationResponse } = require('@simplewebauthn/server');
const userPasskeys = require('../controllers/userPasskeyController');
const { createOriginLock } = require('../middleware/originLock');
const { stripPrivilegedIntakeFields } = require('../middleware/publicIntake');
const { normalizeSafeHttpsUrl } = require('../utils/safeExternalUrl');
const superAdmin = require('../controllers/superAdminController');

const USER_ID = '00000000-0000-4000-8000-000000000412';

function res() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), cookie: jest.fn().mockReturnThis() };
}

beforeEach(() => resetMocks());

describe('P1-111 passkey counters', () => {
  function primePasskey(storedCounter) {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, is_active: true, totp_enabled: true, terms_accepted: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 'pk-1', credential_id: 'cred-1', public_key: Buffer.from('k'), counter: storedCounter, transports: [] }] })
      .mockResolvedValueOnce({ rows: [{ challenge: 'c1' }] })
      .mockResolvedValueOnce({ rows: [{ challenge: 'c1' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
  }
  const token = () => jwt.sign({ id: USER_ID, isPasskeyToken: true }, process.env.JWT_SECRET, { algorithm: 'HS256' });

  test('synced passkeys that always report counter 0 can sign in', async () => {
    primePasskey(0);
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 0 } });
    const r = res();
    await userPasskeys.verifyAuthentication({ body: { token: token(), response: { id: 'cred-1' } } }, r, jest.fn());
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json.mock.calls[0][0]).toMatchObject({ requiresTwoFactor: true });
  });

  test('a counter that goes backwards after use is still rejected', async () => {
    primePasskey(5);
    verifyAuthenticationResponse.mockResolvedValueOnce({ verified: true, authenticationInfo: { newCounter: 5 } });
    const r = res();
    await userPasskeys.verifyAuthentication({ body: { token: token(), response: { id: 'cred-1' } } }, r, jest.fn());
    expect(r.status).toHaveBeenCalledWith(401);
  });
});

describe('P3-1107 origin lock', () => {
  const call = (mw, req) => {
    const r = res(); const next = jest.fn();
    mw({ path: '/api/jobs', headers: {}, ...req }, r, next);
    return { r, next };
  };
  test('no secret configured means no lock', () => {
    expect(call(createOriginLock({ secret: '' }), {}).next).toHaveBeenCalled();
  });
  test('requests without the CDN secret are refused', () => {
    const { r, next } = call(createOriginLock({ secret: 's3cret' }), { headers: { 'x-origin-auth': 'nope' } });
    expect(next).not.toHaveBeenCalled();
    expect(r.status).toHaveBeenCalledWith(403);
  });
  test('requests with the CDN secret and health checks pass', () => {
    const mw = createOriginLock({ secret: 's3cret' });
    expect(call(mw, { headers: { 'x-origin-auth': 's3cret' } }).next).toHaveBeenCalled();
    expect(call(mw, { path: '/api/health' }).next).toHaveBeenCalled();
  });
});

describe('P2-653 / P2-654 public intakes', () => {
  test('callers cannot pick the workflow status or stage', () => {
    const req = { body: { status: 'completed', workflow_stage: 'retention', name: 'Ana' } };
    stripPrivilegedIntakeFields(req, {}, jest.fn());
    expect(req.body).toEqual({ name: 'Ana' });
  });

  test.each([
    ['professionalOperations', '/public/:businessId/intakes'],
    ['beautyOperations', '/public/:businessId/intakes'],
    ['continuityOperations', '/public/:businessId/intakes'],
    ['creativeOperations', '/public/:businessId/intakes'],
    ['tradesOperations', '/public/:businessId/requests'],
  ])('%s public intake is rate limited and sanitized', (file, path) => {
    const router = require(`../routes/${file}`);
    const layer = router.stack.find((l) => l.route?.path === path && l.route.methods.post);
    const names = layer.route.stack.map((s) => s.handle);
    const { publicIntakeLimiter } = require('../middleware/rateLimiter');
    expect(names[0]).toBe(publicIntakeLimiter);
    expect(names[names.length - 2]).toBe(stripPrivilegedIntakeFields);
  });
});

describe('P3-912 vault URLs', () => {
  test('only credential-free https URLs are kept', () => {
    expect(normalizeSafeHttpsUrl('https://files.example.com/a.pdf')).toBe('https://files.example.com/a.pdf');
    expect(normalizeSafeHttpsUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSafeHttpsUrl('http://files.example.com/a.pdf')).toBeNull();
    expect(normalizeSafeHttpsUrl('https://u:p@files.example.com/a.pdf')).toBeNull();
    expect(normalizeSafeHttpsUrl('//files.example.com/a.pdf')).toBeNull();
  });
});

describe('P3-941 rail-controlled flags', () => {
  test.each(['updateFeatureFlag', 'rollbackFeatureFlag'])('%s refuses the credit rail flag', async (fn) => {
    const r = res();
    await superAdmin[fn]({ params: { key: 'oxsteed_credit_enabled' }, body: { enabled: true }, user: { id: USER_ID } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(r.json.mock.calls[0][0].code).toBe('flag_rail_controlled');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('P2-482 retired helper completion endpoint', () => {
  test('POST /complete returns 410 without touching the database', () => {
    const router = require('../routes/helperRegistration');
    const layer = router.stack.find((l) => l.route?.path === '/complete' && l.route.methods.post);
    const handler = layer.route.stack[layer.route.stack.length - 1].handle;
    const r = res();
    handler({ body: { email: 'x@example.com' } }, r);
    expect(r.status).toHaveBeenCalledWith(410);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('P2-616 payout methods cannot be self-verified', () => {
  const PayoutController = require('../controllers/PayoutController');
  const call = async (body, rows) => {
    if (rows) mockQuery.mockResolvedValueOnce({ rows });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pm-1' }] });
    const r = res();
    await PayoutController.updatePayoutMethod({ params: { method_id: 'pm-1' }, user: { helper_id: 'h-1' }, body }, r);
    return r;
  };

  test.each(['verified', 'active'])('owner cannot set status %s', async (status) => {
    const r = await call({ status });
    expect(r.status).toHaveBeenCalledWith(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('an unverified method cannot become primary', async () => {
    const r = await call({ is_primary: true }, [{ id: 'pm-1', status: 'pending' }]);
    expect(r.status).toHaveBeenCalledWith(409);
  });

  test('owner can deactivate a method', async () => {
    const r = await call({ status: 'inactive' }, [{ id: 'pm-1', status: 'verified' }]);
    expect(r.status).not.toHaveBeenCalled();
    expect(r.json.mock.calls[0][0]).toMatchObject({ success: true });
  });
});
