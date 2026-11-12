'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const food = require('../controllers/foodController');

function buildApp() {
  const app = express();
  app.post('/api/food/restaurants/:restaurantId/campaign-click', food.trackCampaignClick);
  return app;
}

beforeEach(() => resetMocks());

test('campaign click beacon does not attribute hidden or unavailable restaurants', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [] });

  const res = await request(buildApp()).post('/api/food/restaurants/7/campaign-click');
  await new Promise((resolve) => setImmediate(resolve));

  expect(res.status).toBe(204);
  expect(mockQuery).toHaveBeenCalledTimes(1);
  expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN users owner ON owner\.id = b\.user_id/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/fr\.discovery_status = 'visible'/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/owner\.email_verified = TRUE/);
  expect(mockQuery.mock.calls[0][0]).toMatch(/owner\.onboarding_completed = TRUE/);
});
