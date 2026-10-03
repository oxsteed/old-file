'use strict';

/**
 * Food ordering-flow validation guards (server side).
 *
 * Covers the fixes for the restaurant customer ordering flow:
 *  - delivery address cannot be blank or the restaurant's own address
 *  - createOrder honors the manual pause flags (is_accepting_orders_now,
 *    temporarily_closed_until)
 *  - createOrder enforces the restaurant minimum order
 *  - deliverySlot is validated against an allowlist and shifts promised_at
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));

function buildApp(user = { id: '00000000-0000-4000-8000-000000000123', email: 'customer@example.com' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
  app.use(errorHandler);
  return app;
}

const RESTAURANT_ID = 3;
const MENU_ITEM_ID = 11;

function restaurantRow(overrides = {}) {
  return {
    id: RESTAURANT_ID,
    business_id: 42,
    display_name: 'Ox Burger Lab',
    status: 'active',
    discovery_status: 'visible',
    accepts_online_orders: true,
    accepts_in_store_orders: true,
    currency_code: 'USD',
    prep_time_min: 12,
    operating_hours: null,
    timezone: 'America/New_York',
    fulfillment_modes: ['pickup', 'delivery'],
    address_street: '999 Restaurant Row',
    address_city: 'Springfield',
    is_accepting_orders_now: true,
    temporarily_closed_until: null,
    minimum_order_cents: 0,
    tax_rate_bps: 0,
    service_fee_bps: 0,
    settings: {},
    ...overrides,
  };
}

function menuItemRow(overrides = {}) {
  return {
    id: MENU_ITEM_ID,
    name: 'Classic Burger',
    price_cents: 899,
    currency_code: 'USD',
    is_available: true,
    modifier_groups: [],
    ...overrides,
  };
}

function createdOrderRow(overrides = {}) {
  return {
    id: 100,
    restaurant_id: RESTAURANT_ID,
    business_id: 42,
    customer_id: '00000000-0000-4000-8000-000000000123',
    guest_name: null,
    order_source: 'web',
    fulfillment_type: 'pickup',
    payment_status: 'unpaid',
    subtotal_cents: 899,
    total_cents: 899,
    queue_number: 7,
    status: 'received',
    metadata: { paymentMode: 'pay_at_restaurant', trackingToken: 'track-test-1' },
    ...overrides,
  };
}

const BASE_BODY = {
  orderSource: 'web',
  fulfillmentType: 'pickup',
  paymentMode: 'pay_at_restaurant',
  items: [{ menuItemId: MENU_ITEM_ID, quantity: 1 }],
};

// Queue the standard pre-INSERT mocks: idempotency lookup, restaurant
// FOR UPDATE, idempotency recheck, menu items.
function mockPreInsert(restaurantOverrides = {}, menuOverrides = {}) {
  mockQuery
    .mockResolvedValueOnce({ rows: [] }) // idempotency replay lookup (pre-lock)
    .mockResolvedValueOnce({ rows: [restaurantRow(restaurantOverrides)] }) // restaurant FOR UPDATE
    .mockResolvedValueOnce({ rows: [] }) // idempotency replay recheck (post-lock)
    .mockResolvedValueOnce({ rows: [menuItemRow(menuOverrides)] }); // menu items
}

function orderInsertCall() {
  const call = mockQuery.mock.calls.find(([sql]) => /INSERT INTO food_orders/.test(String(sql)));
  expect(call).toBeDefined();
  return call;
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('food order validation guards', () => {
  test('rejects a delivery order whose address is the restaurant address (400 delivery_address_is_restaurant)', async () => {
    mockPreInsert();
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'addr-restaurant-1')
      .send({
        ...BASE_BODY,
        fulfillmentType: 'delivery',
        deliveryAddress: { line1: '999 Restaurant Row', city: 'Springfield' },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('delivery_address_is_restaurant');
  });

  test('rejects a delivery order whose address is the restaurant address regardless of case (400)', async () => {
    mockPreInsert();
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'addr-restaurant-2')
      .send({
        ...BASE_BODY,
        fulfillmentType: 'delivery',
        deliveryAddress: { line1: '  999 restaurant ROW  ' },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('delivery_address_is_restaurant');
  });

  test('rejects a delivery order with a blank address line (400 delivery_address_required)', async () => {
    mockPreInsert();
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'addr-blank-1')
      .send({
        ...BASE_BODY,
        fulfillmentType: 'delivery',
        deliveryAddress: { line1: '   ' },
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('delivery_address_required');
  });

  test('rejects a delivery order with no delivery address object (400 delivery_address_required)', async () => {
    mockPreInsert();
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'addr-missing-1')
      .send({ ...BASE_BODY, fulfillmentType: 'delivery' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('delivery_address_required');
  });

  test('accepts a delivery order with a real customer address', async () => {
    mockPreInsert();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ next_queue: 7 }] })
      .mockResolvedValueOnce({ rows: [createdOrderRow({ fulfillment_type: 'delivery' })] })
      .mockResolvedValueOnce({ rows: [{ id: 501 }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'addr-real-1')
      .send({
        ...BASE_BODY,
        fulfillmentType: 'delivery',
        deliveryAddress: { line1: '123 Customer Lane', city: 'Springfield' },
      });

    expect(res.status).toBe(201);
    expect(res.body.replayed).toBe(false);
  });

  test('rejects when the restaurant paused online orders (409 restaurant_not_accepting_orders)', async () => {
    mockPreInsert({ is_accepting_orders_now: false });
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'paused-flag-1')
      .send(BASE_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_not_accepting_orders');
  });

  test('rejects when temporarily_closed_until is in the future (409 restaurant_not_accepting_orders)', async () => {
    mockPreInsert({ temporarily_closed_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'paused-until-1')
      .send(BASE_BODY);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('restaurant_not_accepting_orders');
  });

  test('allows orders after a past temporarily_closed_until', async () => {
    mockPreInsert({
      temporarily_closed_until: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ next_queue: 7 }] })
      .mockResolvedValueOnce({ rows: [createdOrderRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 501 }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'paused-past-1')
      .send(BASE_BODY);

    expect(res.status).toBe(201);
  });

  test('rejects an order below the restaurant minimum (400 minimum_order_not_met)', async () => {
    mockPreInsert({ minimum_order_cents: 2000 });
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'min-order-1')
      .send(BASE_BODY); // subtotal 899 < 2000

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('minimum_order_not_met');
    expect(res.body.fields.minimumOrderCents).toBe(2000);
  });

  test('accepts an order that meets the restaurant minimum', async () => {
    mockPreInsert({ minimum_order_cents: 899 });
    mockQuery
      .mockResolvedValueOnce({ rows: [{ next_queue: 7 }] })
      .mockResolvedValueOnce({ rows: [createdOrderRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 501 }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'min-order-2')
      .send(BASE_BODY); // subtotal 899 == 899

    expect(res.status).toBe(201);
  });

  test('honors deliverySlot by shifting promised_at (prep + slot offset)', async () => {
    mockPreInsert();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ next_queue: 7 }] })
      .mockResolvedValueOnce({ rows: [createdOrderRow({ fulfillment_type: 'delivery' })] })
      .mockResolvedValueOnce({ rows: [{ id: 501 }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'slot-plus15-1')
      .send({
        ...BASE_BODY,
        fulfillmentType: 'delivery',
        deliverySlot: '+15',
        deliveryAddress: { line1: '123 Customer Lane', city: 'Springfield' },
      });

    expect(res.status).toBe(201);
    const [, values] = orderInsertCall();
    // prep_time_min (12) + slot offset (15) = 27 minutes
    expect(values[21]).toBe(27);
    // the chosen slot is recorded in metadata
    expect(values[23]).toMatchObject({ deliverySlot: '+15' });
  });

  test('asap slot adds no offset to promised_at', async () => {
    mockPreInsert();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ next_queue: 7 }] })
      .mockResolvedValueOnce({ rows: [createdOrderRow()] })
      .mockResolvedValueOnce({ rows: [{ id: 501 }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'slot-asap-1')
      .send({ ...BASE_BODY, deliverySlot: 'asap' });

    expect(res.status).toBe(201);
    const [, values] = orderInsertCall();
    expect(values[21]).toBe(12); // prep_time_min only
  });

  test('rejects an unknown deliverySlot value (400 validation_failed)', async () => {
    mockPreInsert();
    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'slot-bad-1')
      .send({ ...BASE_BODY, deliverySlot: 'tomorrow-morning' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.deliverySlot).toBeDefined();
  });
});
