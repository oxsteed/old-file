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
  if (user.membership_tier === 'pro') return 'pro';
  if (isTrialActive(user)) return 'pro';
  return user.membership_tier || 'free';
}

/**
 * Return whether the account can use Pro-only features.
 *
 * A live first-year trial is an entitlement in its own right. Keep legacy
 * paid values and paid helper roles here so API gates share one rule.
 */
function hasProAccess(user) {
  if (!user) return false;
  if (['helper_pro', 'broker'].includes(user.role)) return true;
  if (['pro', 'tier2'].includes(String(user.membership_tier || '').toLowerCase())) return true;
  return isTrialActive(user);
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
  isTrialActive,
  trialDaysLeft,
  trialDefaults,
  getTrialDurationDays,
  invalidateTrialCache,
  DEFAULT_TRIAL_DURATION_DAYS
};
