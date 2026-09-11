'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({ challenge: 'registration-challenge', rp: { id: 'oxsteed.com' } }),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: 'authentication-challenge', rpId: 'oxsteed.com' }),
  verifyAuthenticationResponse: jest.fn(),
}));
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));

const controller = require('../controllers/passkeyController');
const { generateTokens } = require('../middleware/auth');

const ADMIN_ID = '00000000-0000-4000-8000-000000000991';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => resetMocks());

describe('admin passkey controls', () => {
  test('lists only active passkeys for the authenticated admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pk-1', device_name: 'MacBook Touch ID', created_at: '2026-09-11T00:00:00Z', last_used_at: null }] });
    const res = response();

    await controller.listPasskeys({ user: { id: ADMIN_ID } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ passkeys: [{ id: 'pk-1', deviceName: 'MacBook Touch ID', createdAt: '2026-09-11T00:00:00Z', lastUsedAt: null }] });
    expect(mockQuery.mock.calls[0][0]).toContain('revoked_at IS NULL');
  });

  test('creates a TOTP-gated registration challenge without returning credential data', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: ADMIN_ID, email: 'admin@example.com', first_name: 'Admin', last_name: 'User', role: 'super_admin', is_active: true, totp_enabled: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = response();

    await controller.registrationOptions({ user: { id: ADMIN_ID } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ options: expect.objectContaining({ challenge: 'registration-challenge' }) });
    expect(res.json.mock.calls[0][0].options).not.toHaveProperty('secret');
    expect(mockQuery.mock.calls[2][0]).toContain('DELETE FROM admin_passkey_challenges');
    expect(mockQuery.mock.calls[3][0]).toContain('INSERT INTO admin_passkey_challenges');
  });

  test('rejects passkey authentication without a valid password MFA session', async () => {
    const res = response();
    await controller.authenticationOptions({ body: { mfaToken: 'not-a-token' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired MFA session.' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('accepts only an MFA token for passkey login', async () => {
    const { accessToken } = generateTokens({ id: ADMIN_ID, email: 'admin@example.com', role: 'super_admin' });
    const res = response();
    await controller.authenticationOptions({ body: { mfaToken: accessToken } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
