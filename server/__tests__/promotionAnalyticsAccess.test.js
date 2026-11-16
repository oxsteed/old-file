'use strict';

jest.mock('../middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-1', role: req.headers['x-role'] || 'customer' };
    next();
  },
  optionalAuth: (req, _res, next) => next(),
}));
jest.mock('../middleware/rateLimiter', () => ({ generalLimiter: (_req, _res, next) => next() }));
jest.mock('../services/access/accessService', () => ({ can: jest.fn() }));
jest.mock('../controllers/promotionAnalyticsController', () => ({
  recordHelperShare: (_req, res) => res.status(204).end(),
  getHelperPerformance: (_req, res) => res.json({ totals: { shares: 1 } }),
  recordVisit: (_req, res) => res.status(204).end(),
}));

const express = require('express');
const request = require('supertest');
const access = require('../services/access/accessService');
const router = require('../routes/promotionAnalytics');

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/promotion-analytics', router);
  return server;
}

afterEach(() => {
  delete process.env.ACCESS_HELPER_ENFORCEMENT;
  jest.clearAllMocks();
});

test('enforced helper analytics deny a customer-class user without the capability', async () => {
  process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
  access.can.mockResolvedValue({ allowed: false, reason: 'not_granted' });

  const denied = await request(app())
    .get('/api/promotion-analytics/performance')
    .set('x-role', 'customer');

  expect(denied.status).toBe(403);
  expect(denied.body).toMatchObject({ code: 'access_required', capability: 'helper.offer_services' });
});

test('enforced helper analytics accept an approved customer-class helper and legacy helper', async () => {
  process.env.ACCESS_HELPER_ENFORCEMENT = 'enforce';
  access.can.mockResolvedValue({ allowed: true, reason: 'grant' });

  const approvedCustomer = await request(app())
    .get('/api/promotion-analytics/performance')
    .set('x-role', 'customer');
  expect(approvedCustomer.status).toBe(200);

  access.can.mockResolvedValue({ allowed: false, reason: 'grant_revoked' });
  const revokedLegacyHelper = await request(app())
    .post('/api/promotion-analytics/share')
    .set('x-role', 'helper')
    .send({ url: 'https://example.invalid' });
  expect(revokedLegacyHelper.status).toBe(403);
});
