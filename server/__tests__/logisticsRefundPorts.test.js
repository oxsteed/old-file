'use strict';

const { stripePort } = require('../services/logisticsRefundPorts');

const stripe = require('stripe').__mockInstance;

beforeEach(() => {
  stripe.refunds.create.mockReset();
});

test('logistics Stripe refund port requires a durable provider reference', async () => {
  stripe.refunds.create.mockResolvedValueOnce({ status: 'pending' });

  await expect(stripePort.createRefund({
    paymentIntentId: 'pi_logistics',
    amountCents: 1200,
    idempotencyKey: 'logistics-refund-test',
  })).rejects.toMatchObject({ code: 'refund_provider_reference_missing', statusCode: 503 });
});

test('logistics Stripe refund port returns the verified provider identity', async () => {
  stripe.refunds.create.mockResolvedValueOnce({ id: 're_logistics', status: 'pending' });

  await expect(stripePort.createRefund({
    paymentIntentId: 'pi_logistics',
    amountCents: 1200,
    idempotencyKey: 'logistics-refund-test',
  })).resolves.toEqual({ id: 're_logistics', status: 'pending' });
});
