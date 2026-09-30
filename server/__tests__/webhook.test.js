'use strict';

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/localDeliveryPaymentService', () => ({
  handleStripeEvent: jest.fn().mockResolvedValue({ handled: false }),
}));

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

test('verified delivery event uses delivery service before generic handlers and marks receipt processed', async () => {
  const delivery = require('../services/localDeliveryPaymentService');
  const event = { id: 'evt_delivery', type: 'checkout.session.completed', data: {
    object: { id: 'cs_delivery', metadata: { source: 'local_delivery_v1' } },
  } };
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 88 }] });
  delivery.handleStripeEvent.mockResolvedValueOnce({ handled: true });
  const response = await sendEvent(buildApp(), event);
  expect(response.status).toBe(200);
  expect(delivery.handleStripeEvent).toHaveBeenCalledWith(event);
  expect(mockQuery).toHaveBeenCalledTimes(2);
  expect(mockQuery.mock.calls[1][0]).toContain("SET status = 'processed'");
});

test('delivery verification errors mark webhook failed for provider retry', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 88 }] });
  require('../services/localDeliveryPaymentService').handleStripeEvent.mockRejectedValueOnce(new Error('delivery mismatch'));
  const response = await sendEvent(buildApp(), { id: 'evt_delivery_bad', type: 'checkout.session.completed',
    data: { object: { id: 'cs_delivery' } } });
  expect(response.status).toBe(500);
  expect(mockQuery.mock.calls[1][0]).toContain("SET status = 'failed'");
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

describe('Stripe destination isolation and modern snapshots', () => {
  test('platform destination rejects connected-account events before database writes', async () => {
    const response = await sendEvent(buildApp(), { account: 'acct_connected', type: 'account.updated', data: { object: { id: 'acct_connected' } } });
    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('unconfigured Connect destination fails closed without database writes', async () => {
    const previous = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    try {
      const response = await request(buildApp()).post('/api/webhooks/stripe/connect')
        .set('Content-Type', 'application/json').send('{}');
      expect(response.status).toBe(503);
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      if (previous !== undefined) process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous;
    }
  });

  test('Connect uses its own signing secret and requires an account source', async () => {
    const previous = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_isolated_connect_fixture';
    try {
      stripe.webhooks.constructEvent.mockReturnValueOnce({ type: 'account.updated', data: { object: { id: 'acct_platform' } } });
      const response = await request(buildApp()).post('/api/webhooks/stripe/connect')
        .set('stripe-signature', 'fixture').set('Content-Type', 'application/json').send('{}');
      expect(response.status).toBe(400);
      expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(expect.any(Buffer), 'fixture', 'whsec_isolated_connect_fixture');
      expect(mockQuery).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
      else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous;
    }
  });

  test('invoice.paid recognizes the Clover parent subscription and item billing period', async () => {
    stripe.subscriptions.retrieve.mockResolvedValueOnce({ id: 'sub_clover', status: 'active', cancel_at_period_end: false,
      items: { data: [{ current_period_start: 1700000000, current_period_end: 1702678400 }] } });
    const response = await sendEvent(buildApp(), { type: 'invoice.paid', data: { object: {
      id: 'in_clover', parent: { subscription_details: { subscription: { id: 'sub_clover' } } },
    } } });
    expect(response.status).toBe(200);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_clover');
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE subscriptions'),
      ['active', 1700000000, 1702678400, false, 'sub_clover']);
  });

  test('connected-account updates bind all parameters and scope the current account', async () => {
    const previous = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_isolated_connect_fixture';
    try {
      stripe.webhooks.constructEvent.mockReturnValueOnce({ account: 'acct_connected', type: 'account.updated', data: {
        object: { id: 'acct_connected', charges_enabled: true, payouts_enabled: true, details_submitted: true },
      } });
      mockQuery.mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ user_id: 'user_fixture' }] });
      const response = await request(buildApp()).post('/api/webhooks/stripe/connect')
        .set('Content-Type', 'application/json').send('{}');
      expect(response.status).toBe(200);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE stripe_account_id = $1 AND user_id = $5'),
        ['acct_connected', true, true, true, 'user_fixture']);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
      else process.env.STRIPE_CONNECT_WEBHOOK_SECRET = previous;
    }
  });

  test('renewal provider failure is retried instead of acknowledging an unapplied renewal', async () => {
    stripe.subscriptions.retrieve.mockRejectedValueOnce(new Error('temporary provider failure'));
    const response = await sendEvent(buildApp(), { type: 'invoice.paid', data: { object: { subscription: 'sub_retry' } } });
    expect(response.status).toBe(500);
    expect(mockQuery.mock.calls.some(([sql]) => sql.includes('UPDATE subscriptions'))).toBe(false);
  });
});

