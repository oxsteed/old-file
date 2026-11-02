'use strict';

/**
 * Customer ordering journey (restaurant-side Track A).
 *
 * Covers the new customer-facing food surfaces:
 *  - listMyOrders pagination shape { orders, total, limit, offset, stats }
 *    with page-independent stats and an allowlisted status filter
 *  - listRestaurantReviews pagination, total, rating breakdown, 404
 *  - getFoodCancelPreview refund math, cancellability, and ownership
 *    (signed-in customer and guest tracking token)
 *  - listRestaurants open_now / fulfillment filter plumbing
 *
 * Cancel execution (cancelMyFoodOrder) runs inside withTransaction, which
 * the pg mock cannot exercise end to end; it is covered by the preview
 * tests above plus the shared refund helpers' own suites.
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000123';
const OTHER_ID = '00000000-0000-4000-8000-000000000999';

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.user = user;
    next();
  });
  app.get('/api/food/my/orders', ctrl.listMyOrders);
  app.get('/api/food/restaurants/:restaurantId/reviews', ctrl.listRestaurantReviews);
  app.get('/api/food/orders/:orderId/cancel-preview', ctrl.getFoodCancelPreview);
  app.get('/api/food/restaurants', ctrl.listRestaurants);
  app.use(errorHandler);
  return app;
}

function orderRow(overrides = {}) {
  return {
    id: 100,
    restaurant_id: 3,
    customer_id: CUSTOMER_ID,
    status: 'accepted',
    payment_status: 'paid',
    total_cents: 2500,
    currency_code: 'USD',
    metadata: { paymentMode: 'wallet_credit', trackingToken: 'guest-tok-1' },
    items: [],
    ...overrides,
  };
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('listMyOrders pagination', () => {
  test('returns orders, total, limit, offset and page-independent stats', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { ...orderRow(), total_count: 5 },
        { ...orderRow({ id: 101 }), total_count: 5 },
      ] })
      .mockResolvedValueOnce({ rows: [{ total: 11, completed: 7, cancelled: 2, active: 2 }] });
    const res = await request(buildApp({ id: CUSTOMER_ID }))
      .get('/api/food/my/orders?limit=2&offset=2');
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(2);
    expect(res.body.total).toBe(5);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(2);
    expect(res.body.stats).toEqual({ total: 11, completed: 7, cancelled: 2, active: 2 });
  });

  test('caps limit at 100 and applies the allowlisted status filter', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: 0, completed: 0, cancelled: 0, active: 0 }] });
    const res = await request(buildApp({ id: CUSTOMER_ID }))
      .get('/api/food/my/orders?limit=500&status=completed');
    expect(res.status).toBe(200);
    const pageSql = String(mockQuery.mock.calls[0][0]);
    expect(pageSql).toContain(`status IN ('completed', 'delivered', 'picked_up')`);
    expect(mockQuery.mock.calls[0][1]).toEqual([CUSTOMER_ID, 100, 0]);
    // The stats query stays global: it must not inherit the page filter in
    // its WHERE clause (the completed/cancelled/active buckets legitimately
    // name those statuses inside COUNT FILTER expressions).
    const statsSql = String(mockQuery.mock.calls[1][0]);
    expect(statsSql).toContain('WHERE customer_id = $1');
    expect(statsSql).not.toContain('fo.status');
  });

  test('carries modifier ids and names on history items', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{
        ...orderRow(),
        total_count: 1,
        items: [{ menuItemId: 11, itemName: 'Burger', modifierIds: [5], modifierNames: ['Extra cheese'] }],
      }] })
      .mockResolvedValueOnce({ rows: [{ total: 1, completed: 0, cancelled: 0, active: 1 }] });
    const res = await request(buildApp({ id: CUSTOMER_ID })).get('/api/food/my/orders');
    expect(res.body.orders[0].items[0].modifierIds).toEqual([5]);
    expect(res.body.orders[0].items[0].modifierNames).toEqual(['Extra cheese']);
  });
});

describe('listRestaurantReviews', () => {
  test('returns paginated reviews with total and a full rating breakdown', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 3 }] })
      .mockResolvedValueOnce({ rows: [
        { id: 9, rating: 5, body: 'Great', response: null, responded_at: null, created_at: '2026-11-01T00:00:00Z', reviewer_name: 'Sam', total_count: 3 },
        { id: 8, rating: 4, body: 'Good', response: 'Thanks', responded_at: '2026-11-01T01:00:00Z', created_at: '2026-10-31T00:00:00Z', reviewer_name: null, total_count: 3 },
      ] })
      .mockResolvedValueOnce({ rows: [{ five: 2, four: 1, three: 0, two: 0, one: 0 }] });
    const res = await request(buildApp(null)).get('/api/food/restaurants/3/reviews?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.limit).toBe(50);
    expect(res.body.ratingBreakdown).toEqual({ 5: 2, 4: 1, 3: 0, 2: 0, 1: 0 });
    expect(res.body.reviews[0]).not.toHaveProperty('total_count');
  });

  test('404s for a restaurant that is not public-visible', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp(null)).get('/api/food/restaurants/3/reviews');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('restaurant_not_found');
  });
});

describe('getFoodCancelPreview', () => {
  test('previews a full refund for a paid, cancellable wallet order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [orderRow()] });
    const res = await request(buildApp({ id: CUSTOMER_ID })).get('/api/food/orders/100/cancel-preview');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      orderId: 100, status: 'accepted', paymentStatus: 'paid',
      paymentMode: 'wallet_credit', totalCents: 2500,
      cancellable: true, refundCents: 2500, refundMethod: 'wallet_credit',
    });
  });

  test('reports no refund for an unpaid pay-at-restaurant order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [orderRow({
      payment_status: 'unpaid',
      metadata: { paymentMode: 'pay_at_restaurant' },
    })] });
    const res = await request(buildApp({ id: CUSTOMER_ID })).get('/api/food/orders/100/cancel-preview');
    expect(res.body.cancellable).toBe(true);
    expect(res.body.refundCents).toBe(0);
    expect(res.body.refundMethod).toBeNull();
  });

  test('marks a completed order not cancellable with zero refund', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [orderRow({ status: 'completed' })] });
    const res = await request(buildApp({ id: CUSTOMER_ID })).get('/api/food/orders/100/cancel-preview');
    expect(res.body.cancellable).toBe(false);
    expect(res.body.refundCents).toBe(0);
    expect(res.body.reasonCode).toBe('order_not_cancellable');
  });

  test('404s for a signed-in user who does not own the order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [orderRow()] });
    const res = await request(buildApp({ id: OTHER_ID })).get('/api/food/orders/100/cancel-preview');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('order_not_found');
  });

  test('admits a guest with a matching tracking token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [orderRow({ customer_id: null })] });
    const res = await request(buildApp(null)).get('/api/food/orders/100/cancel-preview?trackingToken=guest-tok-1');
    expect(res.status).toBe(200);
    expect(res.body.cancellable).toBe(true);
  });

  test('rejects a guest with a wrong tracking token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [orderRow({ customer_id: null })] });
    const res = await request(buildApp(null)).get('/api/food/orders/100/cancel-preview?trackingToken=nope');
    expect(res.status).toBe(404);
  });
});

describe('listRestaurants discovery filters', () => {
  test('adds open-now and fulfillment fragments to the main query', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 3, display_name: 'Test', total_count: 1 }] });
    const res = await request(buildApp(null)).get('/api/food/restaurants?open_now=true&fulfillment=delivery');
    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toContain('fr.is_accepting_orders_now = TRUE');
    expect(String(sql)).toContain('temporarily_closed_until IS NULL OR fr.temporarily_closed_until <= NOW()');
    expect(String(sql)).toContain('= ANY(fr.fulfillment_modes)');
    expect(params).toContain('delivery');
  });

  test('omits both fragments without the filters and ignores an invalid fulfillment value', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const res = await request(buildApp(null)).get('/api/food/restaurants?fulfillment=rocket');
    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0];
    expect(String(sql)).not.toContain('fr.is_accepting_orders_now = TRUE');
    expect(String(sql)).not.toContain('= ANY(fr.fulfillment_modes)');
  });
});
