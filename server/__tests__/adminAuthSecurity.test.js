'use strict';

const { mockQuery, resetMocks } = require('./setup');

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const tokenRevocationService = require('../services/tokenRevocationService');
const { requireAdmin } = require('../middleware/adminAuth');

function buildApp() {
  const app = express();
  app.get('/admin-only', requireAdmin, (req, res) => {
    res.json({ adminId: req.user.id });
  });
  return app;
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

beforeEach(() => {
  resetMocks();
  tokenRevocationService.isRevoked.mockResolvedValue(false);
});

describe('admin auth middleware security boundaries', () => {
  test('rejects refresh tokens before admin lookup', async () => {
    const refreshToken = signToken({ id: 1, type: 'refresh' });

    const res = await request(buildApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${refreshToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/refresh token/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rejects revoked admin access tokens', async () => {
    const token = signToken({ id: 1, email: 'admin@example.com', role: 'admin' });
    tokenRevocationService.isRevoked.mockResolvedValueOnce(true);

    const res = await request(buildApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/revoked/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('requires enabled 2FA for admin accounts', async () => {
    const token = signToken({ id: 1, email: 'admin@example.com', role: 'admin' });
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        role: 'admin',
        is_active: true,
        email: 'admin@example.com',
        totp_enabled: false,
      }],
    });

    const res = await request(buildApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('admin_2fa_required');
  });
});
