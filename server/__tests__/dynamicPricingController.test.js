'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/pricingEngine', () => ({
  calculatePrice: jest.fn(),
}));

const pricingEngine = require('../services/pricingEngine');
const controller = require('../controllers/dynamicPricingController');

function buildApp(user = null) {
  const app = express();
  if (user) app.use((req, _res, next) => { req.user = user; next(); });
  app.get('/api/businesses/:businessId/services/:serviceId/calculate-price', controller.calculatePrice);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  pricingEngine.calculatePrice.mockReset();
});

test('guest price requests stay anonymous even when they supply another customer id', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 7, owner_id: 'owner-1' }] });
  pricingEngine.calculatePrice.mockResolvedValueOnce({
    basePriceCents: 10000,
    adjustedPriceCents: 12500,
    applied: [{ ruleId: 'rule-1', ruleType: 'time', afterCents: 12500 }],
    segment: 'new',
    demand: 0.5,
    constraints: null,
  });

  const res = await request(buildApp())
    .get('/api/businesses/7/services/11/calculate-price')
    .query({ booking_date: '2026-11-10', booking_time: '09:30', customer_id: 'user-1', quantity: '2' });

  expect(res.status).toBe(200);
  expect(pricingEngine.calculatePrice).toHaveBeenCalledWith(expect.objectContaining({
    businessId: '7',
    kind: 'service',
    targetId: '11',
    customerId: null,
    quantity: '2',
    atTimeIso: '2026-11-10T09:30:00.000Z',
  }));
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO service_price_calculations'),
    expect.arrayContaining(['11', null, '2026-11-10', '09:30', 10000, 12500, expect.any(String), ['rule-1']])
  );
  expect(res.body).toMatchObject({
    base_price_cents: 10000,
    final_price_cents: 12500,
    applied_rules: ['rule-1'],
  });
});

test('authenticated price requests may use only their own customer context', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 7, owner_id: 'owner-1' }] });
  pricingEngine.calculatePrice.mockResolvedValueOnce({
    basePriceCents: 10000,
    adjustedPriceCents: 11000,
    applied: [],
  });

  const res = await request(buildApp({ id: 'user-1' }))
    .get('/api/businesses/7/services/11/calculate-price')
    .query({ booking_date: '2026-11-10', booking_time: '09:30', customer_id: 'other-user' });

  expect(res.status).toBe(200);
  expect(pricingEngine.calculatePrice).toHaveBeenCalledWith(expect.objectContaining({ customerId: null }));
  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO service_price_calculations'),
    expect.arrayContaining(['11', null, '2026-11-10', '09:30', 10000, 11000, expect.any(String), []])
  );
});

test('service price endpoint returns not found when the shared engine cannot resolve the service', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 7, owner_id: 'owner-1' }] });
  pricingEngine.calculatePrice.mockResolvedValueOnce({
    error: 'service not found',
    basePriceCents: 0,
    adjustedPriceCents: 0,
    applied: [],
  });

  const res = await request(buildApp())
    .get('/api/businesses/7/services/11/calculate-price')
    .query({ booking_date: '2026-11-10', booking_time: '09:30' });

  expect(res.status).toBe(404);
  expect(pricingEngine.calculatePrice).toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO service_price_calculations'))).toBe(false);
});

test('service price endpoint rejects a business that is not publicly visible', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp())
    .get('/api/businesses/7/services/11/calculate-price')
    .query({ booking_date: '2026-11-10', booking_time: '09:30' });

  expect(res.status).toBe(404);
  expect(pricingEngine.calculatePrice).not.toHaveBeenCalled();
});
