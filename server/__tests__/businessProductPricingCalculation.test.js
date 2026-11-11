'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

jest.mock('../services/pricingEngine', () => ({
  calculatePrice: jest.fn(),
}));

const pricingEngine = require('../services/pricingEngine');
const controller = require('../controllers/businessProductPricingController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.post('/api/businesses/:businessId/product-pricing/calculate', controller.calculatePrice);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  pricingEngine.calculatePrice.mockReset();
});

test('public product pricing uses the shared cents engine while preserving the dollar API contract', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ business_id: 7, owner_id: 'owner-1' }] });
  pricingEngine.calculatePrice.mockResolvedValueOnce({
    basePriceCents: 1250,
    adjustedPriceCents: 1000,
    applied: [{ ruleId: 'rule-1', ruleType: 'volume', kind: 'multiplier', value: 0.8 }],
  });

  const res = await request(buildApp())
    .post('/api/businesses/7/product-pricing/calculate')
    .send({ productId: 'product-1', quantity: 2, customerId: 'user-1' });

  expect(res.status).toBe(200);
  expect(pricingEngine.calculatePrice).toHaveBeenCalledWith({
    businessId: '7',
    kind: 'product',
    targetId: 'product-1',
    quantity: 2,
    customerId: 'user-1',
  });
  expect(res.body).toEqual({
    success: true,
    data: {
      productId: 'product-1',
      basePrice: 12.5,
      finalPrice: 10,
      totalPrice: 20,
      quantity: 2,
      savings: 2.5,
      appliedRules: [{ ruleId: 'rule-1', type: 'volume', adjustment: { kind: 'multiplier', value: 0.8 } }],
    },
  });
  expect(mockQuery).toHaveBeenCalledTimes(1);
});

test('public product pricing rejects fractional or non-positive quantities before pricing', async () => {
  const res = await request(buildApp())
    .post('/api/businesses/7/product-pricing/calculate')
    .send({ productId: 'product-1', quantity: 0.5 });

  expect(res.status).toBe(400);
  expect(pricingEngine.calculatePrice).not.toHaveBeenCalled();
});

test('public product pricing rejects a business that is not publicly visible', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp())
    .post('/api/businesses/7/product-pricing/calculate')
    .send({ productId: 'product-1', quantity: 2 });

  expect(res.status).toBe(404);
  expect(pricingEngine.calculatePrice).not.toHaveBeenCalled();
});
