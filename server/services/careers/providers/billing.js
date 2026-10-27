'use strict';

// Boosts and bulk-hiring events through Stripe Checkout (careers spec
// §18.1, Q20). Prices are set by the owner before launch, as Stripe price
// ids in env. Off unless CAREERS_BILLING_ENABLED=true with a Stripe key, a
// careers webhook secret and the price ids. Boosts never touch ranking.

const { billingConfig } = require('./config');
const { ProviderNotConfigured } = require('./checkr');

function status() {
  const cfg = billingConfig();
  return {
    provider: 'stripe',
    enabled: cfg.enabled,
    configured: cfg.configured,
    plans: Object.fromEntries(Object.entries(cfg.boostPriceIds).map(([k, v]) => [k, Boolean(v)])),
  };
}

function stripeClient() {
  const cfg = billingConfig();
  if (!cfg.configured) throw new ProviderNotConfigured('billing', 'platform_not_configured');
  // eslint-disable-next-line global-require
  return require('stripe')(cfg.stripeKey);
}

async function createCheckout({ plan, kind, recordId, businessId, successUrl, cancelUrl, idempotencyKey, stripe = null }) {
  const cfg = billingConfig();
  const price = cfg.boostPriceIds[plan];
  if (!cfg.configured || !price) throw new ProviderNotConfigured('billing', price ? 'platform_not_configured' : 'plan_not_priced');
  const client = stripe || stripeClient();
  const session = await client.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { careers_kind: kind, careers_record_id: String(recordId), business_id: String(businessId) },
  }, { idempotencyKey: `careers-${kind}-${idempotencyKey}` });
  return { checkoutUrl: session.url, sessionId: session.id, amountTotal: session.amount_total ?? null, currency: session.currency || null };
}

function constructEvent(rawBody, signature, stripe = null) {
  const cfg = billingConfig();
  if (!cfg.configured) throw new ProviderNotConfigured('billing', 'platform_not_configured');
  const client = stripe || stripeClient();
  return client.webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
}

module.exports = { status, createCheckout, constructEvent };
