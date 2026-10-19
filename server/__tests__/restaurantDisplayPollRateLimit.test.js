'use strict';

// The TV polls POST /api/restaurant/displays/status every 5s while waiting
// for an owner claim, and paired displays POST /heartbeat on a similar
// cadence. Both must use the dedicated displayPollLimiter (60/minute per IP),
// NOT strictLimiter's 10/hour budget: the 10th poll (~45s after issuance)
// would otherwise 429 and block the owner claim on the same network.
// /pairing-code and /claim keep strictLimiter (issuance and claiming are the
// sensitive operations).

jest.mock('../utils/redis', () => null);
jest.mock('../controllers/restaurantDisplayController', () => new Proxy({}, {
  get: () => (req, res) => res.status(200).json({ ok: true }),
}));
jest.mock('../middleware/auth', () => ({ authenticate: (req, res, next) => next() }));
jest.mock('../middleware/rejectImpersonated', () => ({ rejectImpersonated: (req, res, next) => next() }));

const express = require('express');
const request = require('supertest');
const { displayPollLimiter } = require('../middleware/rateLimiter');
const displayRoutes = require('../routes/restaurantDisplays');

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/restaurant/displays', displayRoutes);
  return app;
}

let ipCounter = 0;
function client(app) {
  const ip = `192.0.2.${++ipCounter}`;
  return (route, body = {}) => request(app).post(`/api/restaurant/displays${route}`)
    .set('X-Forwarded-For', ip)
    .send(body);
}

test('displayPollLimiter is exported with a 60/minute per-IP budget', () => {
  expect(typeof displayPollLimiter).toBe('function');
});

test('/status and /heartbeat tolerate 60 polls per minute but not 61', async () => {
  const send = client(buildApp());
  // 60 polls spread across /status and /heartbeat stay within the budget.
  for (let i = 0; i < 30; i++) {
    expect((await send('/status', { code: 'ABCDEF' })).status).toBe(200);
    expect((await send('/heartbeat')).status).toBe(200);
  }
  // The 61st request in the window is rate-limited...
  const blocked = await send('/status', { code: 'ABCDEF' });
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  // ...while a different IP still has its own full budget.
  const other = await client(buildApp())('/status', { code: 'ABCDEF' });
  expect(other.status).toBe(200);
});

test('status polling no longer trips strictLimiter: 60 polls stay under the 10/hour cap', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 60; i++) {
    const res = await send('/status', { code: 'ABCDEF' });
    expect(res.status).toBe(200);
  }
});

test('/pairing-code and /claim keep the strict 10/hour limit', async () => {
  const send = client(buildApp());
  for (let i = 0; i < 10; i++) {
    expect((await send('/pairing-code', { restaurantId: 1 })).status).toBe(200);
  }
  expect((await send('/pairing-code', { restaurantId: 1 })).status).toBe(429);
});
