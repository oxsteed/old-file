'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/businessController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000456',
      email: 'owner@example.com',
    };
    next();
  });
  app.get('/api/businesses/:id/analytics', ctrl.getBusinessAnalytics);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business workspace analytics', () => {
  test('returns zeroed KPIs for an unpublished draft overview', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          business_name: 'Draft Co',
          is_primary: false,
          tax_rate: 25,
          owner_id: '00000000-0000-4000-8000-000000000456',
        }],
      })
      .mockResolvedValue({ rows: [] });

    const res = await request(buildApp()).get('/api/businesses/1/analytics');

    expect(res.status).toBe(200);
    expect(res.body.business_id).toBe(1);
    expect(res.body.monthly).toHaveLength(6);
    expect(res.body.invoices).toEqual(expect.objectContaining({
      outstanding_total: 0,
      overdue_total: 0,
      sent: 0,
      overdue_count: 0,
    }));
    expect(res.body.jobs.completed_6m).toBe(0);
    expect(mockQuery.mock.calls[0][0]).toMatch(/deleted_at IS NULL/);
  });

  test('keeps the overview payload when an analytics source query fails', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          business_name: 'Draft Co',
          is_primary: false,
          tax_rate: 25,
          owner_id: '00000000-0000-4000-8000-000000000456',
        }],
      })
      .mockRejectedValue(new Error('analytics source unavailable'));

    const res = await request(buildApp()).get('/api/businesses/1/analytics');

    expect(res.status).toBe(200);
    expect(res.body.mtd).toEqual(expect.objectContaining({
      revenue: 0,
      expenses: 0,
      profit: 0,
    }));
    expect(res.body.invoices.outstanding_total).toBe(0);
  });

  test('404s analytics when the caller cannot manage the business', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get('/api/businesses/1/analytics');

    expect(res.status).toBe(404);
  });
});
