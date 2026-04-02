/**
 * OxSteed Fee Calculator
 * Single source of truth for all platform fees.
 * Import this anywhere fees are calculated — never hardcode fees elsewhere.
 *
 * Payment model: Stripe Connect direct charges on helper's connected account.
 * Helper is merchant of record. OxSteed collects revenue via application_fee.
 * Card processing fees and chargebacks are the helper's responsibility.
 */

// ─── Fee Constants ────────────────────────────────────────────
const FEES = {

  // Tier 1 — Free directory. No platform fees ever.
  TIER_1: {
    platform_pct: 0,
    platform_min: 0,
    description:  'No platform fee — off-platform transaction',
  },

  // Tier 2 — Subscription only. If parties voluntarily use
  // platform payment, Tier 3 rates apply automatically.
  TIER_2_SUBSCRIPTION: {
    monthly_cents: 1499,   // $14.99/month
    description:   'Pro helper subscription',
  },

  // Tier 3 — OxSteed Protection (optional paid protection, NOT legal escrow)
  // Customer pays agreed job value via direct charge on helper's Stripe account.
  // OxSteed's entire cut is the application_fee: 7.1% or $5 minimum.
  // That's it — one simple fee to run the platform.
  TIER_3: {
    platform_pct: 0.071,  // 7.1% — OxSteed's total platform fee
    platform_min: 500,    // $5.00 minimum (cents)
    description:  'OxSteed Protection — coordinated card payment with dispute mediation',
  },
};

// ─── DB-backed overrides (cached) ─────────────────────────────
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000;

const DEFAULTS = {
  platform_fee_pct:         FEES.TIER_3.platform_pct,
  platform_fee_min_cents:   FEES.TIER_3.platform_min,
  tier2_subscription_cents: FEES.TIER_2_SUBSCRIPTION.monthly_cents,
};

function invalidateCache() { _cache = null; }

/**
 * Calculate fees for a Tier 3 OxSteed Protection job.
 *
 * Direct-charge model:
 *   - Customer is charged `jobValueCents` on the helper's connected account.
 *   - OxSteed's `application_fee_amount` = 7.1% of job value (or $5 min).
 *   - Stripe deducts card processing fees from the helper's charge.
 *   - Helper receives: jobValueCents - application_fee - stripe_processing_fee.
 *   - OxSteed receives: application_fee (deposited to platform account).
 *
 * @param {number} jobValueCents - Agreed job value in cents (what the customer pays)
 * @returns {object} Full fee breakdown in cents
 */
exports.calculateTier3Fees = (jobValueCents) => {
  if (!jobValueCents || jobValueCents <= 0) {
    throw new Error('Job value must be a positive number.');
  }

  const f = FEES.TIER_3;

  // OxSteed platform fee: 7.1% or $5 minimum
  const platformFeeCents = Math.max(
    f.platform_min,
    Math.round(jobValueCents * f.platform_pct)
  );

  // Effective take rate (before Stripe processing fees)
  const effectiveTakeRatePct =
    (platformFeeCents / jobValueCents) * 100;

  return {
    job_value_cents:         jobValueCents,
    platform_fee_cents:      platformFeeCents,
    application_fee_cents:   platformFeeCents,  // same thing — platform fee IS the application fee
    customer_charged_cents:  jobValueCents,
    effective_take_rate_pct: parseFloat(effectiveTakeRatePct.toFixed(2)),

    // Human-readable (dollars)
    display: {
      job_value:        `$${(jobValueCents / 100).toFixed(2)}`,
      platform_fee:     `$${(platformFeeCents / 100).toFixed(2)}`,
      customer_charged: `$${(jobValueCents / 100).toFixed(2)}`,
      take_rate:        `${effectiveTakeRatePct.toFixed(1)}%`,
    },
  };
};

/**
 * Get subscription price in cents for a given plan slug.
 * @param {'pro'} planSlug
 */
exports.getSubscriptionPrice = (planSlug) => {
  const map = {
    pro: FEES.TIER_2_SUBSCRIPTION.monthly_cents,
  };
  const price = map[planSlug];
  if (!price) throw new Error(`Unknown plan slug: ${planSlug}`);
  return price;
};

/**
 * Validate a fee breakdown returned from the database matches
 * what the calculator expects — used before capturing payment.
 */
exports.validateFeeBreakdown = (storedBreakdown, jobValueCents) => {
  const expected = exports.calculateTier3Fees(jobValueCents);
  const discrepancies = [];

  if (storedBreakdown.platform_fee_cents !== expected.platform_fee_cents) {
    discrepancies.push({
      field: 'platform_fee_cents',
      stored: storedBreakdown.platform_fee_cents,
      expected: expected.platform_fee_cents,
    });
  }

  return {
    valid: discrepancies.length === 0,
    discrepancies,
    expected,
  };
};

// Export constants for use in other modules
exports.FEES = FEES;
exports.DEFAULTS = DEFAULTS;
exports.invalidateCache = invalidateCache;
