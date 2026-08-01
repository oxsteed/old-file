'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const food = require('../controllers/foodController');
const kiosk = require('../controllers/restaurantKioskController');
const appFlow = require('../controllers/restaurantAppFlowController');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/api/food/markets', food.listMarkets);
  app.get('/api/food/restaurants', food.listRestaurants);
  app.get('/api/food/restaurants/:restaurantId', food.getRestaurant);
  app.get('/api/food/restaurants/:restaurantId/queue-board', food.getQueueBoard);
  app.get('/api/food/restaurants/:restaurantId/promotions', food.listRestaurantPromotions);
  app.get('/api/food/restaurants/:restaurantId/locations', food.listRestaurantLocations);
  app.get('/api/food/restaurants/:restaurantId/kiosk-config', kiosk.getPublicKioskConfig);
  app.get('/api/restaurants/:restaurantId/display/queue-board', appFlow.getPublicDisplayQueueBoard);
  app.post('/api/food/restaurants/:restaurantId/orders/quote', food.quoteOrder);
  app.post('/api/food/restaurants/:restaurantId/orders', food.createOrder);
  app.use(errorHandler);
  return app;
}

function expectActiveBusinessGuard(sql) {
  expect(sql).toMatch(/JOIN businesses b ON b\.id = fr\.business_id/);
  expect(sql).toMatch(/b\.is_active = TRUE/);
  expect(sql).toMatch(/b\.deleted_at IS NULL/);
}

beforeEach(() => resetMocks());

describe('public restaurant visibility', () => {
  test.each([
    ['/api/food/markets', 'markets'],
    ['/api/food/restaurants', 'restaurants'],
  ])('%s excludes restaurants whose business is inactive', async (path, responseKey) => {
    const res = await request(buildApp()).get(path);

    expect(res.status).toBe(200);
    expect(res.body[responseKey]).toEqual([]);
    expectActiveBusinessGuard(mockQuery.mock.calls[0][0]);
  });

  test.each([
    ['/api/food/restaurants/3', 'get'],
    ['/api/food/restaurants/3/queue-board', 'get'],
    ['/api/food/restaurants/3/locations', 'get'],
    ['/api/food/restaurants/3/kiosk-config', 'get'],
    ['/api/restaurants/3/display/queue-board', 'get'],
  ])('%s returns not found when no active linked business exists', async (path, method) => {
    const res = await request(buildApp())[method](path);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
    expectActiveBusinessGuard(mockQuery.mock.calls[0][0]);
  });

  test('public promotions cannot leak from an inactive business', async () => {
    const res = await request(buildApp()).get('/api/food/restaurants/3/promotions');

    expect(res.status).toBe(200);
    expect(res.body.promotions).toEqual([]);
    expectActiveBusinessGuard(mockQuery.mock.calls[0][0]);
  });

  test('quote and order creation stop at the active-business guard', async () => {
    const quote = await request(buildApp())
      .post('/api/food/restaurants/3/orders/quote')
      .send({ items: [{ menuItemId: 11, quantity: 1 }] });

    expect(quote.status).toBe(404);
    expectActiveBusinessGuard(mockQuery.mock.calls[0][0]);

    resetMocks();
    const order = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({ fulfillmentType: 'pickup', items: [{ menuItemId: 11, quantity: 1 }] });

    expect(order.status).toBe(404);
    expectActiveBusinessGuard(mockQuery.mock.calls[0][0]);
  });
});
