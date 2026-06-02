'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const {
  getSearchSuggestions,
  syncFromHomeDepot,
} = require('../controllers/marketplaceProductsController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-123', role: 'admin' };
    next();
  });
  app.get('/api/marketplace/products/suggestions', getSearchSuggestions);
  app.post('/api/marketplace/products/sync-homedepot', syncFromHomeDepot);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  delete process.env.HOME_DEPOT_PRODUCT_FEED_URL;
  delete process.env.HOME_DEPOT_API_KEY;
});

describe('marketplace products backend wiring', () => {
  test('returns product-backed search suggestions', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { label: 'Cordless Drill', category: 'Power Tools' },
        { label: 'Impact Driver', category: 'Power Tools' },
      ],
    });

    const res = await request(buildApp()).get('/api/marketplace/products/suggestions?q=drill');

    expect(res.status).toBe(200);
    expect(res.body.suggestions).toEqual([
      { label: 'Cordless Drill', value: 'Cordless Drill', category: 'Power Tools', type: 'product' },
      { label: 'Impact Driver', value: 'Impact Driver', category: 'Power Tools', type: 'product' },
    ]);
    expect(mockQuery.mock.calls[0][0]).toMatch(/marketplace_products/);
  });

  test('does not pretend Home Depot sync succeeded when integration is missing', async () => {
    const res = await request(buildApp()).post('/api/marketplace/products/sync-homedepot');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Home Depot sync is not configured/);
  });

  test('acknowledges Home Depot sync only when a source is configured', async () => {
    process.env.HOME_DEPOT_PRODUCT_FEED_URL = 'https://feeds.example.test/homedepot.json';

    const res = await request(buildApp()).post('/api/marketplace/products/sync-homedepot');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/configuration found/);
    expect(res.body.nextStep).toMatch(/feed worker/);
  });
});
