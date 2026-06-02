'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/businessMarketingController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.post('/api/businesses/:businessId/broadcasts', ctrl.createBroadcast);
  app.post('/api/businesses/:businessId/broadcasts/:id/send', ctrl.sendBroadcast);
  app.delete('/api/businesses/:businessId/broadcasts/:id', ctrl.deleteBroadcast);
  app.post('/api/businesses/:businessId/promo-codes', ctrl.createPromoCode);
  app.post('/api/businesses/:businessId/featured-placement-requests', ctrl.requestFeaturedPlacement);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business marketing actions', () => {
  test('creates a broadcast draft with legacy and current message columns', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '4' }] })
      .mockResolvedValueOnce({ rows: [{ id: 10, subject: 'Open slots', status: 'draft' }] });

    const res = await request(buildApp())
      .post('/api/businesses/12/broadcasts')
      .send({ subject: 'Open slots', message: 'Two openings Friday.', channel: 'sms', audience: 'all' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe(10);

    const [sql, params] = mockQuery.mock.calls[1];
    expect(sql).toMatch(/body, message/);
    expect(params).toEqual(['12', 'Open slots', 'Two openings Friday.', 'sms', 'all', 4, undefined, 'draft']);
  });

  test('send broadcast uses the route id parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 22, status: 'sent' }] });

    const res = await request(buildApp())
      .post('/api/businesses/12/broadcasts/22/send')
      .send({});

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['22', '12']);
  });

  test('delete broadcast uses the route id parameter', async () => {
    const res = await request(buildApp())
      .delete('/api/businesses/12/broadcasts/22');

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][1]).toEqual(['22', '12']);
  });

  test('creates a promo code with safe defaults and date compatibility', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 5, code: 'SPRING10' }] });

    const res = await request(buildApp())
      .post('/api/businesses/12/promo-codes')
      .send({
        code: 'spring10',
        discount_type: 'percent',
        discount_value: 10,
        expires_at: '2026-07-01T00:00:00.000Z',
        description: 'Spring offer',
      });

    expect(res.status).toBe(201);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[1]).toBe('SPRING10');
    expect(params[4]).toBe(0);
    expect(params[6]).toBe('2026-07-01T00:00:00.000Z');
    expect(params[7]).toBe('2026-07-01');
  });

  test('creates or refreshes a featured placement request', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 3, business_id: 12, status: 'requested' }],
    });

    const res = await request(buildApp())
      .post('/api/businesses/12/featured-placement-requests')
      .send({ category: 'home repair', zip: '94107', note: 'Ready to pilot' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('requested');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      '12',
      'user-123',
      'home repair',
      '94107',
      'Ready to pilot',
      'promote_page',
    ]);
  });
});
