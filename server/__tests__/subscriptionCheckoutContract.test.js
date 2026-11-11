'use strict';

const express = require('express');
const request = require('supertest');
const stripe = require('stripe');
const { mockQuery, resetMocks } = require('./setup');
const { errorHandler } = require('../middleware/errorHandler');
const controller = require('../controllers/subscriptionController');

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => { req.user = { id: 'user-sub-1' }; next(); });
  instance.post('/checkout', controller.createCheckout);
  instance.use(errorHandler);
  return instance;
}

beforeEach(() => {
  resetMocks();
  stripe.__mockInstance.customers.create.mockReset();
  stripe.__mockInstance.checkout.sessions.create.mockReset();
});

test('subscription checkout fails closed when Stripe returns no hosted URL', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const query = String(sql);
    if (query.includes('information_schema.columns')) return { rows: [{ column_name: 'active' }] };
    if (query.includes('SELECT * FROM plans')) return { rows: [{ id: 7, slug: 'premium', stripe_price_id: 'price_premium' }] };
    if (query.includes('SELECT id FROM subscriptions')) return { rows: [] };
    if (query.includes('SELECT email, first_name')) return { rows: [{ email: 'user@example.com', first_name: 'Test', last_name: 'User', country: null }] };
    if (query.includes('SELECT stripe_customer_id')) return { rows: [] };
    return { rows: [] };
  });
  stripe.__mockInstance.customers.create.mockResolvedValueOnce({ id: 'cus_test_1' });
  stripe.__mockInstance.checkout.sessions.create.mockResolvedValueOnce({ id: 'cs_test_1', url: null });

  const response = await request(app()).post('/checkout').send({ planSlug: 'premium' });

  expect(response.status).toBe(503);
  expect(response.body.code).toBe('stripe_checkout_unavailable');
  expect(stripe.__mockInstance.checkout.sessions.create).toHaveBeenCalledTimes(1);
});

test('hosted Stripe URL validator accepts only HTTPS URLs', () => {
  expect(controller._requireHostedStripeUrl({ url: 'https://checkout.stripe.com/cs_1' })).toBe('https://checkout.stripe.com/cs_1');
  expect(() => controller._requireHostedStripeUrl({ url: 'http://checkout.stripe.com/cs_1' })).toThrow(/handoff/i);
});

