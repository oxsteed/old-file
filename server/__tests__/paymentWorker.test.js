'use strict';

jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn(),
}));

const { sendNotification } = require('../services/notificationService');
const { processNotification, processStripeWebhook } = require('../workers/paymentWorker');
const { mockQuery, resetMocks } = require('./setup');

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

test('notification worker delegates delivery to the real notification fan-out service', async () => {
  sendNotification.mockResolvedValue({ success: true, notificationId: 41 });

  await expect(processNotification({
    data: {
      userId: 'customer-1',
      type: 'oxsteed_credit_transaction',
      title: 'Credit posted',
      body: 'Your balance changed.',
      data: { transactionId: 'txn-1' },
      action_url: '/oxsteed-credit',
    },
  })).resolves.toEqual({
    success: true,
    userId: 'customer-1',
    type: 'oxsteed_credit_transaction',
    notificationId: 41,
  });

  expect(sendNotification).toHaveBeenCalledWith({
    userId: 'customer-1',
    type: 'oxsteed_credit_transaction',
    title: 'Credit posted',
    body: 'Your balance changed.',
    data: { transactionId: 'txn-1' },
    action_url: '/oxsteed-credit',
    pushToken: null,
  });
  expect(mockQuery).not.toHaveBeenCalled();
});

test('notification delivery failures are retried by the queue instead of acknowledged', async () => {
  sendNotification.mockResolvedValue({ success: false, reason: 'user_not_found' });

  await expect(processNotification({
    data: { userId: 'missing-customer', type: 'oxsteed_credit_transaction' },
  })).rejects.toThrow('user_not_found');
});

test('Stripe succeeded webhooks tolerate an intent without expanded charges', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

  await expect(processStripeWebhook({
    data: {
      eventType: 'payment_intent.succeeded',
      eventData: { id: 'pi_without_charges' },
    },
  })).resolves.toEqual({ handled: true });

  expect(mockQuery).toHaveBeenCalledWith(
    expect.stringContaining('stripe_charge_id'),
    ['succeeded', null, 'pi_without_charges'],
  );
});

test('Stripe webhook jobs fail when no local payment matches', async () => {
  mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

  await expect(processStripeWebhook({
    data: {
      eventType: 'payment_intent.succeeded',
      eventData: { id: 'pi_missing_local_payment' },
    },
  })).rejects.toThrow('No local payment matched Stripe webhook pi_missing_local_payment');
});
