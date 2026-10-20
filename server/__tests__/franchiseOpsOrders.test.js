'use strict';

// Franchise review F-11 (dayparts + scheduled orders), F-33 (order pacing)
// and F-20 (audit trail) coverage for the food ordering surface.
// Mock-pool harness mirrors foodOrderValidation.test.js.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

jest.mock('../services/socketService', () => ({
  broadcastToBusinessInbox: jest.fn(),
  broadcastToRestaurantDisplay: jest.fn(),
}));

const USER = { id: '00000000-0000-4000-8000-000000000123', email: 'customer@example.com' };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = USER;
    next();
  });
  app.post('/api/food/restaurants/:restaurantId/orders/quote', ctrl.quoteOrder);
  app.post('/api/food/restaurants/:restaurantId/orders', ctrl.createOrder);
  app.patch('/api/food/restaurants/:restaurantId/menu-items/:itemId', ctrl.updateMenuItem);
  app.patch('/api/food/restaurants/:restaurantId', ctrl.updateRestaurant);
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
    timezone: 'UTC',
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
    availability_schedule: {},
    category_name: 'Burgers',
    modifier_groups: [],
    ...overrides,
  };
}

function createdOrderRow(overrides = {}) {
  return {
    id: 100,
    restaurant_id: RESTAURANT_ID,
    business_id: 42,
    customer_id: USER.id,
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

// A schedule that is closed at every instant: a single Monday 00:00-00:00
// entry makes the weekly schedule exist while covering nothing.
const NEVER_AVAILABLE = { weekly: { mon: { open: '00:00', close: '00:00' } } };
// A schedule covering the whole of every day.
const ALWAYS_AVAILABLE = {
  weekly: Object.fromEntries(
    ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, { open: '00:00', close: '23:59' }])
  ),
};

function mockOrderSuccess() {
  // Integrated createOrder tail (F-18 short lock + F-32 counter): the
  // restaurant id lock, the authoritative idempotency recheck under it,
  // the atomic queue-counter allocation, then the order and item inserts.
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: RESTAURANT_ID }] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ last_queue_number: 7 }] })
    .mockResolvedValueOnce({ rows: [createdOrderRow()] })
    .mockResolvedValueOnce({ rows: [{ id: 501 }] });
  mockQuery.mockResolvedValue({ rows: [] });
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('F-11 daypart enforcement', () => {
  test('quoteOrder rejects an item outside its daypart window', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow()] })
      .mockResolvedValueOnce({ rows: [menuItemRow({ availability_schedule: NEVER_AVAILABLE })] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders/quote`)
      .send(BASE_BODY);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields['items.0.menuItemId']).toMatch(/not available at this time of day/);
  });

  test('quoteOrder accepts an item inside its daypart window', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [restaurantRow()] })
      .mockResolvedValueOnce({ rows: [menuItemRow({ availability_schedule: ALWAYS_AVAILABLE })] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders/quote`)
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.quote.totalCents).toBe(899);
  });

  test('createOrder rejects an item outside its daypart window', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // idempotency lookup
      .mockResolvedValueOnce({ rows: [restaurantRow()] }) // restaurant FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // idempotency recheck
      .mockResolvedValueOnce({ rows: [menuItemRow({ availability_schedule: NEVER_AVAILABLE })] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'daypart-closed-1')
      .send(BASE_BODY);

    expect(res.status).toBe(400);
    expect(res.body.fields['items.0.menuItemId']).toMatch(/not available at this time of day/);
    const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO food_orders/.test(String(sql)));
    expect(insert).toBeUndefined();
  });

  test('createOrder accepts an item inside its daypart window', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [restaurantRow()] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [menuItemRow({ availability_schedule: ALWAYS_AVAILABLE })] });
    mockOrderSuccess();

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'daypart-open-1')
      .send(BASE_BODY);

    expect(res.status).toBe(201);
  });
});

describe('F-11 scheduled orders', () => {
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // Hours: open right now (so the pre-existing "open now" gate passes) but
  // closed all day tomorrow (so the scheduled-time check must reject).
  function hoursClosedTomorrow() {
    const now = new Date();
    const todayKey = DAY_KEYS[now.getUTCDay()];
    const tomorrowKey = DAY_KEYS[(now.getUTCDay() + 1) % 7];
    const weekly = {};
    for (const key of DAY_KEYS) weekly[key] = { open: '00:00', close: '23:59' };
    weekly[tomorrowKey] = { closed: true };
    void todayKey;
    return { weekly };
  }

  function tomorrowNoonUtc() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 12, 0, 0)).toISOString();
  }

  test('rejects a scheduled time when the restaurant is closed then', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [restaurantRow({ operating_hours: hoursClosedTomorrow() })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [menuItemRow()] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'scheduled-closed-1')
      .send({ ...BASE_BODY, scheduledFor: tomorrowNoonUtc() });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_failed');
    expect(res.body.fields.scheduledFor).toMatch(/closed at the scheduled time/);
  });

  test('accepts a scheduled time inside operating hours', async () => {
    const openWeekly = {
      weekly: Object.fromEntries(DAY_KEYS.map((d) => [d, { open: '00:00', close: '23:59' }])),
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [restaurantRow({ operating_hours: openWeekly })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [menuItemRow()] });
    mockOrderSuccess();

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'scheduled-open-1')
      .send({ ...BASE_BODY, scheduledFor: tomorrowNoonUtc() });

    expect(res.status).toBe(201);
  });
});

