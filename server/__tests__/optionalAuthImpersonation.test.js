'use strict';

/**
 * optionalAuth impersonation parity (auth-audit finding 36).
 *
 * optionalAuth used to check only the revocation cache for impersonation
 * tokens, skipping the user_impersonation_log.ended_at DB check and the
 * impersonating-admin revocation check that authenticate performs. An ended
 * impersonation session could still authenticate as the target on
 * optional-auth public routes until the cache propagated.
 *
 * Both paths now share verifyImpersonationSession. In optional-auth
 * semantics a failed check means "stay unauthenticated" (next() with no
 * req.user), never a 401.
 */

const { mockQuery, resetMocks } = require('./setup');
const jwt = require('jsonwebtoken');

const tokenRevocationService = require('../services/tokenRevocationService');
const { optionalAuth } = require('../middleware/auth');

const SECRET = process.env.JWT_SECRET || 'test-secret-for-unit-tests-00000000';

function impersonationToken(overrides = {}) {
  return jwt.sign(
    {
      id: 'victim-1',
      impersonation: true,
      impersonated_by: 'admin-1',
      jti: 'jti-abc-123',
      iat: Math.floor(Date.now() / 1000) - 60,
      ...overrides,
    },
    SECRET,
    { algorithm: 'HS256' }
  );
}

function mockReq(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

function userRow() {
  return {
    rows: [
      {
        id: 'victim-1',
        first_name: 'Vic',
        last_name: 'Tim',
        email: 'vic@example.invalid',
        role: 'customer',
        is_active: true,
        is_suspended: false,
        suspended_until: null,
      },
    ],
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
  tokenRevocationService.isImpersonationSessionRevoked.mockResolvedValue(false);
  tokenRevocationService.isRevoked.mockResolvedValue(false);
});

describe('finding 36: optionalAuth mirrors authenticate on impersonation sessions', () => {
  test('ended session in the DB stays unauthenticated (cache says alive)', async () => {
    // DB check runs first in verifyImpersonationSession; the user row must
    // never be reached for an ended session.
    mockQuery.mockResolvedValueOnce({ rows: [{ ended_at: new Date().toISOString() }] });
    const req = mockReq(impersonationToken());
    const next = jest.fn();
    await optionalAuth(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
    expect(req.isImpersonated).toBe(true);
  });

  test('impersonating admin revoked stays unauthenticated', async () => {
    tokenRevocationService.isRevoked.mockImplementation(async (_tokenId, userId) =>
      userId === 'admin-1'
    );
    mockQuery.mockResolvedValueOnce({ rows: [{ ended_at: null }] });
    const req = mockReq(impersonationToken());
    const next = jest.fn();
    await optionalAuth(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test('target user revoked stays unauthenticated', async () => {
    tokenRevocationService.isRevoked.mockImplementation(async (_tokenId, userId) =>
      userId === 'victim-1'
    );
    const req = mockReq(impersonationToken());
    const next = jest.fn();
    await optionalAuth(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test('revocation cache hit stays unauthenticated', async () => {
    tokenRevocationService.isImpersonationSessionRevoked.mockResolvedValue(true);
    const req = mockReq(impersonationToken());
    const next = jest.fn();
    await optionalAuth(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  test('live session still authenticates as the target', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ended_at: null }] });
    mockQuery.mockResolvedValueOnce(userRow());
    const req = mockReq(impersonationToken());
    const next = jest.fn();
    await optionalAuth(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.id).toBe('victim-1');
    expect(req.isImpersonated).toBe(true);
    expect(req.impersonatedBy).toBe('admin-1');
  });

  test('DB failure on the ended_at check fails closed (no auth)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'));
    const req = mockReq(impersonationToken());
    const next = jest.fn();
    await optionalAuth(req, {}, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });
});
