'use strict';

/**
 * __tests__/foodCreditFraud.test.js
 *
 * Phase 3 restaurant credit fraud controls:
 *  - customer velocity block at the 6th request in 24h (429 + block signal)
 *  - restaurant velocity block at the 21st request in 24h (429 + block signal)
 *  - identity-verification gate: blocks unverified customers over $200 (403),
 *    allows verified customers and smaller amounts
 *  - IDV gate fails closed when verification status cannot be determined
 *  - large first request logs a warn signal without blocking
 *  - rapid multi-restaurant logs a warn signal without blocking
 *  - admin review surface: list with filters, mark reviewed
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const walletController = require('../controllers/foodWalletController');

const CUSTOMER_ID = '00000000-0000-4000-8000-000000000456';
const RESTAURANT_ID = 3;
const BUSINESS_ID = 42;

function restaurantRow() {
  return {
    id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    display_name: 'Ox Burger Lab',
    currency_code: 'USD',
    status: 'active',
  };
}

function insertedLoadRequestRow(amountCents) {
  return {
    id: 1001,
    restaurant_id: RESTAURANT_ID,
    business_id: BUSINESS_ID,
    customer_id: CUSTOMER_ID,
    requested_by_user_id: CUSTOMER_ID,
    amount_cents: amountCents,
    currency_code: 'USD',
    status: 'pending',
    note: null,
    reference_id: 'ref-1',
    idempotency_key: 'key-1',
    correlation_id: 'key-1',
    metadata: {},
    expires_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Mutable fixture the mocked pool reads from.
const fixture = {
  customerRecentCount: 0,   // rolling-24h load requests by this customer
  restaurantRecentCount: 0, // rolling-24h load requests for this restaurant
  customerTotalCount: 1,    // lifetime count (incl. the just-inserted row)
  distinctRestaurants1h: 1, // distinct restaurants in the last hour
  verifications: [],        // oxsteed_credit_identity_verifications rows
  idvLookupError: false,
  signalInserts: [],        // captured food_credit_fraud_signals INSERT params
  signalListRows: [],       // rows returned by the admin list query
  signalListParams: null,
};

function resetFixture() {
  fixture.customerRecentCount = 0;
  fixture.restaurantRecentCount = 0;
  fixture.customerTotalCount = 1;
  fixture.distinctRestaurants1h = 1;
  fixture.verifications = [];
  fixture.idvLookupError = false;
  fixture.signalInserts = [];
  fixture.signalListRows = [];
  fixture.signalListParams = null;
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: CUSTOMER_ID, email: 'cust@example.com' };
    next();
  });
  app.post('/api/food/customer/wallets/:restaurantId/load-requests', walletController.createMyWalletLoadRequest);
  // Admin endpoints mounted without requireAdmin here (auth is covered by the
  // real route registration in server/routes/food.js); this exercises the
  // controller filtering/review behavior.
  app.get('/api/food/admin/fraud-signals', walletController.listFraudSignals);
  app.post('/api/food/admin/fraud-signals/:id/review', walletController.reviewFraudSignal);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  resetMocks();
  resetFixture();
  mockQuery.mockImplementation(async (sql, params = []) => {
    const text = String(sql);
    if (text.includes('INSERT INTO food_credit_fraud_signals')) {
      fixture.signalInserts.push({ params });
      return { rows: [{ id: 9000 + fixture.signalInserts.length }] };
    }
    if (text.includes('FROM food_credit_fraud_signals')) {
      fixture.signalListParams = params;
      return { rows: fixture.signalListRows };
    }
    if (text.includes('UPDATE food_credit_fraud_signals')) {
      const row = fixture.signalListRows.find((r) => r.id === params[0]);
      return { rows: row ? [{ ...row, reviewed: true }] : [] };
    }
    if (text.includes('oxsteed_credit_identity_verifications')) {
      if (fixture.idvLookupError) throw new Error('verification store unavailable');
      return { rows: fixture.verifications };
    }
    if (text.includes('INSERT INTO food_customer_wallet_load_requests')) {
      return { rows: [insertedLoadRequestRow(params[3])] };
    }
    if (text.includes('COUNT(DISTINCT restaurant_id)')) {
      return { rows: [{ count: fixture.distinctRestaurants1h }] };
    }
    if (text.includes('COUNT') && text.includes('food_customer_wallet_load_requests')) {
      if (text.includes("INTERVAL '24 hours'")) {
        const count = text.includes('customer_id = $1')
          ? fixture.customerRecentCount
          : fixture.restaurantRecentCount;
        return { rows: [{ count }] };
      }
      return { rows: [{ count: fixture.customerTotalCount }] };
    }
    if (text.includes('FROM food_restaurants')) {
      return { rows: [restaurantRow()] };
    }
    // Replay check and anything else: no rows.
    return { rows: [] };
  });
});

function createRequest(amountCents) {
  return request(buildApp())
    .post(`/api/food/customer/wallets/${RESTAURANT_ID}/load-requests`)
    .send({
      amountCents,
      idempotencyKey: `key-${Date.now()}-${Math.random()}`,
      paymentReference: 'ref-1',
    });
}

function signalsOf(type, severity) {
  return fixture.signalInserts.filter(
    (s) => s.params[0] === type && s.params[5] === severity
  );
}

describe('Phase 3 restaurant credit fraud controls', () => {
  test('allows a request under all limits (201)', async () => {
    const res = await createRequest(5000);
    expect(res.status).toBe(201);
    expect(res.body.loadRequest).toBeDefined();
    expect(fixture.signalInserts).toHaveLength(0);
  });

  test('customer velocity: blocks the 6th request in 24h with 429 and a block signal', async () => {
    fixture.customerRecentCount = 5;
    const res = await createRequest(5000);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('credit_request_velocity_customer');
    const blocked = signalsOf('velocity_customer', 'block');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].params[1]).toBe(CUSTOMER_ID); // customer_id
  });

  test('customer velocity: 5th request still passes', async () => {
    fixture.customerRecentCount = 4;
    const res = await createRequest(5000);
    expect(res.status).toBe(201);
  });

  test('restaurant velocity: blocks the 21st request in 24h with 429 and a block signal', async () => {
    fixture.restaurantRecentCount = 20;
    const res = await createRequest(5000);
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('credit_request_velocity_restaurant');
    const blocked = signalsOf('velocity_restaurant', 'block');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].params[2]).toBe(RESTAURANT_ID); // restaurant_id
  });

  test('IDV gate: blocks an unverified customer over $200 with 403', async () => {
    fixture.verifications = []; // no verification rows -> tier 0
    const res = await createRequest(25000);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_idv_required');
    expect(res.body.error).toMatch(/identity verification/i);
    const blocked = signalsOf('idv_required', 'block');
    expect(blocked).toHaveLength(1);
    expect(blocked[0].params[1]).toBe(CUSTOMER_ID);
  });

  test('IDV gate: allows a verified customer over $200', async () => {
    fixture.verifications = [{ id: 7, tier: 1, status: 'verified', expires_at: null }];
    const res = await createRequest(25000);
    expect(res.status).toBe(201);
    expect(signalsOf('idv_required', 'block')).toHaveLength(0);
  });

  test('IDV gate: does not apply at or under $200', async () => {
    fixture.verifications = [];
    const res = await createRequest(20000);
    expect(res.status).toBe(201);
    expect(signalsOf('idv_required', 'block')).toHaveLength(0);
  });

  test('IDV gate: fails closed when verification status cannot be determined', async () => {
    fixture.idvLookupError = true;
    const res = await createRequest(25000);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('credit_idv_unavailable');
  });

  test('large first request: logs a warn signal without blocking', async () => {
    fixture.customerTotalCount = 1; // this is the customer's first request
    const res = await createRequest(15000); // $150 > $100 threshold
    expect(res.status).toBe(201);
    const warned = signalsOf('large_first_request', 'warn');
    expect(warned).toHaveLength(1);
    expect(warned[0].params[3]).toBe(1001); // load_request_id
    expect(JSON.parse(warned[0].params[4])).toMatchObject({ amountCents: 15000 });
  });

  test('large first request: no signal when under the threshold or not the first request', async () => {
    fixture.customerTotalCount = 1;
    const small = await createRequest(5000);
    expect(small.status).toBe(201);
    fixture.customerTotalCount = 4;
    const repeat = await createRequest(15000);
    expect(repeat.status).toBe(201);
    expect(signalsOf('large_first_request', 'warn')).toHaveLength(0);
  });

  test('rapid multi-restaurant: 3+ restaurants in an hour logs warn without blocking', async () => {
    fixture.distinctRestaurants1h = 3;
    const res = await createRequest(5000);
    expect(res.status).toBe(201);
    const warned = signalsOf('rapid_multi_restaurant', 'warn');
    expect(warned).toHaveLength(1);
    expect(JSON.parse(warned[0].params[4])).toMatchObject({ distinctRestaurants: 3 });
  });

  test('rapid multi-restaurant: fewer than 3 restaurants logs nothing', async () => {
    fixture.distinctRestaurants1h = 2;
    const res = await createRequest(5000);
    expect(res.status).toBe(201);
    expect(signalsOf('rapid_multi_restaurant', 'warn')).toHaveLength(0);
  });

  test('velocity checks fail open on unexpected infra errors', async () => {
    const base = mockQuery.getMockImplementation();
    mockQuery.mockImplementationOnce(async (sql, params) => {
      if (String(sql).includes("INTERVAL '24 hours'") && String(sql).includes('customer_id = $1')) {
        throw new Error('transient db blip');
      }
      return base(sql, params);
    });
    const res = await createRequest(5000);
    expect(res.status).toBe(201);
  });

  test('admin: lists signals with reviewed and severity filters', async () => {
    fixture.signalListRows = [
      { id: 1, signal_type: 'idv_required', severity: 'block', reviewed: false, created_at: new Date().toISOString() },
      { id: 2, signal_type: 'large_first_request', severity: 'warn', reviewed: true, created_at: new Date().toISOString() },
    ];
    const res = await request(buildApp()).get('/api/food/admin/fraud-signals?reviewed=false&severity=warn,block');
    expect(res.status).toBe(200);
    expect(res.body.signals).toHaveLength(2);
    // reviewed=false bound as $1, severities as $2
    expect(fixture.signalListParams[0]).toBe(false);
    expect(fixture.signalListParams[1]).toEqual(['warn', 'block']);
  });

  test('admin: unfiltered list works', async () => {
    fixture.signalListRows = [{ id: 1, signal_type: 'idv_required', severity: 'block', reviewed: false }];
    const res = await request(buildApp()).get('/api/food/admin/fraud-signals');
    expect(res.status).toBe(200);
    expect(res.body.signals).toHaveLength(1);
  });

  test('admin: marks a signal reviewed', async () => {
    fixture.signalListRows = [{ id: 42, signal_type: 'velocity_customer', severity: 'block', reviewed: false }];
    const res = await request(buildApp()).post('/api/food/admin/fraud-signals/42/review');
    expect(res.status).toBe(200);
    expect(res.body.signal.reviewed).toBe(true);
  });

  test('admin: review of an unknown signal returns 404', async () => {
    fixture.signalListRows = [];
    const res = await request(buildApp()).post('/api/food/admin/fraud-signals/999/review');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('fraud_signal_not_found');
  });
});