describe('F-33 order pacing', () => {
  function mockPacingPreInsert(countRow) {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // idempotency lookup
      .mockResolvedValueOnce({
        rows: [restaurantRow({ settings: { onlineOrderPacingMaxPer15Min: 2 } })],
      }) // restaurant FOR UPDATE
      .mockResolvedValueOnce({ rows: [] }) // idempotency recheck
      .mockResolvedValueOnce({ rows: [countRow] }); // pacing count
  }

  test('rejects with 429 and retry info once the window cap is reached', async () => {
    mockPacingPreInsert({ accepted_count: 2, oldest_at: new Date(Date.now() - 5 * 60 * 1000) });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'pacing-full-1')
      .send(BASE_BODY);

    expect(res.status).toBe(429);
    expect(res.body.code).toBe('order_pacing_limit_reached');
    expect(res.body.fields.limit).toBe(2);
    expect(res.body.fields.windowMinutes).toBe(15);
    expect(res.body.fields.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.body.fields.retryAfterSeconds).toBeLessThanOrEqual(600);
  });

  test('allows orders while the window is below the cap', async () => {
    mockPacingPreInsert({ accepted_count: 1, oldest_at: new Date(Date.now() - 60 * 1000) });
    mockQuery.mockResolvedValueOnce({ rows: [menuItemRow()] });
    mockOrderSuccess();

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'pacing-open-1')
      .send(BASE_BODY);

    expect(res.status).toBe(201);
  });

  test('pacing is disabled when the setting is absent', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [restaurantRow({ settings: {} })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [menuItemRow()] });
    mockOrderSuccess();

    const res = await request(buildApp())
      .post(`/api/food/restaurants/${RESTAURANT_ID}/orders`)
      .set('Idempotency-Key', 'pacing-disabled-1')
      .send(BASE_BODY);

    expect(res.status).toBe(201);
    const pacingCount = mockQuery.mock.calls.find(([sql]) => /accepted_count/.test(String(sql)));
    expect(pacingCount).toBeUndefined();
  });
});

describe('F-20 audit trail', () => {
  function auditInserts() {
    return mockQuery.mock.calls.filter(([sql]) => /INSERT INTO business_audit_log/.test(String(sql)));
  }

  test('updateMenuItem writes a before/after audit row for a price change', async () => {
    const accessRow = {
      ...restaurantRow(),
      effective_role: 'owner',
      effective_membership_id: null,
      access_user_id: USER.id,
      business_owner_id: 7,
      business_deleted_at: null,
    };
    const beforeItem = {
      id: MENU_ITEM_ID, restaurant_id: RESTAURANT_ID, name: 'Classic Burger',
      price_cents: 899, currency_code: 'USD', category_id: 5,
      is_available: true, manual_available: true,
      publication_status: 'published', availability_schedule: {},
    };
    const afterItem = { ...beforeItem, price_cents: 1099 };
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow] }) // resolveRestaurantAccess
      .mockResolvedValueOnce({ rows: [beforeItem] }) // before image
      .mockResolvedValueOnce({ rows: [afterItem] }) // UPDATE ... RETURNING
      .mockResolvedValueOnce({ rows: [] }); // audit insert
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}/menu-items/${MENU_ITEM_ID}`)
      .send({ priceCents: 1099 });

    expect(res.status).toBe(200);
    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0];
    // business_audit_log params: business_id, actor, role, action, type, id, before, after, ...
    expect(params[3]).toBe('menu.item.updated');
    expect(JSON.parse(params[6]).price_cents).toBe(899);
    expect(JSON.parse(params[7]).price_cents).toBe(1099);
  });

  test('updateRestaurant writes an audit row when the tax rate changes', async () => {
    const accessRow = {
      ...restaurantRow({ tax_rate_bps: 500 }),
      effective_role: 'owner',
      effective_membership_id: null,
      access_user_id: USER.id,
      business_owner_id: 7,
      business_deleted_at: null,
    };
    const updatedRow = { ...accessRow, tax_rate_bps: 875 };
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow] }) // resolveRestaurantAccess
      .mockResolvedValueOnce({ rows: [updatedRow] }); // UPDATE ... RETURNING (in txn)
    mockQuery.mockResolvedValue({ rows: [] }); // audit insert + anything else

    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}`)
      .send({ taxRateBps: 875 });

    expect(res.status).toBe(200);
    const inserts = auditInserts();
    expect(inserts).toHaveLength(1);
    const [, params] = inserts[0];
    expect(params[3]).toBe('restaurant.settings.updated');
    expect(JSON.parse(params[6]).tax_rate_bps).toBe(500);
    expect(JSON.parse(params[7]).tax_rate_bps).toBe(875);
  });

  test('updateRestaurant accepts the pacing setting into restaurant settings', async () => {
    const accessRow = {
      ...restaurantRow(),
      effective_role: 'owner',
      effective_membership_id: null,
      access_user_id: USER.id,
      business_owner_id: 7,
      business_deleted_at: null,
    };
    const updatedRow = { ...accessRow, settings: { onlineOrderPacingMaxPer15Min: 12 } };
    mockQuery
      .mockResolvedValueOnce({ rows: [accessRow] })
      .mockResolvedValueOnce({ rows: [updatedRow] });
    mockQuery.mockResolvedValue({ rows: [] });

    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}`)
      .send({ settings: { onlineOrderPacingMaxPer15Min: 12 } });

    expect(res.status).toBe(200);
    const update = mockQuery.mock.calls.find(([sql]) => /UPDATE food_restaurants SET/.test(String(sql)));
    expect(update).toBeDefined();
    const settingsParam = update[1].find((p) => typeof p === 'string' && p.includes('onlineOrderPacingMaxPer15Min'));
    expect(settingsParam).toBeDefined();
    expect(JSON.parse(settingsParam).onlineOrderPacingMaxPer15Min).toBe(12);
  });
});
