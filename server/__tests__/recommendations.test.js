'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const recommendationController = require('../controllers/recommendationController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123', role: 'customer' };
    next();
  });
  app.get('/api/recommendations', recommendationController.getRecommendations);
  app.post('/api/recommendations/:id/dismiss', recommendationController.dismissRecommendation);
  return app;
}

beforeEach(() => resetMocks());

describe('recommendations', () => {
  test('GET /recommendations filters recommendation cards dismissed by the current user', async () => {
    mockQuery.mockImplementation((sql) => {
      if (String(sql).includes('FROM recommendation_dismissals')) {
        return Promise.resolve({
          rows: [{ recommendation_id: 'guide:onboarding-customer' }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(buildApp()).get('/api/recommendations');

    expect(res.status).toBe(200);
    expect(res.body.recommendations).toEqual([]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM recommendation_dismissals'), ['user-123']);
  });

  test('POST /recommendations/:id/dismiss persists a dismissal window', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const res = await request(buildApp())
      .post('/api/recommendations/guide:onboarding-customer/dismiss')
      .send({ days: 21 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      dismissed: 'guide:onboarding-customer',
      days: 21,
    });
    expect(mockQuery.mock.calls[0][0]).toContain('recommendation_dismissals');
    expect(mockQuery.mock.calls[0][1]).toEqual([
      'user-123',
      'guide:onboarding-customer',
      21,
    ]);
  });
});
