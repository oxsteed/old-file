'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const {
  replyToReview,
  deleteReply,
  listReviews,
} = require('../controllers/businessReviewManagementController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-123' };
    next();
  });
  app.get('/api/businesses/:businessId/reviews-manage', listReviews);
  app.post('/api/businesses/:businessId/reviews-manage/:reviewId/reply', replyToReview);
  app.delete('/api/businesses/:businessId/reviews-manage/:reviewId/reply', deleteReply);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('business review management backend wiring', () => {
  test('accepts the web client reply payload and self-heals reply columns', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', owner_reply: 'Thanks for the feedback' }] });

    const res = await request(buildApp())
      .post('/api/businesses/12/reviews-manage/review-1/reply')
      .send({ reply: 'Thanks for the feedback' });

    expect(res.status).toBe(200);
    expect(res.body.review.owner_reply).toBe('Thanks for the feedback');
    expect(mockQuery.mock.calls[1][0]).toMatch(/ADD COLUMN IF NOT EXISTS owner_reply/);
    expect(mockQuery.mock.calls[2][1][0]).toBe('Thanks for the feedback');
  });

  test('deletes an owner reply instead of routing to a missing handler', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', owner_reply: null }] });

    const res = await request(buildApp())
      .delete('/api/businesses/12/reviews-manage/review-1/reply');

    expect(res.status).toBe(200);
    expect(res.body.review.owner_reply).toBeNull();
    expect(mockQuery.mock.calls[2][0]).toMatch(/SET owner_reply=NULL/);
  });

  test('applies replied and unreplied filters against stored replies', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'review-1', owner_reply: 'Thank you' }] })
      .mockResolvedValueOnce({ rows: [{ count: '1' }] });

    const res = await request(buildApp())
      .get('/api/businesses/12/reviews-manage?replied=true');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(mockQuery.mock.calls[2][0]).toMatch(/NULLIF\(BTRIM\(r.owner_reply\), ''\) IS NOT NULL/);
  });
});
