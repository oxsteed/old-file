'use strict';

/**
 * Launch flags for the international payment layers
 * (docs/payment-layers.md). Every flag defaults OFF so the existing US
 * behaviour is unchanged until ops turns a layer on. Flags are read on every
 * call so tests and ops toggles take effect without a restart.
 */

const FLAGS = Object.freeze({
  PLATFORM_PAYMENTS: 'FEATURE_PAYMENTS_ENABLED',         // protected (Tier-3 escrow) job payments are launched
  PAYMENT_RAILS: 'FEATURE_PAYMENT_RAILS',                 // rail engine, country gates, rail switching, offline ack
  STRIPE_INTL: 'FEATURE_RAIL_STRIPE_INTL',                // non-US Express accounts, destination charges, non-USD
  LOCAL_METHODS: 'FEATURE_STRIPE_LOCAL_METHODS',          // charge-now local methods (also needs country legal flag)
  PLATFORM_HOLD: 'FEATURE_PLATFORM_HOLD',                 // charge now + hold on platform (>5-day jobs, local methods)
  CREDIT_RAIL: 'FEATURE_RAIL_CREDIT',                     // Credit as payment / collateral fallback
  CREDIT_CASHOUT: 'FEATURE_CREDIT_CASHOUT',               // partner cash-out
  OFFLINE_GATING: 'FEATURE_RAIL_OFFLINE_GATING',          // subscription + verified helper + first-job cap
  COUNTRY_FEES: 'FEATURE_COUNTRY_FEES',                   // per-country fee schedule + Credit discount
  TIPS: 'FEATURE_JOB_TIPS',                               // tips (processing cost only)
  CONTACT_MASKING: 'FEATURE_CONTACT_MASKING',             // hide contact details before acceptance
  HOLD_EXPIRY_REAUTH: 'FEATURE_HOLD_EXPIRY_REAUTH',       // reauthorize card holds before expiry
  PRIVACY_RETENTION: 'FEATURE_PRIVACY_RETENTION',         // erasure + retention workers
  LOCALIZED_NOTIFICATIONS: 'FEATURE_LOCALIZED_NOTIFICATIONS',
  COUNTRY_SMS: 'FEATURE_COUNTRY_SMS',
  JOB_TIMEZONES: 'FEATURE_JOB_TIMEZONES',
});

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isEnabled(flag) {
  const envName = FLAGS[flag] || flag;
  return truthy(process.env[envName]);
}

function snapshot() {
  return Object.fromEntries(Object.keys(FLAGS).map((key) => [key, isEnabled(key)]));
}

module.exports = { FLAGS, isEnabled, snapshot };
