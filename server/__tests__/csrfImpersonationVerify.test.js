'use strict';

/**
 * Auth audit item 16: the CSRF impersonation exemption rests on a VERIFIED
 * bearer, not a decoded claim.
 *   - a forged impersonation bearer (right claim, wrong secret) no longer
 *     skips the CSRF check when a cookie session is present;
 *   - an expired impersonation bearer no longer skips it either;
 *   - a valid, non-expired impersonation bearer still exempts exactly as
 *     before (the existing csrf.test.js exempt case, re-proven here
 *     against the verified path).
 * Mirrors the csrf.test.js harness: parseAuthIdentity populates req.user
 * from the valid cookie, then validateCsrfToken decides. validateCsrfToken
 * skips entirely when NODE_ENV === 'test', so requests run with a
 * non-test env via withLiveEnv.
 */

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { parseAuthIdentity } = require('../middleware/auth');
const { validateCsrfToken, attachCsrfToken } = require('../middleware/csrf');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuthIdentity);
  app.use(attachCsrfToken);
  app.use(validateCsrfToken);
  app.post('/mutate', (req, res) => res.json({ ok: true }));
  return app;
}

function accessCookie(userId = 7) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  return `oxsteed_access=${token}`;
}

function impersonationBearer({ secret = process.env.JWT_SECRET, expiresIn = '15m' } = {}) {
  return jwt.sign({ id: 8, impersonation: true }, secret, { algorithm: 'HS256', expiresIn });
}

async function withLiveEnv(fn) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = prev;
  }
}

describe('item 16: verified impersonation for the CSRF exemption', () => {
  test('a forged impersonation bearer does not skip the CSRF check', async () => {
    const forged = impersonationBearer({ secret: 'wrong-secret' });
    const res = await withLiveEnv(() =>
      request(buildApp()).post('/mutate')
        .set('Cookie', accessCookie())
        .set('Authorization', `Bearer ${forged}`)
        .send({}));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF token missing/);
  });

  test('an expired impersonation bearer does not skip the CSRF check', async () => {
    const expired = jwt.sign(
      { id: 8, impersonation: true, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET,
      { algorithm: 'HS256' }
    );
    const res = await withLiveEnv(() =>
      request(buildApp()).post('/mutate')
        .set('Cookie', accessCookie())
        .set('Authorization', `Bearer ${expired}`)
        .send({}));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF token missing/);
  });

  test('a valid impersonation bearer still exempts as before', async () => {
    const valid = impersonationBearer();
    const res = await withLiveEnv(() =>
      request(buildApp()).post('/mutate')
        .set('Cookie', accessCookie())
        .set('Authorization', `Bearer ${valid}`)
        .send({}));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
