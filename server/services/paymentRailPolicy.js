'use strict';

/**
 * Country policy + rail eligibility + fees (spec phase 1/3, locked
 * decisions #3 #4 #6 #7 #8 #13 #15). Pure where possible: callers pass the
 * rows they already locked; DB reads use the caller's client.
 */

const { AppError } = require('../middleware/errorHandler');
const { calculateTier3Fees } = require('../utils/feeCalculator');
const money = require('../validation/money');
const { normalizeCountryCode } = require('../validation/countries');
const flags = require('./paymentLayerFlags');

const RAILS = Object.freeze(['stripe', 'credit', 'offline']);
const PROTECTION = Object.freeze({ stripe: 3, credit: 2, offline: 1 });
const CACHE_MS = 60_000;
const cache = new Map();

function clearPolicyCache() {
  cache.clear();
}

async function getCountryPolicy(client, countryCode) {
  const code = normalizeCountryCode(countryCode || '') || 'US';
  const hit = cache.get(code);
  if (hit && hit.at > Date.now() - CACHE_MS) return hit.row;
  const { rows } = await client.query('SELECT * FROM payment_country_policies WHERE country_code = $1', [code]);
  const row = rows[0] || null;
  cache.set(code, { at: Date.now(), row });
  return row;
}

function jobCountry(job, customer) {
  return normalizeCountryCode(job?.location_country_code || job?.location_country || '')
    || normalizeCountryCode(customer?.country || '') || 'US';
}

function helperCountry(helper) {
  return normalizeCountryCode(helper?.country || '') || 'US';
}

/**
 * Currency of record (decision #4 + #11). Jobs are priced in the currency of
 * the country where the work happens (= the local helper's currency), bids
 * must match it, and the customer sees an estimate in their own currency.
 */
function settlementCurrency({ job }) {
  return money.normalizeCurrency(job?.settlement_currency) || money.normalizeCurrency(job?.currency_code) || 'USD';
}

function isSubscribed(user) {
  return String(user?.subscription_status || '').toLowerCase() === 'active'
    && String(user?.tier || user?.membership_tier || 'free').toLowerCase() !== 'free';
}

function isVerified(user) {
  return String(user?.didit_status || '').toLowerCase() === 'verified';
}

/**
 * Which rails can move the money for this hire. Returns
 * { country, settlement_currency, rails: [{ rail, available, reason, mode,
 *   protection, requires_offline_ack, charge_model }] }.
 * With FEATURE_PAYMENT_RAILS off this mirrors today's choice exactly.
 */
async function railOptions(client, { job, amountMinor, customer, helper, customerCompletedJobs = null }) {
  const country = jobCountry(job, customer);
  const hCountry = helperCountry(helper);
  if (!flags.isEnabled('PAYMENT_RAILS')) {
    return {
      engine: false,
      country,
      settlement_currency: money.normalizeCurrency(job?.currency_code) || 'USD',
      rails: [
        { rail: 'stripe', available: true, reason: null, mode: 'card', protection: PROTECTION.stripe, requires_offline_ack: false, charge_model: 'direct' },
        { rail: 'offline', available: true, reason: null, mode: 'direct', protection: PROTECTION.offline, requires_offline_ack: false, charge_model: null },
      ],
    };
  }
  const policy = await getCountryPolicy(client, country);
  const helperPolicy = hCountry === country ? policy : await getCountryPolicy(client, hCountry);
  const currency = settlementCurrency({ job });
  const out = { engine: true, country, helper_country: hCountry, settlement_currency: currency, rails: [] };
  const countryBlock = !policy ? 'country_not_supported'
    : !policy.tax_review_cleared ? 'country_tax_review_pending'
      : !policy.enabled ? 'country_not_enabled' : null;

  // Stripe card rail.
  let stripeReason = countryBlock;
  let chargeModel = 'direct';
  if (!stripeReason) {
    if (!policy.stripe_rail_enabled) stripeReason = 'rail_disabled_in_country';
    else if (!helperPolicy?.stripe_connect_supported) stripeReason = 'helper_country_unsupported';
    else if ((hCountry !== 'US' || currency !== 'USD') && !flags.isEnabled('STRIPE_INTL')) stripeReason = 'international_not_enabled';
  }
  if (flags.isEnabled('STRIPE_INTL') && (hCountry !== 'US' || currency !== 'USD')) chargeModel = 'destination';
  if (!stripeReason && longLeadJob(job) && flags.isEnabled('PLATFORM_HOLD') && policy.platform_hold_legal_cleared) chargeModel = 'platform_hold';
  out.rails.push({ rail: 'stripe', available: !stripeReason, reason: stripeReason, mode: 'card', protection: PROTECTION.stripe, requires_offline_ack: false, charge_model: chargeModel,
    local_methods: localMethodsFor(policy) });

  // Credit rail: payment where legally cleared, else collateral (needs Stripe).
  let creditReason = countryBlock;
  let creditMode = null;
  if (!creditReason) {
    if (!flags.isEnabled('CREDIT_RAIL')) creditReason = 'credit_rail_not_enabled';
    else if (!policy.credit_rail_enabled) creditReason = 'rail_disabled_in_country';
    else if (!require('./paymentRails/creditRail').supportedCreditCurrency(currency)) creditReason = 'credit_currency_unsupported';
    else if (policy.credit_payment_legal_cleared) creditMode = 'payment';
    else if (!stripeReason) creditMode = 'collateral';
    else creditReason = 'credit_payment_not_cleared';
  }
  out.rails.push({ rail: 'credit', available: !creditReason, reason: creditReason, mode: creditMode, protection: PROTECTION.credit, requires_offline_ack: false, charge_model: null,
    fx_spread_bps: policy ? Math.min(100, Number(policy.credit_fx_spread_bps) || 0) : 0 });

  // Offline rail: subscription, verified helper, first-job cap (#8, #15).
  let offlineReason = countryBlock;
  if (!offlineReason && !policy.offline_rail_enabled) offlineReason = 'rail_disabled_in_country';
  if (!offlineReason && flags.isEnabled('OFFLINE_GATING')) {
    if (!isSubscribed(helper)) offlineReason = 'offline_requires_subscription';
    else if (!isVerified(helper)) offlineReason = 'offline_requires_verified_helper';
    else if (policy.offline_first_job_cap_minor && Number(customerCompletedJobs || 0) === 0) {
      const cap = Number(policy.offline_first_job_cap_minor);
      if (currency !== policy.default_currency || !Number.isSafeInteger(amountMinor) || amountMinor > cap) {
        offlineReason = 'offline_first_job_cap';
      }
    }
  }
  out.rails.push({ rail: 'offline', available: !offlineReason, reason: offlineReason, mode: 'direct', protection: PROTECTION.offline, requires_offline_ack: true, charge_model: null,
    first_job_cap_minor: policy?.offline_first_job_cap_minor ? Number(policy.offline_first_job_cap_minor) : null });
  return out;
}

