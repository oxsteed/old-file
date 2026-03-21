const db = require('../db');

// ——— In-memory cache (refreshed every 5 minutes) ——————————————
let cachedConfig  = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ——— Hardcoded fallback defaults ————————————————————————
const DEFAULTS = {
  tier3_platform_fee_pct:      0.10,
  tier3_platform_fee_min_cents: 500,
  tier3_protection_fee_pct:    0.02,
  tier3_broker_cut_pct:        0.05,
  tier2_subscription_cents:    2900,
  tier3_subscription_cents:    7900,
};

// ——— Load config from DB (with cache) —————————————————————
const loadConfig = async () => {
  const now = Date.now();
  if (cachedConfig && now < cacheExpiresAt) {
    return cachedConfig;
  }

  try {
    const { rows } = await db.query(
      'SELECT key, value, value_type FROM fee_config'
    );

    if (rows.length === 0) {
      cachedConfig = { ...DEFAULTS };
    } else {
      const config = {};
      rows.forEach(row => {
        config[row.key] = parseFloat(row.value);
      });
      // Merge with defaults so any missing keys still work
      cachedConfig = { ...DEFAULTS, ...config };
    }

    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedConfig;
  } catch (err) {
    console.error('[FeeCalculator] DB load failed, using defaults:', err.message);
    cachedConfig = { ...DEFAULTS };
    cacheExpiresAt = now + CACHE_TTL_MS;
    return cachedConfig;
  }
};

// ——— Invalidate cache (called after admin updates) —————————
const invalidateCache = () => {
  cachedConfig = null;
  cacheExpiresAt = 0;
};

// ——— Calculate fees for a job —————————————————————————
const calculateFees = async (jobValueDollars, options = {}) => {
  const config = await loadConfig();
  const { includeBroker = false } = options;

  const jobValueCents = Math.round(jobValueDollars * 100);

  // Platform fee (percentage with minimum)
  let platformFeeCents = Math.round(jobValueCents * config.tier3_platform_fee_pct);
  platformFeeCents = Math.max(platformFeeCents, config.tier3_platform_fee_min_cents);

  // Protection fee
  const protectionFeeCents = Math.round(jobValueCents * config.tier3_protection_fee_pct);

  // Broker cut (only if broker involved)
  const brokerCutCents = includeBroker
    ? Math.round(jobValueCents * config.tier3_broker_cut_pct)
    : 0;

  const totalFeeCents = platformFeeCents + protectionFeeCents + brokerCutCents;
  const helperPayoutCents = jobValueCents - totalFeeCents;

  return {
    jobValueCents,
    platformFeeCents,
    protectionFeeCents,
    brokerCutCents,
    totalFeeCents,
    helperPayoutCents,
    // Dollar amounts for display
    jobValueDollars,
    platformFeeDollars: (platformFeeCents / 100).toFixed(2),
    protectionFeeDollars: (protectionFeeCents / 100).toFixed(2),
    brokerCutDollars: (brokerCutCents / 100).toFixed(2),
    totalFeeDollars: (totalFeeCents / 100).toFixed(2),
    helperPayoutDollars: (helperPayoutCents / 100).toFixed(2),
    // Rates used (for audit/display)
    rates: {
      platformFeePct: config.tier3_platform_fee_pct,
      platformFeeMinCents: config.tier3_platform_fee_min_cents,
      protectionFeePct: config.tier3_protection_fee_pct,
      brokerCutPct: config.tier3_broker_cut_pct,
    },
  };
};

module.exports = {
  loadConfig,
  invalidateCache,
  calculateFees,
  DEFAULTS,
};
