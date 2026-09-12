'use strict';

const express = require('express');
const request = require('supertest');
const {
  creditMutationLimiter,
  creditAdminMutationLimiter,
  creditExportLimiter,
} = require('../middleware/rateLimiter');

function createLimiterApp(limiter, method = 'post') {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: req.get('X-Test-User') || 'rate-limit-user' };
    next();
  });
  app[method]('/test', limiter, (_req, res) => res.sendStatus(204));
  return app;
}

test('credit mutation limits are scoped per authenticated customer', async () => {
  const app = createLimiterApp(creditMutationLimiter);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await request(app).post('/test').set('X-Test-User', 'customer-a').expect(204);
  }

  const blocked = await request(app).post('/test').set('X-Test-User', 'customer-a');
  expect(blocked.status).toBe(429);
  expect(blocked.body).toMatchObject({
    error: 'Too many OxSteed Credit changes. Please wait before trying again.',
    retryAfter: '15 minutes',
  });

  await request(app).post('/test').set('X-Test-User', 'customer-b').expect(204);
});

test('admin mutations and exports use independent sensitive-operation buckets', async () => {
  const adminApp = createLimiterApp(creditAdminMutationLimiter);
  const exportApp = createLimiterApp(creditExportLimiter, 'get');

  for (let attempt = 0; attempt < 60; attempt += 1) {
    await request(adminApp).post('/test').set('X-Test-User', 'admin-a').expect(204);
  }
  await request(adminApp).post('/test').set('X-Test-User', 'admin-a').expect(429);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    await request(exportApp).get('/test').set('X-Test-User', 'customer-a').expect(204);
  }
  await request(exportApp).get('/test').set('X-Test-User', 'customer-a').expect(429);
});
