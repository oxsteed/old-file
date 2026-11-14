'use strict';

// Domain 7 #6 (repro-first): subscription cancel takes a hand-typed id and
// confirms with the raw id only — no subscription preview. A transposed id
// that still matches a real subscription cancels the wrong customer's
// subscription. A lookup endpoint must resolve the subscription (user,
// plan, status, amount, Stripe customer) before the confirm can proceed.
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

const mockStripe = { subscriptions: { cancel: jest.fn(), retrieve: jest.fn() } };
jest.mock('stripe', () => () => mockStripe);
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/stepupChallengeService', () => ({
  verifyStepupChallenge: jest.fn(),
  issueStepupChallenge: jest.fn(),
}));

const { errorHandler } = require('../middleware/errorHandler');
const subCtrl = require('../controllers/subscriptionController');

function app(handler, path = '/subscriptions/:id') {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: 'admin-1' }; next(); });
  a.get(path, handler);
  a.use(errorHandler);
  return a;
}

const SUB_ROW = {
  id: 's9',
  user_id: 'u9',
  status: 'active',
  payment_method: 'card',
  stripe_subscription_id: 'sub_live_1',
  stripe_customer_id: 'cus_local',
  current_period_start: '2026-11-01T00:00:00.000Z',
  current_period_end: '2026-12-01T00:00:00.000Z',
  plan_name: 'Pro Verified',
  plan_slug: 'pro',
  plan_amount_cents: 3999,
  plan_currency: 'usd',
  plan_interval: 'month',
  first_name: 'Ada',
  last_name: 'Lovelace',
  email: 'ada@example.com',
};

beforeEach(() => {
  resetMocks();
  mockStripe.subscriptions.cancel.mockReset();
  mockStripe.subscriptions.retrieve.mockReset();
  mockStripe.subscriptions.retrieve.mockResolvedValue({ id: 'sub_live_1', customer: 'cus_live', status: 'active' });
});

test('lookup resolves the subscription with user, plan, status, amount and the Stripe customer', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('FROM subscriptions s')) return { rows: [SUB_ROW] };
    return { rows: [] };
  });
  const res = await request(app(subCtrl.getAdminSubscription)).get('/subscriptions/s9');
  expect(res.status).toBe(200);
  expect(res.body.subscription).toMatchObject({
    id: 's9',
    userId: 'u9',
    userDisplayName: 'Ada Lovelace',
    userEmail: 'ada@example.com',
    planName: 'Pro Verified',
    planSlug: 'pro',
    amountCents: 3999,
    currency: 'usd',
    interval: 'month',
    status: 'active',
    paymentMethod: 'card',
    stripeSubscriptionId: 'sub_live_1',
    stripeCustomerId: 'cus_live',
    stripeStatus: 'active',
  });
  expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_live_1');
});

test('lookup of an unknown subscription is a 404, not a preview', async () => {
  mockQuery.mockResolvedValue({ rows: [] });
  const res = await request(app(subCtrl.getAdminSubscription)).get('/subscriptions/nope');
  expect(res.status).toBe(404);
  expect(res.body.code).toBe('not_found');
});

test('a deleted Stripe record still returns the local subscription with its stored customer', async () => {
  mockStripe.subscriptions.retrieve.mockRejectedValue(Object.assign(new Error('No such subscription'), { code: 'resource_missing' }));
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('FROM subscriptions s')) return { rows: [SUB_ROW] };
    return { rows: [] };
  });
  const res = await request(app(subCtrl.getAdminSubscription)).get('/subscriptions/s9');
  expect(res.status).toBe(200);
  expect(res.body.subscription.stripeCustomerId).toBe('cus_local');
  expect(res.body.subscription.stripeStatus).toBeNull();
});

test('a credit subscription with no Stripe id needs no Stripe call', async () => {
  mockQuery.mockImplementation(async (sql) => {
    if (String(sql).includes('FROM subscriptions s')) return { rows: [{ ...SUB_ROW, stripe_subscription_id: null, stripe_customer_id: null, payment_method: 'oxsteed_credit' }] };
    return { rows: [] };
  });
  const res = await request(app(subCtrl.getAdminSubscription)).get('/subscriptions/s9');
  expect(res.status).toBe(200);
  expect(res.body.subscription.stripeCustomerId).toBeNull();
  expect(mockStripe.subscriptions.retrieve).not.toHaveBeenCalled();
});
