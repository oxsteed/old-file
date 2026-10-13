'use strict';

const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const tokenRevocationService = require('../services/tokenRevocationService');
const { authenticate, optionalAuth } = require('../middleware/auth');

function buildApp(middleware) {
  const app = express();
  app.get('/protected', middleware, (req, res) => {
    res.json({ userId: req.user?.id || null });
  });
  return app;
}

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
});

describe('auth middleware token boundaries', () => {
  test('authenticate rejects refresh tokens as API bearer tokens', async () => {
    const refreshToken = jwt.sign(
      { id: 1, type: 'refresh' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256' }
    );

    const res = await request(buildApp(authenticate))
      .get('/protected')
      .set('Authorization', `Bearer ${refreshToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/refresh token/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('authenticate rejects MFA tokens as API bearer tokens', async () => {
    const mfaToken = jwt.sign(
      { id: 1, isMfaToken: true },
      process.env.JWT_SECRET,
      { algorithm: 'HS256' }
    );

    const res = await request(buildApp(authenticate))
      .get('/protected')
      .set('Authorization', `Bearer ${mfaToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/mfa token/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('optionalAuth ignores revoked tokens instead of attaching a user', async () => {
    const accessToken = jwt.sign(
      { id: 1, email: 'test@example.com', role: 'customer' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256' }
    );
    tokenRevocationService.isRevoked.mockResolvedValueOnce(true);

    const res = await request(buildApp(optionalAuth))
      .get('/protected')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('authenticate applies user revocation markers to impersonation tokens', async () => {
    const impersonationToken = jwt.sign(
      { id: 7, impersonation: true, impersonated_by: 99, jti: 'impersonation-1' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256' }
    );
    tokenRevocationService.isRevoked.mockResolvedValueOnce(true);

    const res = await request(buildApp(authenticate))
      .get('/protected')
      .set('Authorization', `Bearer ${impersonationToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('authenticate rejects impersonation when the impersonating admin revoked their tokens', async () => {
    // Review P3-14-F07: an admin password change / logout-everywhere after
    // the session started must end active impersonations too.
    const impersonationToken = jwt.sign(
      { id: 7, impersonation: true, impersonated_by: 99, jti: 'impersonation-2' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256' }
    );
    // Target-user check passes; the impersonating admin's marker revokes.
    tokenRevocationService.isRevoked
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const res = await request(buildApp(authenticate))
      .get('/protected')
      .set('Authorization', `Bearer ${impersonationToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/impersonating admin/i);
    // The target-user check runs first (passes), then the impersonating
    // admin's user-level marker is consulted and revokes.
    const calls = tokenRevocationService.isRevoked.mock.calls;
    expect(calls[calls.length - 2][1]).toBe(7);
    expect(calls[calls.length - 1][1]).toBe(99);
  });
});
