'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

jest.mock('../services/socketService', () => ({ broadcastToBusinessInbox: jest.fn() }));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: '00000000-0000-4000-8000-000000000123', email: 'owner@example.com' };
    next();
  });
  app.get('/api/food/restaurants', ctrl.listRestaurants);
  app.get('/api/food/markets', ctrl.listMarkets);
  app.post('/api/food/restaurants', ctrl.createRestaurant);
  app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
  app.patch('/api/food/restaurants/:restaurantId/orders/:orderId/status', ctrl.updateOrderStatus);
  app.use(errorHandler);
  return app;
}

beforeEach(() => resetMocks());

describe('food controller', () => {
  test('lists restaurants with country and search filters', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 7, display_name: 'Ox Burger', address_country: 'US' }],
    });

    const res = await request(buildApp())
      .get('/api/food/restaurants?q=burger&country=us');

    expect(res.status).toBe(200);
    expect(res.body.restaurants).toHaveLength(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/FROM food_restaurants fr/);
    expect(mockQuery.mock.calls[0][0]).toMatch(/address_country/);
    expect(mockQuery.mock.calls[0][1]).toContain('US');
  });

  test('returns available markets grouped by city and country', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          address_country: 'United States',
          address_city: 'Columbus',
          currency_code: 'USD',
          restaurant_count: '3',
        },
        {
          address_country: 'CA',
          address_city: 'Montreal',
          currency_code: 'CAD',
          restaurant_count: '1',
        },
      ],
    });

    const res = await request(buildApp()).get('/api/food/markets');

    expect(res.status).toBe(200);
    expect(res.body.markets).toEqual([
      {
        city: 'Columbus',
        country: 'USA',
        countryCode: 'US',
        currencyCode: 'USD',
        distanceUnit: 'miles',
        flag: '🇺🇸',
        restaurantCount: 3,
      },
      {
        city: 'Montreal',
        country: 'Canada',
        countryCode: 'CA',
        currencyCode: 'CAD',
        distanceUnit: 'kilometers',
        flag: '🇨🇦',
        restaurantCount: 1,
      },
    ]);
    expect(mockQuery.mock.calls[0][0]).toMatch(/GROUP BY fr\.address_country, fr\.address_city/);
  });

  test('creates a restaurant and backing business in one transaction', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 9, business_id: 42, display_name: 'Island Grill', status: 'draft' }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants')
      .send({
        displayName: 'Island Grill',
        cuisineTags: ['Caribbean', 'Breakfast'],
        addressCountry: 'HT',
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls[0][0]).toMatch(/INSERT INTO businesses/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO food_restaurants/);
    expect(res.body.restaurant.display_name).toBe('Island Grill');
  });

  test('creates order totals from menu prices and assigns next queue number', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 3,
          business_id: 42,
          accepts_online_orders: true,
          currency_code: 'USD',
          prep_time_min: 12,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: '11', name: 'Classic Burger', price_cents: 899, currency_code: 'USD', is_available: true }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ next_queue: 5 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          queue_number: 5,
          subtotal_cents: 1798,
          total_cents: 1798,
          status: 'received',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 200 }] });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        fulfillmentType: 'pickup',
        items: [{ menuItemId: 11, quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(mockQuery.mock.calls.some(([sql]) => /MAX\(queue_number\)/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_orders/.test(sql))).toBe(true);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO food_order_items/.test(sql))).toBe(true);
  });

  test('replays an existing order when client_order_id matches', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          queue_number: 5,
          metadata: { clientOrderId: 'offline-abc', trackingToken: 'track-xyz' },
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 3, business_id: 42, currency_code: 'USD' }],
      });

    const res = await request(buildApp())
      .post('/api/food/restaurants/3/orders')
      .send({
        client_order_id: 'offline-abc',
        fulfillmentType: 'pickup',
        items: [{ menuItemId: 11, quantity: 1 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.replayed).toBe(true);
    expect(res.body.order.id).toBe(100);
    expect(res.body.trackingToken).toBe('track-xyz');
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test('updates order status through restaurant-scoped access', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 3, business_id: 42, owner_user_id: '00000000-0000-4000-8000-000000000123', effective_role: 'owner' }],
      })
      .mockResolvedValueOnce({
        rows: [{ id: 100, restaurant_id: 3, status: 'ready' }],
      });

    const res = await request(buildApp())
      .patch('/api/food/restaurants/3/orders/100/status')
      .send({ status: 'ready' });

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/JOIN businesses b ON b.id = fr.business_id/);
    expect(mockQuery.mock.calls[1][0]).toMatch(/WHERE id = \$2 AND restaurant_id = \$3/);
    expect(res.body.order.status).toBe('ready');
  });

  test('creates a review for a completed customer order', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: '00000000-0000-4000-8000-000000000123' };
      next();
    });
    app.post('/api/food/orders/:orderId/review', ctrl.createOrderReview);
    app.use(errorHandler);

    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 100,
          restaurant_id: 3,
          customer_id: '00000000-0000-4000-8000-000000000123',
          status: 'completed',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          restaurant_id: 3,
          order_id: 100,
          customer_id: '00000000-0000-4000-8000-000000000123',
          rating: 5,
          body: 'Great',
        }],
      });

    const res = await request(app)
      .post('/api/food/orders/100/review')
      .send({ rating: 5, body: 'Great' });

    expect(res.status).toBe(201);
    expect(res.body.review.rating).toBe(5);
    expect(mockQuery.mock.calls[1][0]).toMatch(/INSERT INTO food_reviews/);
  });

  test('rejects review when order is not completed', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: '00000000-0000-4000-8000-000000000123' };
      next();
    });
    app.post('/api/food/orders/:orderId/review', ctrl.createOrderReview);
    app.use(errorHandler);

    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 100,
        restaurant_id: 3,
        customer_id: '00000000-0000-4000-8000-000000000123',
        status: 'preparing',
      }],
    });

    const res = await request(app)
      .post('/api/food/orders/100/review')
      .send({ rating: 4 });

    expect(res.status).toBe(409);
    expect(res.body.error?.code || res.body.code).toBe('order_not_reviewable');
  });
});
