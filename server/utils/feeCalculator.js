/**
 * OxSteed Fee Calculator
 * Single source of truth for all platform fees.
 * Import this anywhere fees are calculated — never hardcode fees elsewhere.
 */

// ─── Fee Constants ────────────────────────────────────────────
const FEES = {

  // Tier 1 — Free directory. No platform fees ever.
  TIER_1: {
    platform_pct:     0,
    platform_min:     0,
    protection_pct:   0,
    broker_cut_pct:   0,
    description:      'No platform fee — off-platform transaction',
  },

  // Tier 2 — Subscription only. If parties voluntarily use
  // platform payment, Tier 3 rates apply automatically.
  TIER_2_SUBSCRIPTION: {
    monthly_cents:    2900,   // $29.00/month
    description:      'Pro helper subscription',
  },

  // Tier 3 — Protected payment transaction fees
  TIER_3: {
    platform_pct:     0.10,   // 10% of agreed job value
    platform_min:     500,    // $5.00 minimum (in cents)
    protection_pct:   0.02,   // 2% payment protection fee
    broker_cut_pct:   0.05,   // 5% if a Broker Helper mediates
    description:      'Protected payment with escrow',
  },

  TIER_3_SUBSCRIPTION: {
    monthly_cents:    7900,   // $79.00/month
    description:      'Broker helper subscription',
  },
};

/**
 * Calculate all fees for a Tier 3 protected payment transaction.
 *
 * @param {number} jobValueCents  - Agreed job value in cents
 * @param {boolean} isBrokerMediated - true if a Broker Helper is mediating
 * @returns {object} Full fee breakdown in cents
 */
exports.calculateTier3Fees = (jobValueCents, isBrokerMediated = false) => {
  if (!jobValueCents || jobValueCents <= 0) {
    throw new Error('Job value must be a positive number.');
  }

  const f = FEES.TIER_3;

  // Platform service fee: 10% or $5 minimum
  const platformFeeCents = Math.max(
    f.platform_min,
    Math.round(jobValueCents * f.platform_pct)
  );

  // Payment protection fee: 2%
  const protectionFeeCents = Math.round(jobValueCents * f.protection_pct);

  // Broker mediation fee: 5% (only if brokered)
  const brokerFeeCents = isBrokerMediated
    ? Math.round(jobValueCents * f.broker_cut_pct)
    : 0;

  // Total platform take
  const totalPlatformFeeCents =
    platformFeeCents + protectionFeeCents + brokerFeeCents;

  // What customer pays (job value + all fees)
  const customerTotalCents = jobValueCents + totalPlatformFeeCents;

  // What helper receives (job value minus platform fee and broker cut)
  const helperPayoutCents =
    jobValueCents - platformFeeCents - protectionFeeCents - brokerFeeCents;

  // Effective take rate
  const effectiveTakeRatePct =
    (totalPlatformFeeCents / jobValueCents) * 100;

  return {
    job_value_cents:          jobValueCents,
    platform_fee_cents:       platformFeeCents,
    protection_fee_cents:     protectionFeeCents,
    broker_fee_cents:         brokerFeeCents,
    total_platform_fee_cents: totalPlatformFeeCents,
    customer_total_cents:     customerTotalCents,
    helper_payout_cents:      helperPayoutCents,
    is_broker_mediated:       isBrokerMediated,
    effective_take_rate_pct:  parseFloat(effectiveTakeRatePct.toFixed(2)),

    // Human-readable (dollars)
    display: {
      job_value:         `$${(jobValueCents / 100).toFixed(2)}`,
      platform_fee:      `$${(platformFeeCents / 100).toFixed(2)}`,
      protection_fee:    `$${(protectionFeeCents / 100).toFixed(2)}`,
      broker_fee:        `$${(brokerFeeCents / 100).toFixed(2)}`,
      total_fees:        `$${(totalPlatformFeeCents / 100).toFixed(2)}`,
      customer_total:    `$${(customerTotalCents / 100).toFixed(2)}`,
      helper_payout:     `$${(helperPayoutCents / 100).toFixed(2)}`,
      take_rate:         `${effectiveTakeRatePct.toFixed(1)}%`,
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
 * what the calculator expects — used before releasing escrow.
 */
exports.validateFeeBreakdown = (storedBreakdown, jobValueCents, isBrokerMediated) => {
  const expected = exports.calculateTier3Fees(jobValueCents, isBrokerMediated);

  const discrepancies = [];

  if (storedBreakdown.platform_fee_cents !== expected.platform_fee_cents) {
    discrepancies.push({
      field:    'platform_fee_cents',
      stored:   storedBreakdown.platform_fee_cents,
      expected: expected.platform_fee_cents,
    });
  }

  if (storedBreakdown.protection_fee_cents !== expected.protection_fee_cents) {
    discrepancies.push({
      field:    'protection_fee_cents',
      stored:   storedBreakdown.protection_fee_cents,
      expected: expected.protection_fee_cents,
    });
  }

  if (storedBreakdown.customer_total_cents !== expected.customer_total_cents) {
    discrepancies.push({
      field:    'customer_total_cents',
      stored:   storedBreakdown.customer_total_cents,
      expected: expected.customer_total_cents,
    });
  }

  if (storedBreakdown.helper_payout_cents !== expected.helper_payout_cents) {
    discrepancies.push({
      field:    'helper_payout_cents',
      stored:   storedBreakdown.helper_payout_cents,
      expected: expected.helper_payout_cents,
    });
  }

  return {
    valid:         discrepancies.length === 0,
    discrepancies,
    expected,
  };
};

// Export constants for use in other modules
exports.FEES = FEES;const { calculateTier3Fees, getSubscriptionPrice } = require('../utils/feeCalculator');

// When a bid is accepted and payment intent is created:
const breakdown = calculateTier3Fees(
  agreedJobValueCents,
  job.is_broker_mediated
);
// breakdown.customer_total_cents → charge the customer this
// breakdown.helper_payout_cents  → transfer this to helper after completion
// breakdown.platform_fee_cents   → platform keeps this

// Before releasing escrow — validate stored fees haven't drifted:
const validation = validateFeeBreakdown(
  storedPaymentRecord,
  job.job_value_cents,
  job.is_broker_mediated
);
if (!validation.valid) {
  console.error('[Fee Validation] Discrepancy detected:', validation.discrepancies);
  // Alert super admin, do not release funds automatically
}
