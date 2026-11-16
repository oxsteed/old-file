// server/utils/trial.js

const pool = require('../db');

// Default trial duration (365 days) used as fallback if config not found
const DEFAULT_TRIAL_DURATION_DAYS = 365;

// Cached trial duration to avoid DB query on every call
let cachedTrialDays = DEFAULT_TRIAL_DURATION_DAYS;
let cachedAt = Date.now();
const CACHE_TTL_MS = 5 * 60 * 1000; // Cache for 5 minutes

function getEffectiveTier(user) {
  if (!user) return 'free';
  if (isTrialActive(user)) return 'pro';
  if (legacyPaidTier(user)) return 'pro';
  if (currentPaidProductTier(user)) return 'pro';
  if (PAID_PRODUCT_TIERS.has(String(user.tier || '').toLowerCase())) {
    // A product tier without a current subscription is not an entitlement.
    return 'free';
  }
  return user.membership_tier || user.tier || 'free';
}

/**
 * Return whether the account can use Pro-only features.
 *
 * A live first-year trial is an entitlement in its own right. Keep legacy
 * paid values and paid helper roles here so API gates share one rule.
 */
function hasProAccess(user) {
  if (!user) return false;
  return isTrialActive(user)
    || legacyPaidTier(user)
    || currentPaidProductTier(user)
    || (['helper_pro', 'broker'].includes(user.role) && subscriptionIsCurrent(user));
}

const CURRENT_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const PAID_PRODUCT_TIERS = new Set(['pro', 'tier2', 'premium', 'elite']);

function subscriptionIsCurrent(user) {
  // Older callers do not always include subscription_status. Preserve their
  // legacy behavior while treating an explicitly non-current status as a
  // billing denial for product entitlements.
  if (user?.subscription_status == null || user.subscription_status === '') return true;
  return CURRENT_SUBSCRIPTION_STATUSES.has(String(user.subscription_status).toLowerCase());
}

function legacyPaidTier(user) {
  return PAID_PRODUCT_TIERS.has(String(user?.membership_tier || '').toLowerCase());
}

function currentPaidProductTier(user) {
  return subscriptionIsCurrent(user)
    && PAID_PRODUCT_TIERS.has(String(user?.tier || '').toLowerCase());
}

function isTrialActive(user) {
  if (!user?.trial_ends_at) return false;
  return new Date(user.trial_ends_at) > new Date();
}

function trialDaysLeft(user) {
  if (!user?.trial_ends_at) return 0;
  const diff = new Date(user.trial_ends_at) - new Date();
  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}

// Get trial duration from database (with cache) or fallback to default
async function getTrialDurationDays() {
  const now = Date.now();

  // Return cached value if still fresh
  if (now - cachedAt < CACHE_TTL_MS) {
    return cachedTrialDays;
  }

  try {
    const { rows } = await pool.query(
      'SELECT value FROM fee_config WHERE key = $1',
      ['trial_duration_days']
    );

    if (rows.length > 0) {
      const configuredDays = Math.floor(parseFloat(rows[0].value));
      // A stale row from the old 90-day rollout must not shorten the
      // first-year Pro promise while the migration is being applied.
      if (Number.isFinite(configuredDays) && configuredDays >= DEFAULT_TRIAL_DURATION_DAYS) {
        cachedTrialDays = configuredDays;
        cachedAt = now;
        return cachedTrialDays;
      }
    }
  } catch (err) {
    // Log error but don't throw - fall back to default
    console.error('Error fetching trial duration from config:', err.message);
  }

  // Fallback to default
  return DEFAULT_TRIAL_DURATION_DAYS;
}

// Invalidate cache (called when admin updates trial duration)
function invalidateTrialCache() {
  cachedAt = 0;
}

async function trialDefaults() {
  const trialDays = await getTrialDurationDays();
  return {
    trial_started_at: new Date(),
    trial_ends_at: new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000),
  };
}

module.exports = {
  getEffectiveTier,
  hasProAccess,
  subscriptionIsCurrent,
  isTrialActive,
  trialDaysLeft,
  trialDefaults,
  getTrialDurationDays,
  invalidateTrialCache,
  DEFAULT_TRIAL_DURATION_DAYS
};
