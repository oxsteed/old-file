'use strict';

// Merchant settings patch path: tax_rate_bps and per-day operating_hours.
// Guards the RESTAURANT_PATCH_FIELDS contract used by PATCH /api/food/restaurants/:id:
//  - taxRateBps is persisted to the tax_rate_bps column, clamped to 0..10000.
//  - operatingHours persists the full per-day { weekly } structure (including
//    closed days) without stamping all 7 days identically.

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const ctrl = require('../controllers/foodController');

const OWNER_ID = '00000000-0000-4000-8000-000000000456';
const RESTAURANT_ID = 7;

function baseRestaurant() {
  return {
    id: RESTAURANT_ID,
    business_id: 44,
    owner_user_id: OWNER_ID,
    business_owner_id: OWNER_ID,
    effective_role: 'owner',
    display_name: 'Bon Pate',
    status: 'active',
    currency_code: 'USD',
  };
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: OWNER_ID, email: 'owner@example.com' };
    next();
  });
  app.patch('/api/food/restaurants/:restaurantId', ctrl.updateRestaurant);
  app.use(errorHandler);
  return app;
}

// Captures the UPDATE food_restaurants statement so tests can assert on the
// generated SQL and bound parameters.
function mockUpdateFlow(updatedOverrides = {}) {
  const captured = { text: null, params: null };
  mockQuery.mockImplementation(async (text, params) => {
    if (/FROM food_restaurants fr/i.test(text)) {
      return { rows: [baseRestaurant()], rowCount: 1 };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(String(text).trim())) {
      return { rows: [], rowCount: 0 };
    }
    if (/UPDATE food_restaurants SET/i.test(text)) {
      captured.text = text;
      captured.params = params;
      return {
        rows: [{ ...baseRestaurant(), ...updatedOverrides }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
  return captured;
}

function paramForColumn(captured, column) {
  // SET clauses look like `tax_rate_bps = $3`; params are 0-indexed.
  const match = captured.text.match(new RegExp(`${column} = \\$(\\d+)`));
  if (!match) return { found: false };
  const index = Number(match[1]) - 1;
  return { found: true, value: captured.params[index] };
}

describe('PATCH /api/food/restaurants/:id settings fields', () => {
  beforeEach(() => {
    resetMocks();
  });

  test('persists taxRateBps to tax_rate_bps', async () => {
    const captured = mockUpdateFlow({ tax_rate_bps: 850 });
    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}`)
      .send({ taxRateBps: 850 })
      .expect(200);
    const param = paramForColumn(captured, 'tax_rate_bps');
    expect(param.found).toBe(true);
    expect(param.value).toBe(850);
    expect(res.body.restaurant.tax_rate_bps).toBe(850);
  });

  test('clamps taxRateBps above 10000', async () => {
    const captured = mockUpdateFlow({ tax_rate_bps: 10000 });
    await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}`)
      .send({ taxRateBps: 20000 })
      .expect(200);
    const param = paramForColumn(captured, 'tax_rate_bps');
    expect(param.found).toBe(true);
    expect(param.value).toBe(10000);
  });

  test('clamps negative taxRateBps to 0', async () => {
    const captured = mockUpdateFlow({ tax_rate_bps: 0 });
    await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}`)
      .send({ taxRateBps: -5 })
      .expect(200);
    const param = paramForColumn(captured, 'tax_rate_bps');
    expect(param.found).toBe(true);
    expect(param.value).toBe(0);
  });

  test('persists per-day operating hours including closed days', async () => {
    const hours = {
      weekly: {
        mon: { open: '11:00', close: '22:00' },
        tue: { closed: true, open: '09:00', close: '17:00' },
        sun: { open: '10:00', close: '14:00' },
      },
    };
    const captured = mockUpdateFlow({ operating_hours: hours });
    const res = await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}`)
      .send({ operatingHours: hours })
      .expect(200);
    const param = paramForColumn(captured, 'operating_hours');
    expect(param.found).toBe(true);
    // normalizeHoursInput passes the per-day object through; pg stringifies it.
    const persisted = typeof param.value === 'string' ? JSON.parse(param.value) : param.value;
    expect(persisted.weekly.mon).toEqual({ open: '11:00', close: '22:00' });
    expect(persisted.weekly.tue.closed).toBe(true);
    expect(persisted.weekly.sun).toEqual({ open: '10:00', close: '14:00' });
    // Per-day structure: days the owner did not set are NOT auto-stamped.
    expect(Object.keys(persisted.weekly).sort()).toEqual(['mon', 'sun', 'tue']);
    expect(res.body.restaurant.operating_hours.weekly.tue.closed).toBe(true);
  });

  test('rejects an empty patch body', async () => {
    mockUpdateFlow();
    await request(buildApp())
      .patch(`/api/food/restaurants/${RESTAURANT_ID}`)
      .send({})
      .expect(400);
  });
});
