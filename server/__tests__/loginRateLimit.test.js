'use strict';

// Exercise the real router and limiter stores, without signing in real users.
// Only controllers/authentication and external services are substituted.
jest.mock('../utils/redis', () => null);
jest.mock('../controllers/authController', () => new Proxy({}, {
  get: (_, name) => (req, res) => {
    const denied = name === 'login' || name === 'loginWith2FA';
    res.status(denied ? 401 : 200).json({ controller: name });
  },
}));
jest.mock('../controllers/logisticsInternalAccessController', () => new Proxy({}, {
  get: () => (req, res) => res.status(401).json({ error: 'invalid_credentials' }),
}));
jest.mock('../controllers/passkeyController', () => new Proxy({}, {
  get: () => (req, res) => res.json({ ok: true }),
}));
jest.mock('../middleware/auth', () => ({ authenticate: (req, res, next) => next() }));
jest.mock('../middleware/verifyCaptcha', () => ({ verifyCaptcha: (req, res, next) => next() }));

const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { generalLimiter, authenticatedLimiter } = require('../middleware/rateLimiter');
const authRoutes = require('../routes/auth');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use('/api/', generalLimiter);
  app.use('/api/', authenticatedLimiter);
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

let ipCounter = 0;
function client(app) {
  const ip = `192.0.2.${++ipCounter}`;
  return (route, method = 'post') => request(app)[method](`/api/auth${route}`)
    .set('X-Forwarded-For', ip);
}

test('the production server does not double-mount the authentication limiter', () => {
  const source = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
  expect(source).not.toMatch(/app\.use\(['"]\/api\/auth['"],\s*authLimiter\)/);
});

test('routine login-page traffic does not consume credential attempts; MFA cannot bypass the cap', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 35; i++) {
    expect((await send(i % 2 ? '/refresh' : '/logout')).status).toBe(200);
    expect((await send('/me', 'get')).status).toBe(200);
  }
  for (let i = 0; i < 20; i++) {
    expect((await send(i % 2 ? '/check-email' : '/check-zip')).status).toBe(200);
  }
  const routes = ['/login', '/login/2fa', '/internal-access/login'];
  for (let i = 0; i < 30; i++) {
    const res = await send(routes[i % routes.length]);
    expect(res.status).toBe(401);
    expect(res.headers['ratelimit-remaining']).toBe(String(29 - i));
  }
  const blocked = await send('/login/2fa');
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  // The other login entry points use the same budget.
  expect((await send('/login')).status).toBe(429);
  expect((await send('/internal-access/login')).status).toBe(429);
});

test('exhausted registration/OTP traffic does not block login', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 30; i++) {
    expect((await send(i % 2 ? '/register/start' : '/request-otp')).status).toBe(200);
  }
  expect((await send('/verify-otp')).status).toBe(429);
  const login = await send('/login');
  expect(login.status).toBe(401);
  expect(login.headers['ratelimit-remaining']).toBe('29');
});

test('signup lookups retain their own cap without preventing sign-in', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 60; i++) {
    expect((await send(i % 2 ? '/check-email' : '/check-zip')).status).toBe(200);
  }
  expect((await send('/check-email')).status).toBe(429);
  expect((await send('/login')).status).toBe(401);
});

test('refresh/logout remain bounded but do not lock out login', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 120; i++) {
    expect((await send(i % 2 ? '/refresh' : '/logout')).status).toBe(200);
  }
  expect((await send('/refresh')).status).toBe(429);
  expect((await send('/logout')).status).toBe(429);
  expect((await send('/login')).status).toBe(401);
});

test('a blocked IP does not consume another IP login budget', async () => {
  const app = buildApp();
  const send = client(app);
  for (let i = 0; i < 30; i++) await send('/login');
  expect((await send('/login')).status).toBe(429);
  const other = await client(app)('/login');
  expect(other.status).toBe(401);
  expect(other.headers['ratelimit-remaining']).toBe('29');
});

test('passkey and password recovery limits are preserved', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 10; i++) {
    expect((await send(i % 2 ? '/login/passkey' : '/login/passkey/options')).status).toBe(200);
  }
  expect((await send('/login/passkey/options')).status).toBe(429);
  for (let i = 0; i < 3; i++) {
    expect((await send('/forgot-password').send({ email: 'synthetic@example.invalid' })).status).toBe(200);
  }
  expect((await send('/forgot-password').send({ email: 'synthetic@example.invalid' })).status).toBe(429);
  expect((await send('/login')).status).toBe(401);
});

test('sensitive account changes keep their existing 30-request protection', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 30; i++) expect((await send('/change-password', 'put')).status).toBe(200);
  expect((await send('/change-email')).status).toBe(429);
  expect((await send('/login')).status).toBe(401);
});
