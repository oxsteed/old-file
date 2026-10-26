'use strict';

// POS Stripe Terminal service.
//
// F-06: Terminal money settles to the RESTAURANT, never to the platform
// account. PaymentIntents are created as destination charges with
// transfer_data.destination set to the restaurant's Stripe Connect account
// (restaurant_connect_accounts is the single Connect source of truth, the
// same lookup the online card path in foodController uses). When the
// restaurant has no charges-enabled Connect account, every Terminal entry
// point fails closed with a typed error instead of minting value on the
// platform account.

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

const pool = require('../db');

function requireStripe() {
  if (!stripe) {
    const error = new Error('Stripe Terminal is not configured');
    error.code = 'stripe_not_configured';
    throw error;
  }
  return stripe;
}

function connectAccountMissingError() {
  const error = new Error(
    'This restaurant has not connected a Stripe account for POS Terminal payments'
  );
  error.code = 'restaurant_connect_account_missing';
  error.statusCode = 409;
  return error;
}

/**
 * Resolve the restaurant's charges-enabled Stripe Connect account id.
 * Throws the typed restaurant_connect_account_missing error when the
 * restaurant is unknown or has not finished Connect onboarding (fail
 * closed: no platform-account fallback, ever).
 */
async function resolveRestaurantConnectAccount(restaurantId) {
  const id = Number.parseInt(restaurantId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw connectAccountMissingError();
  const { rows: [row] } = await pool.query(
    `SELECT rca.stripe_account_id AS stripe_account_id,
            rca.charges_enabled AS charges_enabled
       FROM food_restaurants fr
       LEFT JOIN restaurant_connect_accounts rca ON rca.restaurant_id = fr.id
      WHERE fr.id = $1`,
    [id]
  );
  if (!row || !row.stripe_account_id || !row.charges_enabled) {
    throw connectAccountMissingError();
  }
  return row.stripe_account_id;
}

async function createConnectionToken(location, { restaurantId } = {}) {
  const client = requireStripe();
  const params = location ? { location } : {};
  if (restaurantId != null) {
    // Readers register on the restaurant's Connect account, so the token
    // is minted under that account (Stripe supports the stripeAccount
    // request option on Terminal connection tokens).
    const accountId = await resolveRestaurantConnectAccount(restaurantId);
    return client.terminal.connectionTokens.create(params, { stripeAccount: accountId });
  }
  return client.terminal.connectionTokens.create(params);
}

async function createPaymentIntent({ amountCents, currency, metadata, idempotencyKey, restaurantId }) {
  const client = requireStripe();
  // Callers pass restaurantId explicitly; the POS intent caller also
  // stamps it into metadata, which stays as a fallback so older call
  // sites cannot silently fall back to platform settlement.
  const resolvedRestaurantId = restaurantId ?? (metadata && metadata.restaurant_id);
  const destination = await resolveRestaurantConnectAccount(resolvedRestaurantId);
  // Same platform-fee policy as the online destination-charge path
  // (foodController): FOOD_CARD_FEE_BPS, 0 by default.
  const feeBps = Math.max(0, Math.min(10000, Number(process.env.FOOD_CARD_FEE_BPS ?? 0) || 0));
  const applicationFeeAmount = Math.floor((Number(amountCents) || 0) * feeBps / 10000);
  return client.paymentIntents.create(
    {
      amount: amountCents,
      currency: String(currency || 'USD').toLowerCase(),
      payment_method_types: ['card_present'],
      capture_method: 'manual',
      // Destination charge: funds settle to the restaurant's Connect
      // account; the platform keeps only application_fee_amount.
      transfer_data: { destination },
      ...(applicationFeeAmount > 0 ? { application_fee_amount: applicationFeeAmount } : {}),
      metadata,
    },
    { idempotencyKey }
  );
}

async function capturePaymentIntent(paymentIntentId, idempotencyKey, accountId = null) {
  const client = requireStripe();
  const current = accountId ? await client.paymentIntents.retrieve(paymentIntentId,{}, {stripeAccount:accountId}) : await client.paymentIntents.retrieve(paymentIntentId);
  if (current.status === 'succeeded') return current;
  if (current.status !== 'requires_capture') {
    const error = new Error(`PaymentIntent cannot be captured from ${current.status}`);
    error.code = 'payment_not_authorized';
    throw error;
  }
  return client.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey,...(accountId?{stripeAccount:accountId}:{}) });
}

async function createRefund({ paymentIntentId, amountCents, metadata, idempotencyKey, accountId = null }) {
  return requireStripe().refunds.create(
    {
      payment_intent: paymentIntentId,
      amount: amountCents,
      metadata,
    },
    { idempotencyKey,...(accountId?{stripeAccount:accountId}:{}) }
  );
}

module.exports = {
  // Offline (store-and-forward) intents carry metadata.offlineId; search finds
  // one the device forwarded but never reported back.
  searchConnectedIntentByOfflineId: async (offlineId,accountId)=>{
    if(!/^[0-9a-f-]{36}$/i.test(offlineId||''))throw new Error('invalid offline id');
    const res=await requireStripe().paymentIntents.search({query:`metadata['offlineId']:'${offlineId}'`,limit:2},{stripeAccount:accountId,timeout:15000,maxNetworkRetries:0});
    return res.data||[];
  },
  retrieveConnectedIntent: (id,accountId)=>requireStripe().paymentIntents.retrieve(id,{expand:['latest_charge']},{stripeAccount:accountId,timeout:15000,maxNetworkRetries:0}),
  createConnectionToken,
  createPaymentIntent,
  capturePaymentIntent,
  createRefund,
  resolveRestaurantConnectAccount,
};
