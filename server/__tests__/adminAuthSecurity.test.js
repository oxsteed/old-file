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

describe('admin auth cookie fallback (web admin SPA sessions)', () => {
  function mockAdminUser(overrides = {}) {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 1,
        role: 'admin',
        is_active: true,
        email: 'admin@example.com',
        totp_enabled: true,
        ...overrides,
      }],
    });
  }

  test('accepts the oxsteed_access cookie when no Bearer header is present', async () => {
    const token = signToken({ id: 1, email: 'admin@example.com', role: 'admin' });
    mockAdminUser();

    const res = await request(buildApp())
      .get('/admin-only')
      .set('Cookie', `oxsteed_access=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.adminId).toBe(1);
  });

  test('prefers the Bearer header over the cookie', async () => {
    const cookieToken = signToken({ id: 99, email: 'other@example.com', role: 'admin' });
    const bearerToken = signToken({ id: 1, email: 'admin@example.com', role: 'admin' });
    mockAdminUser();

    const res = await request(buildApp())
      .get('/admin-only')
      .set('Authorization', `Bearer ${bearerToken}`)
      .set('Cookie', `oxsteed_access=${cookieToken}`);

    expect(res.status).toBe(200);
    expect(res.body.adminId).toBe(1);
  });

  test('still 401s with neither header nor cookie', async () => {
    const res = await request(buildApp()).get('/admin-only');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized.');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
