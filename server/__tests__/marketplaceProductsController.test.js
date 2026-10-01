'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const {
  getSearchSuggestions,
  syncFromHomeDepot,
  matchTools,
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
  app.post('/api/marketplace/products/match-tools', matchTools);
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

describe('POST /api/marketplace/products/match-tools', () => {
  test('returns the best in-house match per tool name with a /products URL', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 12, name: 'DEWALT 20V Cordless Drill', price_cents: 9900, product_image_url: 'https://img/x.png', relevance: 0.9 }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/marketplace/products/match-tools')
      .send({ names: ['Cordless Drill', 'Unicorn Glue'] });

    expect(res.status).toBe(200);
    expect(res.body.matches['Cordless Drill']).toMatchObject({
      product_id: 12,
      name: 'DEWALT 20V Cordless Drill',
      price_cents: 9900,
    });
    expect(res.body.matches['Cordless Drill'].url).toBe('/products?search=Cordless%20Drill');
    expect(res.body.matches['Unicorn Glue']).toBeNull();
    // Only available, active products are ever considered.
    expect(mockQuery.mock.calls[0][0]).toMatch(/is_active = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/is_available = TRUE/);
  });

  test('rejects a top hit that does not visibly contain the tool name', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, name: 'Garden Hose Nozzle', price_cents: 1200, product_image_url: null, relevance: 0.4 }],
    });

    const res = await request(buildApp())
      .post('/api/marketplace/products/match-tools')
      .send({ names: ['Hammer'] });

    expect(res.status).toBe(200);
    expect(res.body.matches['Hammer']).toBeNull();
  });

  test('dedupes repeated names into a single query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp())
      .post('/api/marketplace/products/match-tools')
      .send({ names: ['Hammer', 'Hammer', '  Hammer '] });

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(Object.keys(res.body.matches)).toEqual(['Hammer']);
  });

  test('rejects missing, empty, and oversized name lists', async () => {
    for (const body of [{}, { names: [] }, { names: 'Hammer' }, { names: Array(26).fill('Hammer') }, { names: [1, null, 'x'] }]) {
      const res = await request(buildApp())
        .post('/api/marketplace/products/match-tools')
        .send(body);
      expect(res.status).toBe(400);
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
