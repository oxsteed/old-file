'use strict';

/**
 * Rail dispatcher (spec phase 1). Every job that is hired records which rail
 * moves its money (jobs.payment_rail):
 *
 *   stripe   card / local methods through Stripe Connect (direct, destination
 *            or platform-hold charge model — see stripeChargeModel)
 *   credit   OxSteed Credit hold is the payment (where legally cleared)
 *   offline  customer and helper settle directly; not covered
 *
 * With FEATURE_PAYMENT_RAILS off, acceptance only records the rail that
 * mirrors today's payment_method (oxsteed → stripe, off_platform → offline)
 * and every existing code path runs unchanged.
 */

const { AppError } = require('../../middleware/errorHandler');
const logger = require('../../utils/logger');
const flags = require('../paymentLayerFlags');
const railPolicy = require('../paymentRailPolicy');
const creditRail = require('./creditRail');
const offlineRail = require('./offlineRail');

function legacyRailFor(paymentMethod) {
  return paymentMethod === 'off_platform' ? 'offline' : 'stripe';
}

function railOf(job) {
  if (job?.payment_rail) return job.payment_rail;
  if (job?.transaction_mode === 'guided_protected') return 'stripe';
  return job?.assigned_helper_id ? 'offline' : null;
}

/** Normalize the accept request: payment_rail (new) or payment_method (legacy). */
function paymentMethodForRequest(body = {}) {
  if (flags.isEnabled('PAYMENT_RAILS') && body.payment_rail !== undefined && body.payment_rail !== null) {
    const rail = String(body.payment_rail);
    if (!railPolicy.RAILS.includes(rail)) {
      throw new AppError('payment_rail must be stripe, credit or offline', 400, 'payment_rail_invalid', { payment_rail: 'invalid' });
    }
    return { rail, paymentMethod: rail === 'offline' ? 'off_platform' : 'oxsteed' };
  }
  return { rail: null, paymentMethod: body.payment_method };
}

async function loadParties(client, { customerId, helperId }) {
  const { rows } = await client.query(
    `SELECT id, country, preferred_currency, preferred_language, timezone, tier, membership_tier,
            subscription_status, didit_status
       FROM users WHERE id = ANY($1::uuid[])`,
    [[customerId, helperId]]
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const { rows: done } = await client.query(
    `SELECT COUNT(*)::int AS n FROM jobs WHERE client_id = $1 AND status::text IN ('completed', 'closed')`,
    [customerId]
  );
  return { customer: byId.get(String(customerId)) || { id: customerId }, helper: byId.get(String(helperId)) || { id: helperId }, customerCompletedJobs: done[0]?.n || 0 };
}

/**
 * Inside assignHelper's transaction, after the job row moved to accepted.
 * Returns { rail, currency, skipLegacyFinancials, skipLegacyCollateral }.
 */
async function applyAcceptance(client, { job, bid, customerId, paymentMethod, requestedRail = null, body = {}, isImpersonated = false }) {
  const rail = requestedRail || legacyRailFor(paymentMethod);
  if (!flags.isEnabled('PAYMENT_RAILS')) {
    await client.query('UPDATE jobs SET payment_rail = $2 WHERE id = $1', [job.id, rail]);
    return { rail, currency: 'USD', skipLegacyFinancials: false, skipLegacyCollateral: false, legacy: true };
  }
  const amountMinor = Number(bid.amount_cents);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new AppError('Bid amount is required to accept', 400, 'validation_failed', { amount: 'Valid bid amount required' });
  }
  const parties = await loadParties(client, { customerId, helperId: bid.helper_id });
  const options = await railPolicy.railOptions(client, { job, amountMinor, ...parties });
  const entry = railPolicy.assertRailAvailable(options, rail);
  const currency = options.settlement_currency;
  if (bid.currency_code && String(bid.currency_code).trim().toUpperCase() !== currency) {
    throw new AppError('The bid currency does not match the job currency', 409, 'bid_currency_mismatch', { currency_code: 'bid_currency_mismatch' });
  }
  const country = options.country;
  const policy = await railPolicy.getCountryPolicy(client, country);
  let effectiveRail = rail;
  const result = { rail, currency, skipLegacyFinancials: false, skipLegacyCollateral: false, legacy: false };

  if (rail === 'offline') {
    if (entry.requires_offline_ack && body.offline_ack !== true) {
      throw new AppError('Confirm that direct payments are not covered by OxSteed', 422, 'offline_ack_required', { offline_ack: 'required' });
    }
    await offlineRail.recordAcceptanceAck(client, { job, amountMinor, currency });
  } else if (rail === 'credit' && entry.mode === 'payment') {
    const { setFinancialsMinor } = require('../../models/jobModel');
    const fin = await setFinancialsMinor(job.id, amountMinor, { currency, country, rail: 'credit' }, client);
    await creditRail.placePaymentHold(client, {
      job, bid, customer: parties.customer, amountMinor, settlementCurrency: currency,
      fxQuoteId: body.fx_quote_id || null, creditQuoteId: body.credit_quote_id || null,
      platformFeeMinor: fin.platform_fee_cents, isImpersonated,
    });
    result.skipLegacyFinancials = true;
    result.skipLegacyCollateral = true;
  } else {
    // stripe, or credit in collateral mode (the money still moves by Stripe).
    effectiveRail = 'stripe';
    if (currency !== 'USD' || flags.isEnabled('COUNTRY_FEES')) {
      const { setFinancialsMinor } = require('../../models/jobModel');
      await setFinancialsMinor(job.id, amountMinor, { currency, country, rail: 'stripe' }, client);
      result.skipLegacyFinancials = true;
    }
    // USD collateral cannot back a non-USD price; collateral mode re-places
    // it in the job currency through the legacy path's currency argument.
    result.skipLegacyCollateral = currency !== 'USD' && !(rail === 'credit' && entry.mode === 'collateral');
  }
  await client.query(
    `UPDATE jobs SET payment_rail = $2, settlement_currency = $3, payment_rail_locked_at = NOW(),
            location_country_code = COALESCE(location_country_code, $4)
      WHERE id = $1`,
    [job.id, effectiveRail, currency, country]
  );
  result.rail = effectiveRail;
  logger.info('payment_rails.accepted', { jobId: job.id, rail: effectiveRail, requested: rail, currency, country, policy: Boolean(policy) });
  return result;
}

