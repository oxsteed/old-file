'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/businessAuditLog', () => ({
  logBusinessAction: jest.fn().mockResolvedValue(undefined),
}));

const controller = require('../controllers/pricingRulesAdminController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.business = { id: 7 };
    req.user = { id: 'user-1' };
    next();
  });
  app.post('/api/businesses/:businessId/pricing/service/:serviceId/rules', controller.createServiceRule);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

test('service rule creation writes the deployed schema and scopes the service to the business', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'rule-1' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp())
    .post('/api/businesses/7/pricing/service/11/rules')
    .send({
      rule_type: 'time',
      priority: 10,
      time: { day_of_week: 2, start_time: '09:00', end_time: '10:00', price_multiplier: 1.5 },
    });

  expect(res.status).toBe(201);
  expect(mockQuery.mock.calls[1][0]).toMatch(/business_id, service_id, rule_type, priority, is_enabled/);
  expect(mockQuery.mock.calls[1][1]).toEqual([7, 'time', 10, 'time pricing rule', 'user-1', '11']);
  expect(mockQuery.mock.calls[2][0]).toMatch(/service_price_time_rules/);
});

test('the builder default priority is normalized to the valid highest priority', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: 'rule-1' }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp())
    .post('/api/businesses/7/pricing/service/11/rules')
    .send({ rule_type: 'time', time: { price_multiplier: 1.2 } });

  expect(res.status).toBe(201);
  expect(mockQuery.mock.calls[1][1][2]).toBe(1);
});

test('a service outside the business returns not found instead of an internal error', async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp())
    .post('/api/businesses/7/pricing/service/999/rules')
    .send({ rule_type: 'time', time: { price_multiplier: 1.2 } });

  expect(res.status).toBe(404);
});
