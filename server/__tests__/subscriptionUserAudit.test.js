'use strict';

/**
 * P3-11-F08: subscriber-initiated cancel and credit checkout must write
 * transactional fail-closed audit rows (same contract as adminCancel).
 */

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');

const mockStripe = { subscriptions: { update: jest.fn(), cancel: jest.fn() } };
jest.mock('stripe', () => () => mockStripe);
jest.mock('../services/auditService', () => ({ logAdminAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/creditSpendAdapter', () => ({ spendWithCredit: jest.fn() }));

const { errorHandler } = require('../middleware/errorHandler');
const subCtrl = require('../controllers/subscriptionController');
const { logAdminAction } = require('../services/auditService');
const { spendWithCredit } = require('../services/creditSpendAdapter');

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
  jest.clearAllMocks();
});

describe('subscriber cancel audit', () => {
  test('credit subscription cancel writes a fail-closed audit row', async () => {
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
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'u1',
        action: 'subscription.cancel_scheduled',
        targetType: 'subscription',
        targetId: 's1',
        throwOnError: true,
      })
    );
    const call = logAdminAction.mock.calls.find(([args]) => args.action === 'subscription.cancel_scheduled');
    expect(call[0].client).toBeTruthy();
  });

  test('stripe subscription cancel writes a fail-closed audit row', async () => {
    const endSeconds = Math.floor(Date.now() / 1000) + 30 * 86400;
    mockQuery.mockImplementation(async (sql) => {
      const t = String(sql);
      if (t.includes('FROM subscriptions') && t.includes('FOR UPDATE')) {
        return { rows: [{ id: 's9', stripe_subscription_id: 'sub_9', payment_method: 'card', cancel_at_period_end: false, current_period_end: new Date().toISOString() }] };
      }
      if (t.includes('FROM payments')) return { rows: [{ count: '0' }] };
      if (t.includes('UPDATE subscriptions') && t.includes('cancel_at_period_end = TRUE')) {
        return { rows: [{ id: 's9' }] };
      }
      return { rows: [], rowCount: 1 };
    });
    mockStripe.subscriptions.update.mockResolvedValue({
      id: 'sub_9',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: endSeconds,
    });

    const res = await request(app(subCtrl.cancelSubscription)).post('/cancel');
    expect(res.status).toBe(200);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        adminId: 'u1',
        action: 'subscription.cancel_scheduled',
        targetType: 'subscription',
        targetId: 's9',
        throwOnError: true,
      })
    );
  });
});

describe('credit checkout audit', () => {
  test('credit subscription creation writes a fail-closed audit row', async () => {
    process.env.SUBSCRIPTIONS_CREDIT_ENABLED = 'true';
    try {
      mockQuery.mockImplementation(async (sql) => {
        const t = String(sql);
        if (t.includes('FROM plans WHERE slug')) {
          return { rows: [{ id: 3, slug: 'pro', amount_cents: 2500, currency: 'USD', interval: 'month' }] };
        }
        if (t.includes('information_schema.columns')) return { rows: [{ column_name: 'active' }] };
        if (t.includes('FROM subscriptions') && t.includes('FOR UPDATE')) return { rows: [] };
        if (t.includes('FROM credit_participants p')) return { rows: [{ participant_id: 11 }] };
        if (t.includes('FROM credit_participants WHERE id')) {
          return { rows: [{ participant_type: 'subscription_merchant', business_id: null, user_id: 'merchant-1' }] };
        }
        if (t.includes('INSERT INTO subscriptions')) {
          return { rows: [{ id: 'subrow-credit-1', user_id: 'u1', plan_id: 3 }] };
        }
        return { rows: [], rowCount: 0 };
      });
      spendWithCredit.mockResolvedValue({ idempotencyKey: 'credit-spend:k1' });

      const res = await request(app(subCtrl.createCheckout, '/checkout'))
        .post('/checkout')
        .send({ planSlug: 'pro', paymentMethod: 'credit' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(logAdminAction).toHaveBeenCalledWith(
        expect.objectContaining({
          adminId: 'u1',
          action: 'subscription.created',
          targetType: 'subscription',
          targetId: 'subrow-credit-1',
          throwOnError: true,
        })
      );
    } finally {
      delete process.env.SUBSCRIPTIONS_CREDIT_ENABLED;
    }
  });
});
