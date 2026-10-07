'use strict';

const express = require('express');
const request = require('supertest');
const { vortexRedeemLimiter } = require('../middleware/rateLimiter');

function createLimiterApp(limiter) {
  const app = express();
  app.post('/test', limiter, (_req, res) => res.sendStatus(204));
  return app;
}

test('vortex redeem limiter is exported as middleware', () => {
  expect(typeof vortexRedeemLimiter).toBe('function');
});

test('vortex redeem limiter allows 10 attempts per 15 minutes per IP, then blocks', async () => {
  const app = createLimiterApp(vortexRedeemLimiter);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await request(app).post('/test').expect(204);
  }

  const blocked = await request(app).post('/test');
  expect(blocked.status).toBe(429);
  expect(blocked.body).toMatchObject({
    error: 'Too many Vortex redemption attempts. Please try again in 15 minutes.',
    retryAfter: '15 minutes',
  });
}, 30000);