describe('Stripe webhook replay protection', () => {
  test('different refunds on the same intent use independent watermarks', async () => {
    const event = { id: 'evt_refund_independent', created: 100, type: 'refund.updated',
      data: { object: { id: 're_independent', payment_intent: 'pi_shared', status: 'pending' } } };
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 81 }] })
      .mockResolvedValueOnce({ rows: [{ event_id: event.id }] });
    const response = await sendEvent(buildApp(), event);
    expect(response.status).toBe(200);
    const watermark = mockQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO webhook_event_watermarks'));
    expect(watermark[1]).toEqual(['stripe', 'refund', 're_independent', 100, event.id]);
  });
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

  test('ignores an older event for the same provider object', async () => {
    const latest = {
      id: 'evt_latest',
      created: 200,
      type: 'payment_intent.unknown',
      data: { object: { id: 'pi_ordered' } },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 10 }] }) // beginWebhookEvent
      .mockResolvedValueOnce({ rows: [{ event_id: latest.id }] }) // watermark advances
      .mockResolvedValueOnce({ rows: [] }); // mark processed

    const latestResponse = await sendEvent(buildApp(), latest);
    expect(latestResponse.status).toBe(200);

    const older = {
      id: 'evt_older',
      created: 100,
      type: 'payment_intent.unknown',
      data: { object: { id: 'pi_ordered' } },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 11 }] }) // beginWebhookEvent
      .mockResolvedValueOnce({ rows: [] }) // watermark rejects stale event
      .mockResolvedValueOnce({ rows: [] }); // stale receipt is finalized

    const olderResponse = await sendEvent(buildApp(), older);
    expect(olderResponse.status).toBe(200);
    expect(olderResponse.body).toMatchObject({ received: true, duplicate: true, stale: true });
  });

  test('allows the same failed event to retry after it advances the watermark', async () => {
    const event = {
      id: 'evt_retry_ordered',
      created: 300,
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_retry_ordered', metadata: { job_id: '10' } } },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12 }] }) // beginWebhookEvent
      .mockResolvedValueOnce({ rows: [{ event_id: event.id }] }) // watermark advances
      .mockRejectedValueOnce(new Error('database temporarily unavailable')) // payment update
      .mockResolvedValueOnce({ rows: [] }); // mark failed

    const failedResponse = await sendEvent(buildApp(), event);
    expect(failedResponse.status).toBe(500);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 12 }] }) // failed receipt is claimable
      .mockResolvedValueOnce({ rows: [{ event_id: event.id }] }) // same watermark is retryable
      .mockResolvedValueOnce({ rows: [] }) // payment update
      .mockResolvedValueOnce({ rows: [] }) // job update
      .mockResolvedValueOnce({ rows: [] }); // mark processed

    const retryResponse = await sendEvent(buildApp(), event);
    expect(retryResponse.status).toBe(200);
    expect(retryResponse.body).toMatchObject({ received: true });
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
      data: { object: { id: 'ch_test', payment_intent: 'pi_test', amount: 1000, amount_refunded: 1000, currency: 'usd' } },
    };
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE payments

    const res = await sendEvent(buildApp(), event);
    expect(res.status).toBe(200);
  });
});

describe('Stripe webhook failure recovery', () => {
  test('records a failed delivery and allows the same event to retry successfully', async () => {
    const event = {
      id: 'evt_retry_after_failure',
      type: 'account.updated',
      data: { object: {
        id: 'acct_retry',
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: { currently_due: [] },
      } },
    };
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 77 }] }) // beginWebhookEvent
      .mockRejectedValueOnce(new Error('database temporarily unavailable'))
      .mockResolvedValueOnce({ rows: [] }); // markWebhookEventFailed

    const failed = await sendEvent(buildApp(), event);
    expect(failed.status).toBe(500);
    expect(mockQuery.mock.calls.some(([sql]) => /status = 'failed'/.test(sql))).toBe(true);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 77 }] }) // failed receipt is claimable
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // business lookup
      .mockResolvedValueOnce({ rows: [] }) // UPDATE businesses
      .mockResolvedValueOnce({ rows: [] }) // UPDATE business_integrations
      .mockResolvedValueOnce({ rows: [] }); // mark processed

    const retried = await sendEvent(buildApp(), event);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ received: true });
    expect(mockQuery.mock.calls.some(([sql]) => /status = 'processed'/.test(sql))).toBe(true);
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
