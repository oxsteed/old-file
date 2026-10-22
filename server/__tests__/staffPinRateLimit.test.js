'use strict';

/**
 * Auth-audit item 10: staff PIN brute-force lockout evasion.
 *
 * The account-auth staff PIN endpoints (POST /:restaurantId/pos/staff-pins/validate
 * and POST /:restaurantId/pos/staff-session) had no rate limiter, and
 * assertPinNotLocked cannot scope attempts without a deviceId, so blind
 * PIN guesses ran at request speed with no lockout. The fix mounts
 * strictLimiter (10/hour per IP) plus staffPinAttemptLimiter (30 per
 * 15 minutes per restaurant+IP) on both routes.
 *
 * No DB needed: the limiter store is in-memory (redis mocked out) and the
 * route-registration check compares middleware identity.
 */
jest.mock('../utils/redis', () => null);

const express = require('express');
const request = require('supertest');
const rateLimiter = require('../middleware/rateLimiter');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post(
    '/api/restaurants/:restaurantId/pos/staff-pins/validate',
    rateLimiter.staffPinAttemptLimiter,
    (_req, res) => res.json({ ok: true })
  );
  return app;
}

describe('staff PIN attempt budget (auth-audit item 10)', () => {
  test('staffPinAttemptLimiter is exported and configured per restaurant+IP', () => {
    expect(typeof rateLimiter.staffPinAttemptLimiter).toBe('function');
  });

  test('the attempt budget 429s after 30 attempts per restaurant+IP in 15 minutes', async () => {
    const app = buildApp();
    for (let i = 0; i < 30; i += 1) {
      const res = await request(app).post('/api/restaurants/42/pos/staff-pins/validate').send({ pin: '0000' });
      expect(res.status).toBe(200);
    }
    const limited = await request(app).post('/api/restaurants/42/pos/staff-pins/validate').send({ pin: '0000' });
    expect(limited.status).toBe(429);
  });

  test('the budget is keyed per restaurant: another restaurant still has budget', async () => {
    const app = buildApp();
    for (let i = 0; i < 30; i += 1) {
      const res = await request(app).post('/api/restaurants/43/pos/staff-pins/validate').send({ pin: '0000' });
      expect(res.status).toBe(200);
    }
    const other = await request(app).post('/api/restaurants/44/pos/staff-pins/validate').send({ pin: '0000' });
    expect(other.status).toBe(200);
  });

  test('both staff PIN routes mount strictLimiter and staffPinAttemptLimiter', () => {
    const router = require('../routes/restaurants');
    for (const path of ['/:restaurantId/pos/staff-pins/validate', '/:restaurantId/pos/staff-session']) {
      const layer = router.stack.find(
        (l) => l.route && l.route.path === path && l.route.methods.post
      );
      expect(layer).toBeTruthy();
      const handles = layer.route.stack.map((h) => h.handle);
      expect(handles).toContain(rateLimiter.strictLimiter);
      expect(handles).toContain(rateLimiter.staffPinAttemptLimiter);
    }
  });
});
