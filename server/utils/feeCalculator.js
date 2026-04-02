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
    platform_pct:       0,
    platform_min:       0,
    tier3_surcharge_pct: 0,
    tier3_surcharge_min: 0,
    broker_cut_pct:     0,
    description:        'No platform fee — off-platform transaction',
  },

  // Tier 2 — Subscription only. If parties voluntarily use
  // platform payment, Tier 3 rates apply automatically.
  TIER_2_SUBSCRIPTION: {
    monthly_cents:  1499,   // $14.99/month
    description:    'Pro helper subscription',
  },

  // Tier 3 — OxSteed Protection (optional paid protection, NOT legal escrow)
  // Customer pays agreed job value. OxSteed takes an application_fee
  // from the direct charge on the helper's connected Stripe account.
  // Application fee = base platform fee + Tier 3 surcharge.
  TIER_3: {
    platform_pct:         0.10,   // 10% base platform fee
    platform_min:         500,    // $5.00 minimum base fee (cents)
    tier3_surcharge_pct:  0.071,  // 7.1% OxSteed Protection surcharge
    tier3_surcharge_min:  500,    // $5.00 minimum surcharge (cents)
    broker_cut_pct:       0.05,   // 5% if a Broker Helper mediates
    description:          'OxSteed Protection — coordinated card payment with dispute mediation',
  },

  TIER_3_SUBSCRIPTION: {
    monthly_cents:  3900,   // $39.00/month
    description:    'Broker helper subscription',
  },
};

// ─── DB-backed overrides (cached) ─────────────────────────────
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000;

const DEFAULTS = {
  platform_fee_pct:         FEES.TIER_3.platform_pct,
  platform_fee_min_cents:   FEES.TIER_3.platform_min,
  tier3_surcharge_pct:      FEES.TIER_3.tier3_surcharge_pct,
  tier3_surcharge_min_cents: FEES.TIER_3.tier3_surcharge_min,
  broker_cut_pct:           FEES.TIER_3.broker_cut_pct,
  tier2_subscription_cents: FEES.TIER_2_SUBSCRIPTION.monthly_cents,
  tier3_subscription_cents: FEES.TIER_3_SUBSCRIPTION.monthly_cents,
};

function invalidateCache() { _cache = null; }

/**
 * Calculate all fees for a Tier 3 OxSteed Protection job.
 *
 * Direct-charge model:
 *   - Customer is charged `jobValueCents` on the helper's connected account.
 *   - OxSteed's `application_fee_amount` = basePlatformFee + tier3Surcharge (+ brokerFee).
 *   - Stripe deducts card processing fees from the helper's charge.
 *   - Helper receives: jobValueCents - application_fee - stripe_processing_fee.
 *   - OxSteed receives: application_fee (deposited to platform account).
 *
 * @param {number} jobValueCents - Agreed job value in cents (what the customer pays)
 * @param {boolean} isBrokerMediated - true if a Broker Helper is mediating
 * @returns {object} Full fee breakdown in cents
 */
exports.calculateTier3Fees = (jobValueCents, isBrokerMediated = false) => {
  if (!jobValueCents || jobValueCents <= 0) {
    throw new Error('Job value must be a positive number.');
  }

  const f = FEES.TIER_3;

  // Base platform fee: 10% or $5 minimum
  const basePlatformFeeCents = Math.max(
    f.platform_min,
    Math.round(jobValueCents * f.platform_pct)
  );

  // Tier 3 surcharge: 7.1% or $5 minimum
  const tier3SurchargeCents = Math.max(
    f.tier3_surcharge_min,
    Math.round(jobValueCents * f.tier3_surcharge_pct)
  );

  // Broker mediation fee: 5% (only if brokered)
  const brokerFeeCents = isBrokerMediated
    ? Math.round(jobValueCents * f.broker_cut_pct)
    : 0;

  // Total application_fee sent to OxSteed via Stripe Connect
  const applicationFeeCents =
    basePlatformFeeCents + tier3SurchargeCents + brokerFeeCents;

  // What the customer is charged (direct charge on helper's account)
  const customerChargedCents = jobValueCents;

  // Effective take rate (before Stripe processing fees)
  const effectiveTakeRatePct =
    (applicationFeeCents / jobValueCents) * 100;

  return {
    job_value_cents:            jobValueCents,
    base_platform_fee_cents:    basePlatformFeeCents,
    tier3_surcharge_cents:      tier3SurchargeCents,
    broker_fee_cents:           brokerFeeCents,
    application_fee_cents:      applicationFeeCents,
    customer_charged_cents:     customerChargedCents,
    is_broker_mediated:         isBrokerMediated,
    effective_take_rate_pct:    parseFloat(effectiveTakeRatePct.toFixed(2)),

    // Human-readable (dollars)
    display: {
      job_value:          `$${(jobValueCents / 100).toFixed(2)}`,
      base_platform_fee:  `$${(basePlatformFeeCents / 100).toFixed(2)}`,
      tier3_surcharge:    `$${(tier3SurchargeCents / 100).toFixed(2)}`,
      broker_fee:         `$${(brokerFeeCents / 100).toFixed(2)}`,
      application_fee:    `$${(applicationFeeCents / 100).toFixed(2)}`,
      customer_charged:   `$${(customerChargedCents / 100).toFixed(2)}`,
      take_rate:          `${effectiveTakeRatePct.toFixed(1)}%`,
    },
  };
};

/**
 * Get subscription price in cents for a given plan slug.
 * @param {'pro'|'broker'} planSlug
 */
exports.getSubscriptionPrice = (planSlug) => {
  const map = {
    pro:    FEES.TIER_2_SUBSCRIPTION.monthly_cents,
    broker: FEES.TIER_3_SUBSCRIPTION.monthly_cents,
  };
  const price = map[planSlug];
  if (!price) throw new Error(`Unknown plan slug: ${planSlug}`);
  return price;
};

/**
 * Validate a fee breakdown returned from the database matches
 * what the calculator expects — used before capturing payment.
 */
exports.validateFeeBreakdown = (storedBreakdown, jobValueCents, isBrokerMediated) => {
  const expected = exports.calculateTier3Fees(jobValueCents, isBrokerMediated);
  const discrepancies = [];

  if (storedBreakdown.base_platform_fee_cents !== expected.base_platform_fee_cents) {
    discrepancies.push({
      field: 'base_platform_fee_cents',
      stored: storedBreakdown.base_platform_fee_cents,
      expected: expected.base_platform_fee_cents,
    });
  }
  if (storedBreakdown.tier3_surcharge_cents !== expected.tier3_surcharge_cents) {
    discrepancies.push({
      field: 'tier3_surcharge_cents',
      stored: storedBreakdown.tier3_surcharge_cents,
      expected: expected.tier3_surcharge_cents,
    });
  }
  if (storedBreakdown.application_fee_cents !== expected.application_fee_cents) {
    discrepancies.push({
      field: 'application_fee_cents',
      stored: storedBreakdown.application_fee_cents,
      expected: expected.application_fee_cents,
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
