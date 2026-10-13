'use strict';

const paymentEvents = [
  'payment_intent.amount_capturable_updated', 'payment_intent.succeeded',
  'payment_intent.payment_failed', 'payment_intent.canceled',
  'refund.created', 'refund.updated', 'refund.failed', 'charge.refunded',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
];

// Review P3-1-F16: instant payouts are created on the connected account, so
// their lifecycle events arrive at the connect webhook destination. The
// local instant_payouts row is reconciled against them.
const payoutEvents = [
  'payout.created', 'payout.updated', 'payout.paid', 'payout.failed', 'payout.canceled',
];

// These are delivery contracts, not switches that activate financial products.
module.exports = Object.freeze({
  platform: Object.freeze({
    path: '/api/webhooks/stripe', secretEnv: 'STRIPE_WEBHOOK_SECRET',
    events: Object.freeze([
      ...paymentEvents, 'account.updated',
      'transfer.created', 'transfer.updated', 'transfer.reversed',
      'checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed', 'checkout.session.expired',
      'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
      'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed',
    ]),
  }),
  connect: Object.freeze({
    path: '/api/webhooks/stripe/connect', secretEnv: 'STRIPE_CONNECT_WEBHOOK_SECRET',
    // Review P1-297: QR scan-to-pay sessions are direct charges on the
    // connected account, so their checkout events arrive only here.
    events: Object.freeze([
      ...paymentEvents, 'account.updated',
      ...payoutEvents,
      'checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed', 'checkout.session.expired',
    ]),
  }),
  identity: Object.freeze({
    path: '/api/verification/webhooks/identity', secretEnv: 'STRIPE_IDENTITY_WEBHOOK_SECRET',
    events: Object.freeze(['identity.verification_session.verified', 'identity.verification_session.requires_input']),
  }),
});
