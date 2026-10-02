'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: jest.fn().mockResolvedValue({ challenge: 'registration-challenge', rp: { id: 'oxsteed.com' } }),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn().mockResolvedValue({ challenge: 'authentication-challenge', rpId: 'oxsteed.com' }),
  verifyAuthenticationResponse: jest.fn(),
}));

const controller = require('../controllers/userPasskeyController');

const USER_ID = '00000000-0000-4000-8000-000000000992';

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => resetMocks());

describe('user passkey controls', () => {
  test('lists only active passkeys for the authenticated user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pk-1', device_name: 'iPhone Face ID', created_at: '2026-10-02T00:00:00Z', last_used_at: null }] });
    const res = response();

    await controller.listPasskeys({ user: { id: USER_ID } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ passkeys: [{ id: 'pk-1', deviceName: 'iPhone Face ID', createdAt: '2026-10-02T00:00:00Z', lastUsedAt: null }] });
    expect(mockQuery.mock.calls[0][0]).toContain('FROM user_passkeys');
    expect(mockQuery.mock.calls[0][0]).toContain('revoked_at IS NULL');
  });

  test('creates a registration challenge for any active user (no TOTP required)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, email: 'user@example.com', first_name: 'Jane', last_name: 'Doe', is_active: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const res = response();

    await controller.registrationOptions({ user: { id: USER_ID } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ options: expect.objectContaining({ challenge: 'registration-challenge' }) });
    expect(mockQuery.mock.calls[2][0]).toContain('DELETE FROM user_passkey_challenges');
    expect(mockQuery.mock.calls[3][0]).toContain('INSERT INTO user_passkey_challenges');
  });

  test('rejects registration for inactive accounts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: USER_ID, email: 'user@example.com', is_active: false }] });
    const res = response();

    await controller.registrationOptions({ user: { id: USER_ID } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('rejects authentication options for unknown email', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = response();

    await controller.authenticationOptions({ body: { email: 'nobody@example.com' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('rejects authentication options when account has no passkeys', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: USER_ID, is_active: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = response();

    await controller.authenticationOptions({ body: { email: 'user@example.com' } }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'No passkeys are registered for this account.' });
  });

  test('revokes only the requesting user\u2019s passkey', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pk-1' }] });
    const res = response();

    await controller.revokePasskey({ user: { id: USER_ID }, params: { id: 'pk-1' } }, res, jest.fn());

    expect(res.json).toHaveBeenCalledWith({ revoked: true });
    expect(mockQuery.mock.calls[0][0]).toContain('UPDATE user_passkeys');
  });
});
