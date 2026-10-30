'use strict';

// CSRF boundary tests: parseAuthIdentity must populate req.user from a
// signature-valid access cookie BEFORE attach/validate run, so cookie
// sessions are actually validated (previously validation silently skipped
// every cookie-authenticated request because req.user was unset).

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { parseAuthIdentity } = require('../middleware/auth');
const { attachCsrfToken, validateCsrfToken } = require('../middleware/csrf');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(parseAuthIdentity);
  app.use(attachCsrfToken);
  app.use(validateCsrfToken);
  app.get('/ping', (req, res) => res.json({ ok: true }));
  app.post('/mutate', (req, res) => res.json({ ok: true }));
  return app;
}

function accessCookie(userId = 7) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  return `oxsteed_access=${token}`;
}

function bearerToken(userId = 7) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { algorithm: 'HS256' });
}

// validateCsrfToken skips entirely when NODE_ENV === 'test', so run these
// requests with a non-test env and restore it afterwards.
async function withLiveEnv(fn) {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    return await fn();
  } finally {
    process.env.NODE_ENV = prev;
  }
}

describe('CSRF boundary for cookie sessions', () => {
  test('GET with a valid cookie attaches an X-CSRF-Token header', async () => {
    const res = await withLiveEnv(() =>
      request(buildApp()).get('/ping').set('Cookie', accessCookie()));
    expect(res.status).toBe(200);
    expect(res.headers['x-csrf-token']).toBeTruthy();
  });

  test('POST with a cookie but no token is rejected', async () => {
    const res = await withLiveEnv(() =>
      request(buildApp()).post('/mutate').set('Cookie', accessCookie()).send({}));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF token missing/);
  });

  test('POST with a cookie and the issued token succeeds', async () => {
    const app = buildApp();
    const get = await withLiveEnv(() => request(app).get('/ping').set('Cookie', accessCookie()));
    const token = get.headers['x-csrf-token'];
    expect(token).toBeTruthy();
    const res = await withLiveEnv(() =>
      request(app).post('/mutate').set('Cookie', accessCookie()).set('X-CSRF-Token', token).send({}));
    expect(res.status).toBe(200);
  });

  test('POST with a cookie and the token in the JSON body succeeds', async () => {
    const app = buildApp();
    const get = await withLiveEnv(() => request(app).get('/ping').set('Cookie', accessCookie()));
    const token = get.headers['x-csrf-token'];
    const res = await withLiveEnv(() =>
      request(app).post('/mutate').set('Cookie', accessCookie()).send({ _csrf: token }));
    expect(res.status).toBe(200);
  });

  test('POST with a cookie and a wrong token is rejected', async () => {
    const res = await withLiveEnv(() =>
      request(buildApp()).post('/mutate').set('Cookie', accessCookie()).set('X-CSRF-Token', 'wrong-token').send({}));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF token invalid/);
  });

  test('POST with Bearer auth stays exempt (a form cannot set the header)', async () => {
    const res = await withLiveEnv(() =>
      request(buildApp()).post('/mutate').set('Authorization', `Bearer ${bearerToken()}`).send({}));
    expect(res.status).toBe(200);
  });

  test('POST with no session passes the middleware (route auth rejects downstream)', async () => {
    const res = await withLiveEnv(() =>
      request(buildApp()).post('/mutate').send({}));
    expect(res.status).toBe(200);
  });

  test('parseAuthIdentity never rejects: garbage cookie yields no token, no crash', async () => {
    const res = await withLiveEnv(() =>
      request(buildApp()).get('/ping').set('Cookie', 'oxsteed_access=garbage'));
    expect(res.status).toBe(200);
    expect(res.headers['x-csrf-token']).toBeUndefined();
  });
});
