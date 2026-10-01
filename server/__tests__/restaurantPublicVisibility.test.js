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
  expect(sql).toMatch(/fr\.discovery_status = 'visible'/);
  expect(sql).toMatch(/b\.is_active = TRUE/);
  expect(sql).toMatch(/b\.deleted_at IS NULL/);
}

function expectPublicPublicationGuard(sql) {
  expectActiveBusinessGuard(sql);
  expect(sql).toMatch(/fr\.discovery_status = 'visible'/);
  expect(sql).toMatch(/b\.is_listed = TRUE/);
  expect(sql).toMatch(/COALESCE\(b\.business_kind, 'restaurant'\) = 'restaurant'/);
}

function findPublicationGuardSql() {
  const call = mockQuery.mock.calls.find(([sql]) =>
    String(sql).includes('JOIN businesses b ON b.id = fr.business_id')
  );
  expect(call).toBeTruthy();
  return call[0];
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
    expectActiveBusinessGuard(findPublicationGuardSql());
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
    expectPublicPublicationGuard(findPublicationGuardSql());
  });

  test('direct restaurant lookup applies the public publication guard', async () => {
    const res = await request(buildApp()).get('/api/food/restaurants/3');

    expect(res.status).toBe(404);
    const sql = findPublicationGuardSql();
    expectPublicPublicationGuard(sql);
  });

  test.each([
    ['/api/food/restaurants/3/promotions', 'get', 200],
    ['/api/food/restaurants/3/locations', 'get', 404],
    ['/api/food/restaurants/3/kiosk-config', 'get', 404],
    ['/api/food/restaurants/3/orders/quote', 'post', 404],
    ['/api/food/restaurants/3/orders', 'post', 404],
  ])('%s applies the public publication guard', async (path, method, expectedStatus) => {
    const req = request(buildApp())[method](path);
    // H12: food orders require an idempotency key; supply one so the request
    // reaches the publication guard instead of failing validation first.
    if (method === 'post' && path.endsWith('/orders')) {
      req.set('Idempotency-Key', 'test-guard-key-1');
    }
    const res = await req.send(method === 'post' && path.endsWith('/quote')
        ? { items: [{ menuItemId: 11, quantity: 1 }] }
        : method === 'post' ? { fulfillmentType: 'pickup', items: [{ menuItemId: 11, quantity: 1 }] } : undefined);

    expect(res.status).toBe(expectedStatus);
    expectPublicPublicationGuard(findPublicationGuardSql());
  });

  test('public promotions cannot leak from an inactive business', async () => {
    const res = await request(buildApp()).get('/api/food/restaurants/3/promotions');

    expect(res.status).toBe(200);
    expect(res.body.promotions).toEqual([]);
    expectActiveBusinessGuard(findPublicationGuardSql());
  });

  test('public queue board keeps guest names hidden unless explicitly enabled', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          display_name: 'Ox Burger Lab',
          logo_url: null,
          settings: { queueBoard: { showGuestNames: false } },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          queue_number: 12,
          status: 'ready',
          guest_name: 'Alice Smith',
          table_label: null,
          fulfillment_type: 'pickup',
          promised_at: null,
          completed_at: null,
          handed_off_at: null,
          metadata: {},
        }],
      });

    const res = await request(buildApp()).get('/api/food/restaurants/3/queue-board');

    expect(res.status).toBe(200);
    expect(res.body.readyEntries[0].guestLabel).toBe('Guest');
  });

  test('quote and order creation stop at the active-business guard', async () => {
    const quote = await request(buildApp())
      .post('/api/food/restaurants/3/orders/quote')
      .send({ items: [{ menuItemId: 11, quantity: 1 }] });

    expect(quote.status).toBe(404);
    expectActiveBusinessGuard(findPublicationGuardSql());

    resetMocks();
    const order = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .set('Idempotency-Key', 'test-guard-key-2')
      .send({ fulfillmentType: 'pickup', items: [{ menuItemId: 11, quantity: 1 }] });

    expect(order.status).toBe(404);
    expectActiveBusinessGuard(findPublicationGuardSql());
  });
});
