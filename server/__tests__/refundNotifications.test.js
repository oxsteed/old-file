'use strict';

/**
 * Review P3-3-F07: refunds must notify the money recipient. Covers the
 * shared notifyRefundIssued helper plus the marketplace and external
 * (consulting/support) refund services wiring it in on a settled refund.
 */

const { mockQuery, resetMocks } = require('./setup');

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));

const { sendNotification } = require('../services/notificationService');
const { notifyRefundIssued } = require('../services/refundNotification');
const stripe = require('stripe')();

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

describe('notifyRefundIssued', () => {
  test('skips silently when there is no recipient', async () => {
    const result = await notifyRefundIssued({ userId: null, surface: 'food_order', referenceId: 1 });
    expect(result).toEqual({ notified: false, reason: 'no_recipient' });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  test('sends a refund notification with a stable idempotency key', async () => {
    const result = await notifyRefundIssued({
      userId: 'customer-1',
      idempotencyKey: 'food-order:9:refund-issued',
      amountCents: 2500,
      currency: 'USD',
      surface: 'food_order',
      referenceId: 9,
      refundId: 're_9',
      actionUrl: '/food/track/abc',
    });
    expect(result).toEqual({ notified: true });
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'customer-1',
      type: 'refund',
      idempotencyKey: 'food-order:9:refund-issued',
      action_url: '/food/track/abc',
    }));
    const call = sendNotification.mock.calls[0][0];
    expect(call.data).toMatchObject({
      amount_cents: 2500,
      currency: 'USD',
      surface: 'food_order',
      reference_id: '9',
      refund_id: 're_9',
    });
  });

  test('never throws when delivery fails', async () => {
    sendNotification.mockRejectedValueOnce(new Error('provider down'));
    const result = await notifyRefundIssued({ userId: 'customer-1', surface: 'food_order', referenceId: 1 });
    expect(result).toEqual({ notified: false, reason: 'send_failed' });
  });
});

describe('marketplace refunds notify the customer', () => {
  const { processMarketplaceRefund } = require('../services/marketplaceRefundService');

  test('a settled refund emits a refund notification to the order customer', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42, customer_id: 'customer-42', status: 'paid' }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, order_id: 42, payment_intent_id: 'pi_42', amount_cents: 1000, currency: 'usd', status: 'succeeded', refunded_amount_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 7, order_id: 42, transaction_id: 9, payment_intent_id: 'pi_42', amount_cents: 400, reason: 'Damaged item', idempotency_key: 'marketplace:42:partial-refund-42', status: 'pending', actor_user_id: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, order_id: 42, transaction_id: 9, payment_intent_id: 'pi_42', amount_cents: 400, reason: 'Damaged item', idempotency_key: 'marketplace:42:partial-refund-42', status: 'pending', actor_user_id: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, amount_cents: 1000, refunded_amount_cents: 0, currency: 'usd', status: 'succeeded' }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, amount_cents: 400, status: 'succeeded', provider_refund_id: 're_42' }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, amount_cents: 1000, refunded_amount_cents: 400, status: 'succeeded' }] })
      .mockResolvedValueOnce({ rows: [{ id: 42, customer_id: 'customer-42', status: 'paid' }] })
      .mockResolvedValueOnce({ rows: [] });
    stripe.refunds.create.mockResolvedValueOnce({
      id: 're_42', payment_intent: 'pi_42', amount: 400, currency: 'usd', status: 'succeeded',
    });

    const result = await processMarketplaceRefund({
      orderId: 42,
      requestedAmountCents: 400,
      reason: 'Damaged item',
      actorUserId: 3,
      requestId: 'partial-refund-42',
    });

    expect(result.refund.status).toBe('succeeded');
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'customer-42',
      type: 'refund',
      idempotencyKey: 'marketplace-refund:7:succeeded',
    }));
  });

  test('a replayed refund does not notify twice', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 42, customer_id: 'customer-42', status: 'paid' }] })
      .mockResolvedValueOnce({ rows: [{ id: 9, order_id: 42, payment_intent_id: 'pi_42', amount_cents: 1000, currency: 'usd', status: 'succeeded', refunded_amount_cents: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, order_id: 42, transaction_id: 9, payment_intent_id: 'pi_42', amount_cents: 400, reason: 'x', idempotency_key: 'marketplace:42:partial-1', status: 'succeeded', actor_user_id: 3 }] });

    const result = await processMarketplaceRefund({
      orderId: 42,
      requestedAmountCents: 400,
      reason: 'x',
      actorUserId: 3,
      requestId: 'partial-1',
    });
    expect(result.replay).toBe(true);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe('external refunds notify the metadata recipient', () => {
  const { processExternalRefund } = require('../services/externalRefundService');

  function chainSucceededAttempt(metadata) {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 41, rail: 'consulting', reference_id: '41', provider_payment_intent_id: 'pi_c', amount_cents: 10000, currency: 'USD', idempotency_key: 'consulting-payment-refund-41', status: 'pending', metadata }] })
      .mockResolvedValueOnce({ rows: [{ id: 41, rail: 'consulting', reference_id: '41', provider_payment_intent_id: 'pi_c', amount_cents: 10000, currency: 'USD', idempotency_key: 'consulting-payment-refund-41', status: 'pending', metadata }] })
      .mockResolvedValueOnce({ rows: [{ id: 41, rail: 'consulting', reference_id: '41', provider_payment_intent_id: 'pi_c', amount_cents: 10000, currency: 'USD', status: 'succeeded', provider_refund_id: 're_c', metadata }] });
    stripe.refunds.create.mockResolvedValueOnce({
      id: 're_c', payment_intent: 'pi_c', amount: 10000, currency: 'usd', status: 'succeeded',
    });
  }

  test('notifies the consulting payer when metadata carries notify_user_id', async () => {
    chainSucceededAttempt({ notify_user_id: 'payer-1', action_url: '/consulting' });
    const result = await processExternalRefund({
      rail: 'consulting', referenceId: 41, paymentIntentId: 'pi_c', amountCents: 10000,
      actorUserId: 'admin-1', requestId: 'consulting-payment-refund-41',
      metadata: { notify_user_id: 'payer-1', action_url: '/consulting' },
    });
    expect(result.attempt.status).toBe('succeeded');
    expect(sendNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'payer-1',
      type: 'refund',
      idempotencyKey: 'external-refund:41:succeeded',
      action_url: '/consulting',
    }));
  });

  test('stays silent when no recipient is supplied', async () => {
    chainSucceededAttempt({});
    const result = await processExternalRefund({
      rail: 'consulting', referenceId: 41, paymentIntentId: 'pi_c', amountCents: 10000,
      actorUserId: 'admin-1', requestId: 'consulting-payment-refund-41',
    });
    expect(result.attempt.status).toBe('succeeded');
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
