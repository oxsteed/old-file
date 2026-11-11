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
  app.post('/api/businesses/:businessId/pricing/product/:productId/rules', controller.createProductRule);
  app.get('/api/businesses/:businessId/pricing/product/:productId/rules', controller.listProductRules);
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

test('product rule creation writes applies_to fields from the deployed product schema', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rule-product-1' }] });

  const res = await request(buildApp())
    .post('/api/businesses/7/pricing/product/11111111-1111-4111-8111-111111111111/rules')
    .send({ rule_type: 'volume', conditions_json: { min_quantity: 3 }, pricing_adjustment: { percent_off: 10 } });

  expect(res.status).toBe(201);
  expect(mockQuery.mock.calls[0][0]).toMatch(/rule_name, rule_type, description, priority/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/applies_to, applies_to_id/);
  expect(mockQuery.mock.calls[0][0]).not.toMatch(/product_id/);
  expect(mockQuery.mock.calls[0][1]).toEqual([
    7,
    '11111111-1111-4111-8111-111111111111',
    'volume pricing rule',
    'volume',
    '',
    1,
    JSON.stringify({ min_quantity: 3 }),
    JSON.stringify({ percent_off: 10 }),
  ]);
});

test('product rule listing scopes to the business and the deployed applies_to relation', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp())
    .get('/api/businesses/7/pricing/product/11111111-1111-4111-8111-111111111111/rules');

  expect(res.status).toBe(200);
  expect(mockQuery.mock.calls[0][0]).toMatch(/applies_to = 'all'/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/applies_to_id = \$2::uuid/);
  expect(mockQuery.mock.calls[0][0]).not.toMatch(/product_id/);
});
