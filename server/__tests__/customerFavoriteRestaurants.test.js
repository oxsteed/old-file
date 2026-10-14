'use strict';

/**
 * P2-8-F14: the favorites list endpoints must not surface restaurants an
 * admin has hidden after they were favorited (the toggle already refuses to
 * (re-)favorite hidden restaurants).
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');

const food = require('../controllers/foodController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000123' };
    next();
  });
  app.get('/api/food/customer/favorites', food.listCustomerFavoriteRestaurants);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
});

describe('customer favorite restaurants (P2-8-F14)', () => {
  test('the list query excludes admin-hidden restaurants', async () => {
    mockQuery.mockResolvedValue({ rows: [{ restaurant_id: 11 }] });

    const res = await request(buildApp()).get('/api/food/customer/favorites');

    expect(res.status).toBe(200);
    expect(res.body.favoriteRestaurantIds).toEqual([11]);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/JOIN food_restaurants/);
    expect(sql).toMatch(/is_hidden_by_admin/);
  });
});
