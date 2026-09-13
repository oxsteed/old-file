'use strict';

const express = require('express');
const request = require('supertest');
const {
  creditMutationLimiter,
  creditPurchaseLimiter,
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

test('Credit purchase limits only apply to OxSteed Credit orders and are scoped per customer', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: req.get('X-Test-User') || 'credit-purchase-user' };
    next();
  });
  app.post('/test', creditPurchaseLimiter, (_req, res) => res.sendStatus(204));

  await request(app)
    .post('/test')
    .set('X-Test-User', 'credit-purchase-customer-a')
    .send({ paymentMode: 'pay_now' })
    .expect(204);

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await request(app)
      .post('/test')
      .set('X-Test-User', 'credit-purchase-customer-a')
      .send({ payment_mode: attempt % 2 ? 'credit' : 'oxsteedCredit' })
      .expect(204);
  }

  const blocked = await request(app)
    .post('/test')
    .set('X-Test-User', 'credit-purchase-customer-a')
    .send({ paymentMode: 'oxsteed_credit' });
  expect(blocked.status).toBe(429);
  expect(blocked.body).toMatchObject({
    error: 'Too many OxSteed Credit purchase attempts. Please wait before trying again.',
    retryAfter: '15 minutes',
  });

  await request(app)
    .post('/test')
    .set('X-Test-User', 'credit-purchase-customer-b')
    .send({ paymentMode: 'oxsteed_credit' })
    .expect(204);
});