function localMethodsFor(policy) {
  if (!policy || !flags.isEnabled('LOCAL_METHODS') || !flags.isEnabled('PLATFORM_HOLD')) return [];
  if (!policy.local_methods_legal_cleared) return [];
  return Array.isArray(policy.local_payment_methods) ? policy.local_payment_methods : [];
}

const LONG_LEAD_MS = 5 * 24 * 60 * 60 * 1000;
/** Jobs scheduled more than 5 days out are charged now and held (#17). */
function longLeadJob(job, now = Date.now()) {
  if (!job?.scheduled_start_at) return false;
  const start = new Date(job.scheduled_start_at).getTime();
  return Number.isFinite(start) && start - now > LONG_LEAD_MS;
}

function assertRailAvailable(options, rail) {
  if (!RAILS.includes(rail)) throw new AppError('Unknown payment rail', 400, 'payment_rail_invalid', { payment_rail: 'invalid' });
  const entry = options.rails.find((r) => r.rail === rail);
  if (!entry || !entry.available) {
    throw new AppError('This payment option is not available for this job', 409, entry?.reason || 'payment_rail_unavailable', { payment_rail: entry?.reason || 'unavailable' });
  }
  return entry;
}

/**
 * Platform fee for an amount (decision #7). With FEATURE_COUNTRY_FEES off,
 * delegates to the existing US calculator so fees are unchanged.
 */
function computeFees({ amountMinor, currency = 'USD', policy = null, rail = 'stripe' }) {
  if (!flags.isEnabled('COUNTRY_FEES') || !policy) {
    const legacy = calculateTier3Fees(amountMinor);
    return { platform_fee_minor: legacy.platform_fee_cents, application_fee_minor: legacy.application_fee_cents, fee_bps: null, credit_discount_bps: 0, fee_country: null };
  }
  let bps = Number(policy.platform_fee_bps) || 0;
  const discount = rail === 'credit' ? Math.min(bps, Number(policy.credit_fee_discount_bps) || 0) : 0;
  bps -= discount;
  let fee = money.bpsOf(amountMinor, bps);
  const min = currency === policy.default_currency ? Number(policy.platform_fee_min_minor) || 0 : 0;
  fee = Math.min(amountMinor, Math.max(fee, min));
  return { platform_fee_minor: fee, application_fee_minor: fee, fee_bps: bps, credit_discount_bps: discount, fee_country: policy.country_code };
}

/** Tips carry only payment processing cost; OxSteed keeps nothing (#9). */
function tipProcessingCost({ amountMinor, rail, policy }) {
  if (rail === 'credit') return 0;
  const bps = policy ? Number(policy.tip_processing_bps) : 290;
  const fixed = policy ? Number(policy.tip_processing_fixed_minor) : 30;
  return Math.min(amountMinor, money.bpsOf(amountMinor, bps, 'up') + fixed);
}

/** Is `to` less protected than `from` (switch needs consent before work). */
function isDowngrade(from, to) {
  return (PROTECTION[to] || 0) < (PROTECTION[from] || 0);
}

module.exports = {
  RAILS,
  PROTECTION,
  getCountryPolicy,
  clearPolicyCache,
  jobCountry,
  helperCountry,
  settlementCurrency,
  railOptions,
  assertRailAvailable,
  computeFees,
  tipProcessingCost,
  isDowngrade,
  longLeadJob,
  isSubscribed,
  isVerified,
};
