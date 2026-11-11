'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const reviews = require('../controllers/reviewsController');

function buildApp() {
  const app = express();
  app.get('/api/business-reviews/:businessId', reviews.getBusinessReviews);
  app.get('/api/business-reviews/:businessId/stats', reviews.getReviewStats);
  return app;
}

beforeEach(() => resetMocks());

describe('public business review visibility', () => {
  test.each([
    '/api/business-reviews/2',
    '/api/business-reviews/2/stats',
  ])('%s rejects a non-public business before reading reviews', async (path) => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(buildApp()).get(path);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN users u ON u\.id = b\.user_id/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/b\.is_listed = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/u\.email_verified = TRUE/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/u\.onboarding_completed = TRUE/);
  });

  test('returns reviews only after the public business gate passes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ business_id: 1, owner_id: 'owner-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, rating: 5, testimonial: 'Excellent service' }] })
      .mockResolvedValueOnce({ rows: [{ total: '1', avg_rating: '5', five_star_count: '1', four_star_count: '0', three_star_count: '0', two_star_count: '0', one_star_count: '0' }] });

    const res = await request(buildApp()).get('/api/business-reviews/1');

    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(mockQuery.mock.calls[1][0]).toMatch(/FROM business_reviews br/);
  });

  test('returns stats only after the public business gate passes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ business_id: 1, owner_id: 'owner-1' }] })
      .mockResolvedValueOnce({ rows: [{ total_reviews: '1', avg_rating: '5', five_star_count: '1', four_star_count: '0', three_star_count: '0', two_star_count: '0', one_star_count: '0' }] });

    const res = await request(buildApp()).get('/api/business-reviews/1/stats');

    expect(res.status).toBe(200);
    expect(res.body.total_reviews).toBe(1);
    expect(mockQuery.mock.calls[1][0]).toMatch(/FROM business_reviews/);
  });
});
