'use strict';

// Review P2-569 / P2-578: Credit subscriptions (no Stripe id) and past_due
// subscriptions can be cancelled; the renewal worker honors cancellation.
const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

const mockStripe = { subscriptions: { update: jest.fn(), cancel: jest.fn() } };
jest.mock('stripe', () => () => mockStripe);
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));

const { errorHandler } = require('../middleware/errorHandler');
const subCtrl = require('../controllers/subscriptionController');

function app(handler, path = '/cancel', userId = 'u1') {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => { req.user = { id: userId }; next(); });
  a.post(path, handler);
  a.use(errorHandler);
  return a;
}

beforeEach(() => {
  resetMocks();
  mockStripe.subscriptions.update.mockReset();
  mockStripe.subscriptions.cancel.mockReset();
});

test('credit subscription cancels locally without calling Stripe', async () => {
  const end = new Date(Date.now() + 10 * 86400000).toISOString();
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.includes('FROM subscriptions') && t.includes('FOR UPDATE')) {
      return { rows: [{ id: 's1', stripe_subscription_id: null, payment_method: 'oxsteed_credit', cancel_at_period_end: false, current_period_end: end }] };
    }
    if (t.includes('FROM payments')) return { rows: [{ count: '0' }] };
    return { rows: [], rowCount: 1 };
  });
  const res = await request(app(subCtrl.cancelSubscription)).post('/cancel');
  expect(res.status).toBe(200);
  expect(res.body.cancel_at).toBe(end);
  expect(mockStripe.subscriptions.update).not.toHaveBeenCalled();
  expect(mockQuery.mock.calls.some(([sql]) => /SET cancel_at_period_end = TRUE/.test(String(sql)))).toBe(true);
});

test('past_due subscriptions are cancellable', async () => {
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.includes('FROM subscriptions') && t.includes('FOR UPDATE')) {
      expect(t).toMatch(/'past_due'/);
      return { rows: [] };
    }
    return { rows: [] };
  });
  const res = await request(app(subCtrl.cancelSubscription)).post('/cancel');
  expect(res.status).toBe(404);
});

test('admin cancel ends a credit subscription and audits it', async () => {
  const { logAdminAction } = require('../services/auditService');
  mockQuery.mockImplementation(async (sql) => {
    const t = String(sql);
    if (t.startsWith('SELECT id, user_id, status')) return { rows: [{ id: 's2', user_id: 'u2', status: 'active', payment_method: 'oxsteed_credit', stripe_subscription_id: null }] };
    if (t.includes("SET status = 'cancelled'")) return { rows: [{ id: 's2', status: 'cancelled' }] };
    return { rows: [] };
  });
  const res = await request(app(subCtrl.adminCancelSubscription, '/admin/:id/cancel', 'admin1'))
    .post('/admin/s2/cancel').send({ reason: 'Customer requested by phone' });
  expect(res.status).toBe(200);
  expect(res.body.subscription.status).toBe('cancelled');
  expect(mockStripe.subscriptions.cancel).not.toHaveBeenCalled();
  expect(logAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'subscription.cancel', throwOnError: true }));
});

test('admin cancel requires a reason', async () => {
  const res = await request(app(subCtrl.adminCancelSubscription, '/admin/:id/cancel', 'admin1')).post('/admin/s2/cancel').send({});
  expect(res.status).toBe(400);
});

describe('renewal worker', () => {
  const OLD = process.env.SUBSCRIPTIONS_CREDIT_ENABLED;
  afterAll(() => { process.env.SUBSCRIPTIONS_CREDIT_ENABLED = OLD; });
  test('a cancelled-at-period-end credit subscription ends instead of renewing', async () => {
    process.env.SUBSCRIPTIONS_CREDIT_ENABLED = 'true';
    jest.resetModules();
    const spend = jest.fn();
    jest.doMock('../services/creditSpendAdapter', () => ({ spendWithCredit: spend }));
    const { mockQuery: mq } = require('./setup');
    const past = new Date(Date.now() - 86400000).toISOString();
    mq.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t.includes('JOIN plans p')) return { rows: [{ id: 's3', user_id: 'u3', plan_id: 'p', current_period_end: past, amount_cents: 500, interval: 'month' }] };
      if (t.includes('FOR UPDATE')) return { rows: [{ id: 's3', status: 'active', current_period_end: past, cancel_at_period_end: true }] };
      return { rows: [], rowCount: 1 };
    });
    const { renewSubscriptionCredit } = require('../workers/subscriptionCreditWorkers');
    const out = await renewSubscriptionCredit({});
    expect(spend).not.toHaveBeenCalled();
    expect(out.ended).toBe(1);
    expect(out.renewed).toBe(0);
    expect(mq.mock.calls.some(([sql]) => /SET status = 'cancelled'/.test(String(sql)))).toBe(true);
  });
});
