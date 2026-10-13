'use strict';

/**
 * Stripe rail planning (decisions #1 #2 #5 #17): which charge model, currency,
 * fee and payment method types a job's PaymentIntent uses. With the
 * international/platform-hold flags off this returns exactly today's direct
 * USD charge.
 */

const { AppError } = require('../../middleware/errorHandler');
const flags = require('../paymentLayerFlags');
const railPolicy = require('../paymentRailPolicy');
const money = require('../../validation/money');

function isLegacy() {
  return !flags.isEnabled('STRIPE_INTL') && !flags.isEnabled('PLATFORM_HOLD') && !flags.isEnabled('COUNTRY_FEES');
}

async function planIntent(client, { job, helper, amountMinor, requestedMethodType = null }) {
  const legacy = isLegacy();
  const currency = railPolicy.settlementCurrency({ job });
  if (legacy) {
    // Today's behaviour, unchanged: direct USD card charge, US fee schedule.
    const fees = railPolicy.computeFees({ amountMinor, currency: 'USD' });
    return { model: 'direct', currency: 'USD', amountMinor, fees, paymentMethodTypes: ['card'], feeCountry: null };
  }
  const country = railPolicy.jobCountry(job, null);
  const policy = await railPolicy.getCountryPolicy(client, country);
  const options = await railPolicy.railOptions(client, { job, amountMinor, customer: null, helper });
  const entry = railPolicy.assertRailAvailable(options, 'stripe');
  let model = entry.charge_model;
  let paymentMethodTypes = ['card'];
  if (requestedMethodType && requestedMethodType !== 'card') {
    if (!entry.local_methods.includes(requestedMethodType)) {
      throw new AppError('This payment method is not available here', 409, 'payment_method_unavailable', { payment_method_type: 'unavailable' });
    }
    // Local methods have no auth/capture: charge now, hold on platform (#5).
    model = 'platform_hold';
    paymentMethodTypes = [requestedMethodType];
  }
  const exp = money.currencyExponent(currency);
  const minimum = exp === 0 ? 50 : exp === 3 ? 500 : 50;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < minimum) {
    throw new AppError('The amount is below the minimum card charge', 400, 'payment_amount_too_small');
  }
  const fees = railPolicy.computeFees({ amountMinor, currency, policy, rail: 'stripe' });
  return { model, currency, amountMinor, fees, paymentMethodTypes, feeCountry: policy?.country_code || country };
}

/** Fees for the (possibly referral-discounted) amount actually charged. */
async function feesFor(client, plan, amountMinor) {
  const policy = plan.feeCountry ? await railPolicy.getCountryPolicy(client, plan.feeCountry) : null;
  const fees = railPolicy.computeFees({ amountMinor, currency: plan.currency, policy, rail: 'stripe' });
  return { platform_fee_cents: fees.platform_fee_minor, application_fee_cents: fees.application_fee_minor };
}

/** Country for a new Express account: the helper's when international is on. */
async function connectCountryFor(client, user) {
  if (!flags.isEnabled('STRIPE_INTL')) return 'US';
  const { rows } = await client.query('SELECT country FROM users WHERE id = $1', [user.id]);
  const country = railPolicy.helperCountry(rows[0] || user);
  const policy = await railPolicy.getCountryPolicy(client, country);
  if (!policy?.stripe_connect_supported) {
    throw new AppError('Card payouts are not available in your country yet', 409, 'helper_country_unsupported');
  }
  return country;
}

module.exports = { planIntent, feesFor, connectCountryFor, isLegacy };
