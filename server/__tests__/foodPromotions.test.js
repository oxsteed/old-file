'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

const OWNER_ID = '00000000-0000-4000-8000-000000000123';
const RESTAURANT_ID = 3;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: OWNER_ID, email: 'owner@example.com' };
    next();
  });
  app.get('/api/food/restaurants/:restaurantId/promotions/manage', ctrl.listMerchantRestaurantPromotions);
  app.post('/api/food/restaurants/:restaurantId/promotions', ctrl.createRestaurantPromotion);
  app.patch('/api/food/restaurants/:restaurantId/promotions/:promotionId', ctrl.updateRestaurantPromotion);
  app.use(errorHandler);
  return app;
}

function mockRestaurantAccess() {
  return {
    rows: [{
      id: RESTAURANT_ID,
      business_id: 42,
      display_name: 'Ox Burger Lab',
      business_owner_id: OWNER_ID,
      owner_user_id: OWNER_ID,
      effective_role: 'owner',
    }],
  };
}

beforeEach(() => resetMocks());

describe('food merchant promotions (B5)', () => {
  test('lists all promotions for merchant management', async () => {
    mockQuery
      .mockResolvedValueOnce(mockRestaurantAccess())
      .mockResolvedValueOnce({
        rows: [{
          id: 9,
          code: 'SUMMER10',
          title: 'Summer special',
          discount_percent: 10,
          discount_cents: null,
          use_count: 2,
          is_active: true,
        }],
      });

    const res = await request(buildApp())
      .get(`/api/food/restaurants/${RESTAURANT_ID}/promotions/manage`);

    expect(res.status).toBe(200);
    expect(res.body.promotions).toHaveLength(1);
    expect(res.body.promotions[0].code).toBe('SUMMER10');
    expect(mockQuery.mock.calls[1][0]).toMatch(/FROM food_restaurant_promotions/);
    expect(mockQuery.mock.calls[1][0]).not.toMatch(/is_active = TRUE/);
  });

  test('creates a promotion with uppercase code', async () => {
    mockQuery
      .mockResolvedValueOnce(mockRestaurantAccess())
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          restaurant_id: RESTAURANT_ID,
          code: 'WELCOME5',
          title: 'Welcome offer',
          discount_cents: 500,
          is_active: true,
        }],
      });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/promotions`)
      .send({
        code: 'welcome5',
        title: 'Welcome offer',
        discountCents: 500,
      });

    expect(res.status).toBe(201);
    expect(res.body.promotion.code).toBe('WELCOME5');
    expect(mockQuery.mock.calls[1][1][1]).toBe('WELCOME5');
  });

  test('deactivates a promotion', async () => {
    mockQuery
      .mockResolvedValueOnce(mockRestaurantAccess())
      .mockResolvedValueOnce({
        rows: [{
          id: 10,
          restaurant_id: RESTAURANT_ID,
          code: 'WELCOME5',
          is_active: false,
        }],
      });

    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/promotions/10`)
      .send({ isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.promotion.is_active).toBe(false);
    expect(mockQuery.mock.calls[1][0]).toMatch(/UPDATE food_restaurant_promotions/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/is_active/);
  });
});
