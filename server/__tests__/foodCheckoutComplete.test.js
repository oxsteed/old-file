'use strict';

// ITEM 23: GET /orders/:orderId/checkout/complete
// - Rate-limited (foodCheckoutCompleteLimiter, 10/15min per IP+session).
// - Anonymous session_id use is rejected for user-bound carts (customer_id
//   set) — the owner must be signed in.
// - Guest carts (customer_id NULL) keep working via Stripe session
//   verification.

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const { foodCheckoutCompleteLimiter } = require('../middleware/rateLimiter');
const foodRouter = require('../routes/food');
const stripe = require('stripe');

const OWNER_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ID = '00000000-0000-4000-8000-0000000000b2';
const TOKEN_OWNER = jwt.sign({ id: OWNER_ID, email: 'owner@test.com', role: 'customer' }, process.env.JWT_SECRET);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/food', foodRouter);
  app.use(errorHandler);
  return app;
}

function orderRow(overrides = {}) {
  return {
    id: 42,
    restaurant_id: 7,
    business_id: 9,
    customer_id: null,
    payment_status: 'unpaid',
    queue_number: 12,
    metadata: {},
    business_stripe_account_id: 'acct_123',
    ...overrides,
  };
}

function stripeSessionPaid() {
  stripe.__mockInstance.checkout.sessions.retrieve.mockResolvedValueOnce({
    id: 'cs_test_123',
    payment_status: 'paid',
    payment_intent: 'pi_test_123',
    metadata: { food_order_id: '42' },
  });
}

beforeEach(() => {
  resetMocks();
});

describe('GET /orders/:orderId/checkout/complete (ITEM 23)', () => {
  test('route is wired with the checkout-complete rate limiter', () => {
    const layer = foodRouter.stack.find(
      (l) => l.route && l.route.path === '/orders/:orderId/checkout/complete'
        && l.route.methods.get
    );
    expect(layer).toBeDefined();
    const handlers = layer.route.stack.map((s) => s.handle);
    expect(handlers).toContain(foodCheckoutCompleteLimiter);
  });

  test('anonymous caller on a user-bound cart is rejected (401)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [orderRow({ customer_id: OWNER_ID })] });

    const res = await request(buildApp())
      .get('/api/food/orders/42/checkout/complete?session_id=cs_test_abc');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('authentication_required');
    // Stripe is never consulted for a rejected caller.
    expect(stripe.__mockInstance.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  test('signed-in caller on someone else\'s cart is rejected (403)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: OTHER_ID, email: 'other@test.com', role: 'customer', is_active: true }] }) // optionalAuth lookup
      .mockResolvedValueOnce({ rows: [orderRow({ customer_id: OWNER_ID })] }); // order lookup
    const otherToken = jwt.sign({ id: OTHER_ID, email: 'other@test.com', role: 'customer' }, process.env.JWT_SECRET);

    const res = await request(buildApp())
      .get('/api/food/orders/42/checkout/complete?session_id=cs_test_def')
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('payment_order_mismatch');
  });

  test('guest cart completes via session_id when Stripe reports paid', async () => {
    stripeSessionPaid();
    mockQuery
      .mockResolvedValueOnce({ rows: [orderRow({ customer_id: null })] }) // order lookup
      .mockResolvedValueOnce({ rows: [orderRow({ customer_id: null, payment_status: 'paid', queue_number: 12 })] }); // UPDATE

    const res = await request(buildApp())
      .get('/api/food/orders/42/checkout/complete?session_id=cs_test_guest1');

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Payment complete/);
    expect(stripe.__mockInstance.checkout.sessions.retrieve).toHaveBeenCalled();
  });

  test('signed-in owner completes their own cart', async () => {
    stripeSessionPaid();
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: OWNER_ID, email: 'owner@test.com', role: 'customer', is_active: true }] }) // optionalAuth lookup
      .mockResolvedValueOnce({ rows: [orderRow({ customer_id: OWNER_ID })] }) // order lookup
      .mockResolvedValueOnce({ rows: [orderRow({ customer_id: OWNER_ID, payment_status: 'paid', queue_number: 12 })] }); // UPDATE

    const res = await request(buildApp())
      .get('/api/food/orders/42/checkout/complete?session_id=cs_test_owner1')
      .set('Authorization', `Bearer ${TOKEN_OWNER}`);

    expect(res.status).toBe(200);
    expect(res.text).toMatch(/Payment complete/);
  });
});

describe('foodCheckoutCompleteLimiter', () => {
  test('allows 10 attempts per 15min per IP+session, then 429s', async () => {
    const app = express();
    app.get('/t', foodCheckoutCompleteLimiter, (req, res) => res.send('ok'));

    const agent = request(app);
    for (let i = 0; i < 10; i++) {
      const res = await agent.get('/t?session_id=cs_test_limit_bucket');
      expect(res.status).toBe(200);
    }
    const limited = await agent.get('/t?session_id=cs_test_limit_bucket');
    expect(limited.status).toBe(429);

    // A different session_id gets its own bucket.
    const other = await agent.get('/t?session_id=cs_test_limit_other');
    expect(other.status).toBe(200);
  });
});
