'use strict';

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

function requireStripe() {
  if (!stripe) {
    const error = new Error('Stripe Terminal is not configured');
    error.code = 'stripe_not_configured';
    throw error;
  }
  return stripe;
}

async function createConnectionToken(location) {
  return requireStripe().terminal.connectionTokens.create(location ? { location } : {});
}

async function createPaymentIntent({ amountCents, currency, metadata, idempotencyKey }) {
  return requireStripe().paymentIntents.create(
    {
      amount: amountCents,
      currency: String(currency || 'USD').toLowerCase(),
      payment_method_types: ['card_present'],
      capture_method: 'manual',
      metadata,
    },
    { idempotencyKey }
  );
}

async function capturePaymentIntent(paymentIntentId, idempotencyKey) {
  const client = requireStripe();
  const current = await client.paymentIntents.retrieve(paymentIntentId);
  if (current.status === 'succeeded') return current;
  if (current.status !== 'requires_capture') {
    const error = new Error(`PaymentIntent cannot be captured from ${current.status}`);
    error.code = 'payment_not_authorized';
    throw error;
  }
  return client.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey });
}

async function createRefund({ paymentIntentId, amountCents, metadata, idempotencyKey }) {
  return requireStripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      amount: amountCents,
      metadata,
    },
    { idempotencyKey }
  );
}

module.exports = {
  createConnectionToken,
  createPaymentIntent,
  capturePaymentIntent,
  createRefund,
};
