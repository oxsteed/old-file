'use strict';

/**
 * Stripe charge models for job payments (decisions #1 #2 #5 #17).
 *
 *   direct         Today's US model: manual-capture PaymentIntent created ON
 *                  the helper's connected account (Stripe-Account header).
 *   destination    International: the PaymentIntent lives on the platform
 *                  with on_behalf_of + transfer_data.destination = the
 *                  helper's Express account, so the helper is the settlement
 *                  merchant and the platform takes application_fee_amount.
 *   platform_hold  Charge now, keep the funds on the platform (on_behalf_of,
 *                  no automatic transfer). Used for local methods without
 *                  auth/capture and for jobs scheduled > 5 days out. On
 *                  completion a Transfer pays the helper; cancel = refund.
 *
 * payments.stripe_account_id is only set for direct charges; the other
 * models store the helper account in payments.destination_account_id.
 */

const money = require('../validation/money');

const MODELS = Object.freeze(['direct', 'destination', 'platform_hold']);

function modelOf(row) {
  return MODELS.includes(row?.charge_model) ? row.charge_model : 'direct';
}

/** Request options for calls on an existing payment/attempt row. */
function requestOptions(row, extra = {}) {
  const account = modelOf(row) === 'direct' ? row?.stripe_account_id : null;
  return account ? { stripeAccount: account, ...extra } : { ...extra };
}

/** PaymentIntent create params + request options for a charge model. */
function intentParams({ model = 'direct', amountMinor, currency = 'USD', applicationFeeMinor, helperAccountId, paymentMethodTypes = ['card'], metadata = {} }) {
  const params = {
    amount: amountMinor,
    currency: String(money.normalizeCurrency(currency) || 'USD').toLowerCase(),
    payment_method_types: paymentMethodTypes,
    capture_method: model === 'platform_hold' ? 'automatic' : 'manual',
    metadata: { ...metadata, charge_model: model },
  };
  if (model === 'direct') {
    // Stripe rejects application_fee_amount: 0 on direct charges; omit it
    // when the platform-funded discount consumed the whole fee (P2-6-F09).
    if (Number(applicationFeeMinor) > 0) params.application_fee_amount = applicationFeeMinor;
    return { params, options: { stripeAccount: helperAccountId } };
  }
  params.on_behalf_of = helperAccountId;
  if (model === 'destination') {
    if (Number(applicationFeeMinor) > 0) params.application_fee_amount = applicationFeeMinor;
    params.transfer_data = { destination: helperAccountId };
  } else {
    params.transfer_group = metadata.job_id ? `job_${metadata.job_id}` : undefined;
    if (!params.transfer_group) delete params.transfer_group;
  }
  return { params, options: {} };
}

/** Amount the intent makes available to the job (capturable or already charged). */
function fundedAmount(intent, model) {
  if (model === 'platform_hold') {
    return intent?.status === 'succeeded' ? Number(intent.amount_received ?? intent.amount) : 0;
  }
  return Number(intent?.amount_capturable ?? intent?.amount ?? 0);
}

function isFunded(intent, model) {
  return model === 'platform_hold' ? intent?.status === 'succeeded' : intent?.status === 'requires_capture';
}

/**
 * Release money that is no longer needed: cancel an uncaptured
 * authorization, or refund a platform-held charge.
 */
async function releaseIntent(stripe, { intentId, model, stripeAccount, idempotencyKey }) {
  if (!intentId) return false;
  if (model === 'platform_hold') {
    if (typeof stripe.refunds?.create !== 'function') return false;
    await stripe.refunds.create({ payment_intent: intentId, reason: 'requested_by_customer' }, { idempotencyKey });
    return true;
  }
  if (typeof stripe.paymentIntents?.cancel !== 'function') return false;
  if (model === 'direct' && !stripeAccount) return false;
  await stripe.paymentIntents.cancel(intentId, {}, stripeAccount ? { stripeAccount, idempotencyKey } : { idempotencyKey });
  return true;
}

module.exports = { MODELS, modelOf, requestOptions, intentParams, fundedAmount, isFunded, releaseIntent };
