'use strict';

// Fix 2 chain test: paired-display traffic must not consume the anonymous IP
// budget, and must be counted per pairing id instead.
//
// The test app applies the real limiter stack the way production does:
// generalLimiter and deviceApiLimiter globally on /api/, then
// displayPollLimiter on the heartbeat-style route. A valid display token fires 250 requests with zero
// 429s; anonymous traffic on the same IP 429s after 200. The db is stubbed;
// the limiter store is in-memory (redis mocked out), exactly like the
// existing displayPollLimiter test.

jest.mock('../utils/redis', () => null);
jest.mock('../db', () => ({ query: jest.fn(async () => ({ rows: [] })) }));

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
const rateLimiter = require('../middleware/rateLimiter');
const db = require('../db');

// Two devices sharing one restaurant NAT IP: different pairing ids, one IP.
const TOKEN_A = crypto.randomBytes(32).toString('hex');
const TOKEN_B = crypto.randomBytes(32).toString('hex');
const TOKEN_C = crypto.randomBytes(32).toString('hex');
const TOKEN_D = crypto.randomBytes(32).toString('hex');
const hashOf = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const DEVICE_ROWS = {
  [hashOf(TOKEN_A)]: { id: 7, restaurant_id: 42, device_role: 'kitchen' },
  [hashOf(TOKEN_B)]: { id: 8, restaurant_id: 42, device_role: 'kiosk' },
  [hashOf(TOKEN_C)]: { id: 9, restaurant_id: 42, device_role: 'kiosk' },
  [hashOf(TOKEN_D)]: { id: 10, restaurant_id: 42, device_role: 'kiosk' },
};

db.query.mockImplementation(async (_sql, params) => {
  const row = params && DEVICE_ROWS[params[0]];
  return { rows: row ? [row] : [] };
});

function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use('/api/', rateLimiter.generalLimiter);
  // Production mounts the device budget globally so public feeds and other
  // display-token routes cannot bypass it.
  app.use('/api/', rateLimiter.deviceApiLimiter);
  // Mirrors the kitchen ticket surface (restaurants.js).
  app.get(
    '/api/restaurants/:restaurantId/kitchen/feed',
    (req, res) => res.json({ ok: true })
  );
  app.get(
    '/api/food/restaurants/:restaurantId/queue-board',
    (req, res) => res.json({ ok: true })
  );
  // Mirrors the paired-display routes (restaurantDisplays.js): the poll
  // bucket and the per-device bucket compose.
  app.post(
    '/api/restaurant/displays/heartbeat',
    rateLimiter.displayPollLimiter,
    (req, res) => res.json({ ok: true })
  );
  return app;
}

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `192.0.2.${ipCounter}`;
}

async function fire(app, { ip, token, method, route, count }) {
  const statuses = [];
  for (let i = 0; i < count; i += 1) {
    let req = request(app)[method](route).set('X-Forwarded-For', ip);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    // eslint-disable-next-line no-await-in-loop
    const res = await req;
    statuses.push(res.status);
  }
  return statuses;
}

beforeEach(() => {
  rateLimiter._clearDisplayDeviceCache();
});

test('getVerifiedDisplayDevice verifies, caches, and treats unknown tokens as anonymous', async () => {
  db.query.mockClear();
  const withToken = { headers: { authorization: `Bearer ${TOKEN_A}` } };
  const device = await rateLimiter.getVerifiedDisplayDevice(withToken);
  expect(device).toEqual({ pairingId: 7, restaurantId: 42, deviceRole: 'kitchen' });
  // Second call reuses the request-level cache: still one DB hit.
  await rateLimiter.getVerifiedDisplayDevice(withToken);
  expect(db.query).toHaveBeenCalledTimes(1);
  // A fresh request reuses the module-level positive cache: still one hit.
  await rateLimiter.getVerifiedDisplayDevice({ headers: { authorization: `Bearer ${TOKEN_A}` } });
  expect(db.query).toHaveBeenCalledTimes(1);

  // Unknown 64-hex token: null, and the negative result is cached too.
  const bogus = crypto.randomBytes(32).toString('hex');
  const unknown = await rateLimiter.getVerifiedDisplayDevice({ headers: { authorization: `Bearer ${bogus}` } });
  expect(unknown).toBeNull();
  await rateLimiter.getVerifiedDisplayDevice({ headers: { authorization: `Bearer ${bogus}` } });
  expect(db.query).toHaveBeenCalledTimes(2);

  // No bearer at all: anonymous, no DB hit.
  const none = await rateLimiter.getVerifiedDisplayDevice({ headers: {} });
  expect(none).toBeNull();
  expect(db.query).toHaveBeenCalledTimes(2);
});

test('complete chain: 250 device requests see zero 429s; anonymous 429s after 200', async () => {
  const app = buildApp();
  const ip = nextIp();

  // Two displays behind one NAT IP both stay under their own per-device
  // budgets (300/15min each) and out of the anonymous IP bucket.
  const statusesA = await fire(app, { ip, token: TOKEN_A, method: 'get', route: '/api/restaurants/42/kitchen/feed', count: 250 });
  expect(statusesA.every((s) => s === 200)).toBe(true);
  const statusesB = await fire(app, { ip, token: TOKEN_B, method: 'get', route: '/api/restaurants/42/kitchen/feed', count: 250 });
  expect(statusesB.every((s) => s === 200)).toBe(true);

  // The same IP without a device token gets the 200/15min anonymous budget.
  const anonIp = nextIp();
  const anon = await fire(app, { ip: anonIp, method: 'get', route: '/api/restaurants/42/kitchen/feed', count: 250 });
  const ok = anon.filter((s) => s === 200).length;
  const blocked = anon.filter((s) => s === 429).length;
  expect(ok).toBe(200);
  expect(blocked).toBe(50);
}, 120000);

test('displayPollLimiter and deviceApiLimiter compose on heartbeat', async () => {
  const app = buildApp();
  const ip = nextIp();
  // 70 paired heartbeats: the 60/minute per-IP poll bucket trips at 61,
  // the 300/15min per-device bucket stays green throughout.
  const statuses = await fire(app, { ip, token: TOKEN_C, method: 'post', route: '/api/restaurant/displays/heartbeat', count: 70 });
  expect(statuses.filter((s) => s === 200).length).toBe(60);
  expect(statuses.filter((s) => s === 429).length).toBe(10);
  // An invalid display-shaped token never leaves the anonymous budget: it is
  // limited by IP like any other unauthenticated request (fail closed).
  const bogus = crypto.randomBytes(32).toString('hex');
  const bogusIp = nextIp();
  const bogusStatuses = await fire(app, { ip: bogusIp, token: bogus, method: 'get', route: '/api/restaurants/42/kitchen/feed', count: 210 });
  expect(bogusStatuses.filter((s) => s === 200).length).toBe(200);
  expect(bogusStatuses.filter((s) => s === 429).length).toBe(10);
}, 120000);

test('a valid display token is still bounded on a public feed route', async () => {
  const app = buildApp();
  const statuses = await fire(app, {
    ip: nextIp(),
    token: TOKEN_D,
    method: 'get',
    route: '/api/food/restaurants/42/queue-board',
    count: 350,
  });
  expect(statuses.filter((s) => s === 200).length).toBe(300);
  expect(statuses.filter((s) => s === 429).length).toBe(50);
}, 120000);
