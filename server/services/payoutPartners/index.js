'use strict';

/**
 * Licensed cash-out partners for OxSteed Credit (decision #14).
 *
 * Interface every adapter implements:
 *   name                 string, matches payment_country_policies.cashout_partner
 *   countries            ISO country codes the partner can pay out in
 *   requiredEnv          env vars holding the partner's real credentials
 *   isConfigured()       true when every requiredEnv is set
 *   submitPayout({ client, requestId, amountMinor, currency, destination, userId, idempotencyKey })
 *        → { status: 'submitted' | 'paid' | 'failed', reference, failureCode? }
 *        idempotencyKey is stable per cash-out request (partner_idempotency_key)
 *        and MUST be forwarded to the partner so a retried call never pays twice.
 *   getPayoutStatus({ requestId, reference })
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
    integrated: false,
    credentialsPresent() {
      return requiredEnv.every((key) => Boolean(process.env[key]));
    },
    // A stub never counts as configured, even with credentials set: it
    // cannot move money, so the country stays spend-only until a real
    // adapter replaces it.
    isConfigured() {
      return false;
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
  return [...registry.values()].map((p) => ({
    name: p.name, countries: p.countries, configured: p.isConfigured(), integrated: p.integrated !== false,
    credentials_present: typeof p.credentialsPresent === 'function' ? p.credentialsPresent() : null, requiredEnv: p.requiredEnv || [],
  }));
}

registerPartner(stubPartner({
  name: 'mpesa_b2c', countries: ['KE'],
  requiredEnv: ['MPESA_B2C_CONSUMER_KEY', 'MPESA_B2C_CONSUMER_SECRET', 'MPESA_B2C_SHORTCODE', 'MPESA_B2C_INITIATOR_NAME', 'MPESA_B2C_SECURITY_CREDENTIAL', 'MPESA_B2C_RESULT_URL'],
  docs: 'Safaricom Daraja B2C (licensed PSP agreement required)',
}));
// MonCash was removed as Haiti's partner (licence readiness review bug 8):
// Haiti pays out through OxSteed's own bank payout rail below.

/**
 * OxSteed in-house bank payout rail (services/creditBankPayoutService.js).
 * submitPayout files an instruction for the treasury team's bank export;
 * the payout settles only when two different administrators confirm it
 * against the bank statement. Off unless OXSTEED_BANK_PAYOUT_ENABLED=true
 * and OXSTEED_BANK_PAYOUT_SOURCE_ACCOUNT is set.
 */
function bankPayoutCountries() {
  return String(process.env.OXSTEED_BANK_PAYOUT_COUNTRIES || 'HT')
    .split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
}

const oxsteedBankPayout = Object.freeze({
  name: 'oxsteed_bank_payout',
  get countries() { return bankPayoutCountries(); },
  requiredEnv: ['OXSTEED_BANK_PAYOUT_ENABLED', 'OXSTEED_BANK_PAYOUT_SOURCE_ACCOUNT'],
  docs: 'OxSteed in-house bank transfer rail (two-administrator confirmation)',
  integrated: true,
  inHouse: true,
  requiresVerifiedDestination: true,
  credentialsPresent() {
    return this.requiredEnv.every((key) => Boolean(process.env[key]));
  },
  isConfigured() {
    return require('../creditBankPayoutService').isRailConfigured();
  },
  // Called by the cash-out worker inside its lease. `client` is the
  // worker's transaction so the instruction and the 'submitted' state
  // commit together (outbox: nothing external happens here).
  async submitPayout({ client, requestId, amountMinor, destination, idempotencyKey }) {
    const bank = require('../creditBankPayoutService');
    const { instruction } = await bank.createInstruction(client, {
      purpose: 'cashout',
      idempotencyKey,
      destination,
      amountMinor,
      paymentReference: `OXSTEED CO ${requestId}`,
      cashoutId: requestId,
    });
    return { status: 'submitted', reference: `bank-instruction:${instruction.id}` };
  },
  async getPayoutStatus({ requestId }) {
    return require('../creditBankPayoutService').getInstructionStatusByCashout(requestId);
  },
});
registerPartner(oxsteedBankPayout);
registerPartner(stubPartner({
  name: 'wise_payouts', countries: ['GB', 'IE', 'CA'],
  requiredEnv: ['WISE_API_TOKEN', 'WISE_PROFILE_ID', 'WISE_WEBHOOK_PUBLIC_KEY'],
  docs: 'Wise Platform payouts API (business account + KYB required)',
}));

module.exports = { registerPartner, unregisterPartner, getPartner, listPartners, stubPartner };
