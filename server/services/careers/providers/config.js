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

// Marketplace features (docs/careers/marketplace.md). Each defaults to off.
function intValue(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(value(name), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function plansConfig() {
  return {
    enabled: flag('CAREERS_PLANS_ENABLED'),
    stripeKey: value('STRIPE_SECRET_KEY'),
    webhookSecret: value('CAREERS_STRIPE_WEBHOOK_SECRET'),
    trialDays: intValue('CAREERS_PLAN_TRIAL_DAYS', 14, { min: 0, max: 60 }),
    priceIds: {
      starter: value('CAREERS_STRIPE_PRICE_PLAN_STARTER'),
      growth: value('CAREERS_STRIPE_PRICE_PLAN_GROWTH'),
      pro: value('CAREERS_STRIPE_PRICE_PLAN_PRO'),
    },
    get configured() { return this.enabled && Boolean(this.stripeKey && this.webhookSecret); },
  };
}

function referralsConfig() {
  return {
    enabled: flag('CAREERS_REFERRALS_ENABLED'),
    rateBps: intValue('CAREERS_REFERRAL_RATE_BPS', 1500, { min: 0, max: 5000 }),
    months: intValue('CAREERS_REFERRAL_MONTHS', 6, { min: 1, max: 24 }),
  };
}

function calendarConfig(provider) {
  if (provider === 'google') {
    return {
      provider,
      enabled: flag('CAREERS_CALENDAR_GOOGLE_ENABLED'),
      clientId: value('CAREERS_GOOGLE_CLIENT_ID'),
      clientSecret: value('CAREERS_GOOGLE_CLIENT_SECRET'),
      get configured() { return this.enabled && Boolean(this.clientId && this.clientSecret); },
    };
  }
  if (provider === 'microsoft') {
    return {
      provider,
      enabled: flag('CAREERS_CALENDAR_MICROSOFT_ENABLED'),
      clientId: value('CAREERS_MICROSOFT_CLIENT_ID'),
      clientSecret: value('CAREERS_MICROSOFT_CLIENT_SECRET'),
      tenant: value('CAREERS_MICROSOFT_TENANT') || 'common',
      get configured() { return this.enabled && Boolean(this.clientId && this.clientSecret); },
    };
  }
  return { provider, enabled: false, configured: false };
}

function videoConfig() {
  let iceServers = [];
  try {
    const raw = value('CAREERS_WEBRTC_ICE_SERVERS');
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      iceServers = parsed
        .filter((s) => s && (typeof s.urls === 'string' || Array.isArray(s.urls)))
        .map((s) => ({ urls: s.urls, ...(s.username ? { username: String(s.username) } : {}), ...(s.credential ? { credential: String(s.credential) } : {}) }))
        .slice(0, 6);
    }
  } catch { iceServers = []; }
  return { enabled: flag('CAREERS_VIDEO_ROOM_ENABLED'), iceServers };
}

function smsConfig() {
  return { enabled: flag('CAREERS_SMS_ENABLED') };
}

function resumeParseConfig() {
  return { enabled: flag('CAREERS_AI_RESUME_PARSE_ENABLED') };
}

function matchConfig() {
  return { enabled: flag('CAREERS_AI_MATCH_ENABLED') };
}

module.exports = {
  checkrConfig, eorConfig, billingConfig, rankingConfig, extractionConfig,
  plansConfig, referralsConfig, calendarConfig, videoConfig, smsConfig, resumeParseConfig, matchConfig,
  flag, value, intValue,
};
