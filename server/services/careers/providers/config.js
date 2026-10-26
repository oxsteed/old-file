'use strict';

// Feature flags for careers vendors. Every vendor defaults to OFF and the
// app stays safe when it is unconfigured: the caller gets a clear
// "not configured" answer (HTTP 503 at the API) and nothing is sent.
// docs/careers/README.md lists what each flag needs (accounts, legal sign-off).

const flag = (name) => String(process.env[name] || '').trim().toLowerCase() === 'true';
const value = (name) => String(process.env[name] || '').trim();

function checkrConfig() {
  return {
    enabled: flag('CAREERS_CHECKR_ENABLED'),
    partnerClientId: value('CAREERS_CHECKR_CLIENT_ID'),
    webhookSecret: value('CAREERS_CHECKR_WEBHOOK_SECRET'),
    baseUrl: value('CAREERS_CHECKR_BASE_URL') || 'https://api.checkr.com/v1',
    get configured() { return this.enabled && Boolean(this.partnerClientId && this.webhookSecret); },
  };
}

function eorConfig() {
  return {
    enabled: flag('CAREERS_EOR_ENABLED'),
    partner: value('CAREERS_EOR_PARTNER'),
    apiKey: value('CAREERS_EOR_API_KEY'),
    baseUrl: value('CAREERS_EOR_BASE_URL'),
    webhookSecret: value('CAREERS_EOR_WEBHOOK_SECRET'),
    get configured() { return this.enabled && Boolean(this.partner && this.apiKey && this.baseUrl && this.webhookSecret); },
  };
}

function billingConfig() {
  return {
    enabled: flag('CAREERS_BILLING_ENABLED'),
    stripeKey: value('STRIPE_SECRET_KEY'),
    webhookSecret: value('CAREERS_STRIPE_WEBHOOK_SECRET'),
    boostPriceIds: {
      boost_7d: value('CAREERS_STRIPE_PRICE_BOOST_7D'),
      boost_30d: value('CAREERS_STRIPE_PRICE_BOOST_30D'),
      hiring_event: value('CAREERS_STRIPE_PRICE_HIRING_EVENT'),
    },
    get configured() { return this.enabled && Boolean(this.stripeKey && this.webhookSecret); },
  };
}

function rankingConfig() {
  return {
    // Global kill switch; markets also need their own gate (career_ai_ranking_markets).
    enabled: flag('CAREERS_AI_RANKING_ENABLED'),
    model: value('CAREERS_OLLAMA_MODEL'),
    digest: value('CAREERS_OLLAMA_MODEL_DIGEST'),
  };
}

function extractionConfig() {
  return { enabled: flag('CAREERS_AI_EXTRACTION_ENABLED') };
}

module.exports = { checkrConfig, eorConfig, billingConfig, rankingConfig, extractionConfig, flag, value };
