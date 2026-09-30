'use strict';

// Snapshot webhooks keep their configured API version. Support both legacy
// snapshots and Basil/Clover without upgrading every Stripe API caller at once.
function stripeObjectId(value) {
  return typeof value === 'string' ? value : value?.id || null;
}

function invoiceSubscriptionId(invoice) {
  return stripeObjectId(invoice?.parent?.subscription_details?.subscription)
    || stripeObjectId(invoice?.subscription);
}

function subscriptionPeriod(subscription) {
  const items = subscription?.items?.data || [];
  // OxSteed subscriptions use one plan item. For mixed intervals the earliest
  // item ending is the next billing boundary, not the last item's boundary.
  const starts = items.map(item => item.current_period_start).filter(Number.isFinite);
  const ends = items.map(item => item.current_period_end).filter(Number.isFinite);
  return {
    start: subscription?.current_period_start ?? (starts.length ? Math.min(...starts) : null),
    end: subscription?.current_period_end ?? (ends.length ? Math.min(...ends) : null),
  };
}

module.exports = { stripeObjectId, invoiceSubscriptionId, subscriptionPeriod };