/** Rail-specific completion guards (inside completeJob's transaction). */
async function assertCompletable(client, job) {
  if (!flags.isEnabled('PAYMENT_RAILS')) return;
  if (railOf(job) === 'credit') {
    const payment = await creditRail.activePayment(client, job.id);
    if (!payment) throw new AppError('No Credit payment is held for this job', 409, 'credit_payment_missing');
  }
}

/** Rail-specific settlement on completion (inside completeJob's transaction). */
async function onComplete(client, job, { actorUserId }) {
  if (railOf(job) === 'credit') {
    const payment = await creditRail.activePayment(client, job.id);
    if (payment) return { rail: 'credit', ...(await creditRail.capturePayment(client, { job, actorUserId })) };
  }
  return { rail: railOf(job) };
}

/** After a cancellation commits: give held money back. Idempotent. */
async function onCancelled(jobId) {
  const pool = require('../../db');
  const { withTransaction } = require('../../utils/transaction');
  await withTransaction(pool, async (client) => {
    const { rows } = await client.query('SELECT * FROM jobs WHERE id = $1 FOR UPDATE', [jobId]);
    if (!rows[0]) return;
    await creditRail.releasePayment(client, { job: rows[0], reason: 'job_cancelled' });
  }, 'payment_rails_cancel_credit');
  const { rows: held } = await pool.query(
    `SELECT id, stripe_payment_intent_id FROM payments
      WHERE job_id = $1 AND charge_model = 'platform_hold' AND status = 'authorized'`,
    [jobId]
  );
  if (!held.length) return;
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const chargeModel = require('../stripeChargeModel');
  for (const payment of held) {
    await chargeModel.releaseIntent(stripe, { intentId: payment.stripe_payment_intent_id, model: 'platform_hold', idempotencyKey: `payment-hold-cancel-refund:${payment.id}` });
    await pool.query(
      `UPDATE payments SET status = 'refunded', payment_hold_status = 'released', refunded_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'authorized'`,
      [payment.id]
    );
  }
}

module.exports = {
  legacyRailFor,
  railOf,
  paymentMethodForRequest,
  applyAcceptance,
  assertCompletable,
  onComplete,
  onCancelled,
  loadParties,
};
