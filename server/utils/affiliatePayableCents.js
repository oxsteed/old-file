'use strict';

// Amount an affiliate payout actually moves. net_payout_cents wins when the
// row has one, including zero. Otherwise the payable figure is gross
// commission minus the processor fee. Both payout routes and the checker
// must use this so a queued approval and the Stripe transfer cannot disagree.
function affiliatePayableCents(payout = {}) {
  if (payout.net_payout_cents != null && payout.net_payout_cents !== '') {
    return Number(payout.net_payout_cents);
  }
  return Number(payout.total_commission_cents || 0) - Number(payout.processor_fee_cents || 0);
}

module.exports = { affiliatePayableCents };
