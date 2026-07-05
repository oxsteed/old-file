'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../controllers/verificationController', () => ({
  recalculateBadges: jest.fn().mockResolvedValue(true),
}));

const express = require('express');
const request = require('supertest');

// Pull the stripe mock so we can control constructEvent
const stripe = require('stripe')();

const webhookRoutes = require('../routes/webhook');

function buildApp() {
  const app = express();
  // Webhook routes use express.raw() internally - mount as-is
  app.use('/api/webhooks', webhookRoutes);
  return app;
}

// Helper: send a fake signed webhook event
function sendEvent(app, eventObj) {
  stripe.webhooks.constructEvent.mockReturnValueOnce(eventObj);
  return request(app)
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'test-sig')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(eventObj));
}

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// ── Signature failure ─────────────────────────────────────────────────────────
describe('Stripe webhook signature', () => {
  test('returns 400 when signature is invalid', async () => {
    stripe.webhooks.constructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature');
    });
    const res = await request(buildApp())
      .post('/api/webhooks/stripe')
      .set('stripe-signature', 'bad-sig')
      .set('Content-Type', 'application/json')
      .send('{}');
    expect(res.status).toBe(400);
  });
});

describe('Stripe webhook replay protection', () => {
  test('ignores already processed event ids without running side effects', async () => {
    const event = {
      id: 'evt_duplicate',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', metadata: { job_id: '10' } } },
    };
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await sendEvent(buildApp(), event);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, duplicate: true });
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

// ── checkout.session.completed ────────────────────────────────────────────────
describe('checkout.session.completed', () => {
  test('creates subscription and updates user tier', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: {
        mode: 'subscription',
        subscription: 'sub_123',
        customer: 'cus_123',
        metadata: { userId: '42', planId: '1' },
      }},
    };

    stripe.subscriptions = { retrieve: jest.fn().mockResolvedValueOnce({
      id: 'sub_123', status: 'active',
      current_period_start: 1700000000,
      current_period_end:   1702678400,
    })};

    mockQuery
      .mockResolvedValueOnce({ rows: [] })                              // INSERT subscription
      .mockResolvedValueOnce({ rows: [{ slug: 'pro', tier_slug: 'pro' }] }) // SELECT plan
      .mockResolvedValueOnce({ rows: [] });                             // UPDATE users tier

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
  });

  test('marks a food order paid when Stripe reports a completed checkout session', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: { object: {
        mode: 'payment',
        payment_status: 'paid',
        payment_intent: 'pi_food_123',
        metadata: { food_order_id: '88' },
      }},
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // beginWebhookEvent
      .mockResolvedValueOnce({
        rows: [{
          id: 88,
          restaurant_id: 3,
          business_id: 42,
          queue_number: 9,
          status: 'received',
          payment_status: 'requires_payment',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // mark processed

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_orders/.test(sql))).toBe(true);
  });
});

// ── customer.subscription.updated ────────────────────────────────────────────
describe('customer.subscription.updated', () => {
  test('updates subscription status and user', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: { object: {
        id: 'sub_123', status: 'active',
        current_period_start: 1700000000,
        current_period_end:   1702678400,
        cancel_at_period_end: false,
      }},
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE subscriptions
      .mockResolvedValueOnce({ rows: [{ user_id: 42 }] })    // SELECT user_id
      .mockResolvedValueOnce({ rows: [] });                   // UPDATE users

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
  });
});

// ── customer.subscription.deleted ────────────────────────────────────────────
describe('customer.subscription.deleted', () => {
  test('cancels subscription and reverts user to free tier', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_123' } },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE subscriptions cancelled
      .mockResolvedValueOnce({ rows: [{ user_id: 42 }] })    // SELECT user_id
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE users tier=free
      .mockResolvedValueOnce({ rows: [] });                   // UPDATE badges

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
  });
});

