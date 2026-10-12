'use strict';

/**
 * Licensed cash-out partners for OxSteed Credit (decision #14).
 *
 * Interface every adapter implements:
 *   name                 string, matches payment_country_policies.cashout_partner
 *   countries            ISO country codes the partner can pay out in
 *   requiredEnv          env vars holding the partner's real credentials
 *   isConfigured()       true when every requiredEnv is set
 *   submitPayout({ requestId, amountMinor, currency, destinationRef, userId })
 *        → { status: 'submitted' | 'paid' | 'failed', reference, failureCode? }
 *   getPayoutStatus({ reference })
 *        → { status: 'submitted' | 'paid' | 'failed', failureCode? }
 *
 * No real partner integration ships here: credentials and contracts do not
 * exist yet. The adapters below are typed stubs that refuse to move money
 * (partner_integration_pending) until a real implementation replaces them.
 * Countries without a configured partner are spend-only.
 */

const { AppError } = require('../../middleware/errorHandler');

function stubPartner({ name, countries, requiredEnv, docs }) {
  return Object.freeze({
    name,
    countries,
    requiredEnv,
    docs,
    isConfigured() {
      return requiredEnv.every((key) => Boolean(process.env[key]));
    },
    async submitPayout() {
      throw new AppError(`${name} payouts are not integrated yet`, 503, 'partner_integration_pending', { partner: name });
    },
    async getPayoutStatus() {
      throw new AppError(`${name} payouts are not integrated yet`, 503, 'partner_integration_pending', { partner: name });
    },
  });
}

const registry = new Map();

function registerPartner(adapter) {
  for (const key of ['name', 'countries', 'isConfigured', 'submitPayout', 'getPayoutStatus']) {
    if (!adapter || adapter[key] === undefined) throw new Error(`Payout partner adapter is missing ${key}`);
  }
  registry.set(adapter.name, adapter);
  return adapter;
}

function unregisterPartner(name) {
  registry.delete(name);
}

function getPartner(name) {
  return name ? registry.get(name) || null : null;
}

function listPartners() {
  return [...registry.values()].map((p) => ({ name: p.name, countries: p.countries, configured: p.isConfigured(), requiredEnv: p.requiredEnv || [] }));
}

registerPartner(stubPartner({
  name: 'mpesa_b2c', countries: ['KE'],
  requiredEnv: ['MPESA_B2C_CONSUMER_KEY', 'MPESA_B2C_CONSUMER_SECRET', 'MPESA_B2C_SHORTCODE', 'MPESA_B2C_INITIATOR_NAME', 'MPESA_B2C_SECURITY_CREDENTIAL', 'MPESA_B2C_RESULT_URL'],
  docs: 'Safaricom Daraja B2C (licensed PSP agreement required)',
}));
registerPartner(stubPartner({
  name: 'moncash', countries: ['HT'],
  requiredEnv: ['MONCASH_CLIENT_ID', 'MONCASH_CLIENT_SECRET', 'MONCASH_BUSINESS_KEY'],
  docs: 'Digicel MonCash business payouts',
}));
registerPartner(stubPartner({
  name: 'wise_payouts', countries: ['GB', 'IE', 'CA'],
  requiredEnv: ['WISE_API_TOKEN', 'WISE_PROFILE_ID', 'WISE_WEBHOOK_PUBLIC_KEY'],
  docs: 'Wise Platform payouts API (business account + KYB required)',
}));

module.exports = { registerPartner, unregisterPartner, getPartner, listPartners, stubPartner };
