'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const affiliatePayoutsController = require('../controllers/affiliatePayoutsController');
const affiliateAnalyticsController = require('../controllers/AffiliateAnalyticsController');
const { errorHandler } = require('../middleware/errorHandler');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.post('/api/affiliate/calculate', affiliatePayoutsController.calculateAndCreatePayout);
  app.get('/api/affiliate/:program_id/analytics/products', affiliateAnalyticsController.getTopProducts);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('affiliate dashboard backend wiring', () => {
  test('POST /affiliate/calculate creates payout inside a transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7, helper_id: 'user-123' }] })
      .mockResolvedValueOnce({ rows: [{ total_cents: 2500, count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ id: 11, total_commission_cents: 2500, commission_count: 2 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/affiliate/calculate')
      .send({
        programId: 7,
        periodStart: '2026-06-01T00:00:00.000Z',
        periodEnd: '2026-06-02T00:00:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(11);
    expect(mockQuery.mock.calls[2][0]).toContain('INSERT INTO affiliate_payouts');
    expect(mockQuery.mock.calls[3][0]).toContain('UPDATE affiliate_commissions');
    expect(mockQuery.mock.calls[4][0]).toContain('UPDATE affiliate_programs');
  });

  test('GET /affiliate/:id/analytics/products uses safe params and marketplace product name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 7 }] })
      .mockResolvedValueOnce({
        rows: [{
          rank: 1,
          product_id: 'product-123',
          title: 'HVAC Filter',
          total_clicks_30d: 12,
          total_conversions_30d: 2,
        }],
      });

    const res = await request(buildApp())
      .get('/api/affiliate/7/analytics/products')
      .query({ days: '30; DROP TABLE users;', limit: 8 });

    expect(res.status).toBe(200);
    expect(res.body.top_products).toHaveLength(1);
    expect(mockQuery.mock.calls[1][0]).toContain('mp.name as title');
    expect(mockQuery.mock.calls[1][0]).not.toContain('DROP TABLE');
    expect(mockQuery.mock.calls[1][1]).toEqual(expect.arrayContaining(['7', 8]));
  });
});