// ── invoice.payment_failed ────────────────────────────────────────────────────
describe('invoice.payment_failed', () => {
  test('marks subscription past_due', async () => {
    const event = {
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_123' } },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] })                    // UPDATE subscriptions past_due
      .mockResolvedValueOnce({ rows: [{ user_id: 42 }] })    // SELECT user_id
      .mockResolvedValueOnce({ rows: [] });                   // UPDATE users

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
  });
});

// ── payment_intent.amount_capturable_updated (Tier 3) ─────────────────────────
describe('payment_intent.amount_capturable_updated', () => {
  test('marks payment authorized', async () => {
    const event = {
      type: 'payment_intent.amount_capturable_updated',
      data: { object: { id: 'pi_test', metadata: { job_id: '10' } } },
    };
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE payments

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'authorized'"),
      expect.arrayContaining(['pi_test'])
    );
  });
});

// ── payment_intent.succeeded (Tier 3) ─────────────────────────────────────────
describe('payment_intent.succeeded', () => {
  test('marks payment captured and releases escrow', async () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test', metadata: { job_id: '10' } } },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE payments captured
      .mockResolvedValueOnce({ rows: [] }); // UPDATE jobs escrow released

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'captured'"),
      expect.arrayContaining(['pi_test'])
    );
  });

  test('marks a food order paid when the Stripe payment intent succeeds', async () => {
    const event = {
      type: 'payment_intent.succeeded',
      data: { object: {
        id: 'pi_food_999',
        metadata: { food_order_id: '88' },
      } },
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // beginWebhookEvent
      .mockResolvedValueOnce({
        rows: [{
          id: 88,
          restaurant_id: 3,
          business_id: 42,
          queue_number: 9,
          status: 'received',
          payment_status: 'requires_payment',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // mark processed

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_orders/.test(sql))).toBe(true);
  });
});

describe('payment_intent.payment_failed', () => {
  test('marks a food order failed when Stripe payment intent fails', async () => {
    const event = {
      type: 'payment_intent.payment_failed',
      data: { object: {
        id: 'pi_food_999',
        metadata: { food_order_id: '88' },
        last_payment_error: { message: 'Card declined' },
      } },
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // beginWebhookEvent
      .mockResolvedValueOnce({
        rows: [{
          id: 88,
          restaurant_id: 3,
          business_id: 42,
          queue_number: 9,
          status: 'received',
          payment_status: 'requires_payment',
        }],
      })
      .mockResolvedValueOnce({ rows: [] }); // mark processed

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE food_orders/.test(sql))).toBe(true);
  });
});

// ── payment_intent.payment_failed (Tier 3) ────────────────────────────────────
describe('payment_intent.payment_failed', () => {
  test('marks payment failed and reopens escrow', async () => {
    const event = {
      type: 'payment_intent.payment_failed',
      data: { object: {
        id: 'pi_test',
        metadata: { job_id: '10' },
        last_payment_error: { message: 'Card declined' },
      }},
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // UPDATE payments failed
      .mockResolvedValueOnce({ rows: [] }); // UPDATE jobs escrow=none

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'failed'"),
      expect.arrayContaining(['pi_test'])
    );
  });
});

describe('account.updated', () => {
  test('syncs connected account readiness back to the business record', async () => {
    const event = {
      id: 'evt_acct_123',
      type: 'account.updated',
      data: { object: {
        id: 'acct_123',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        default_currency: 'usd',
        country: 'US',
        requirements: { currently_due: [] },
      } },
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // beginWebhookEvent
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // sync business lookup
      .mockResolvedValueOnce({ rows: [] }) // UPDATE businesses
      .mockResolvedValueOnce({ rows: [] }) // UPDATE business_integrations
      .mockResolvedValueOnce({ rows: [] }); // mark processed

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql]) => /UPDATE businesses/.test(sql))).toBe(true);
  });
});

// ── charge.refunded (Tier 3) ──────────────────────────────────────────────────
describe('charge.refunded', () => {
  test('marks payment refunded', async () => {
    const event = {
      type: 'charge.refunded',
      data: { object: { payment_intent: 'pi_test' } },
    };
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE payments

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
  });
});

// ── Unknown event type ────────────────────────────────────────────────────────
describe('unknown event type', () => {
  test('returns 200 and ignores unknown event', async () => {
    const event = { type: 'some.unknown.event', data: { object: {} } };
    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
  });
});
