'use strict';

/**
 * Review P2-574: map Stripe subscription statuses onto the local
 * subscription_status ENUM ('none','trialing','active','past_due',
 * 'cancelled','paused'). Writing Stripe's value verbatim failed for
 * incomplete / incomplete_expired / unpaid / canceled, leaving the row stale
 * while the customer kept tier access.
 */
const MAP = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  paused: 'paused',
  canceled: 'cancelled',
  cancelled: 'cancelled',
  incomplete: 'none',
  incomplete_expired: 'cancelled',
};

function toLocalSubscriptionStatus(stripeStatus) {
  return MAP[String(stripeStatus || '').toLowerCase()] || 'none';
}

module.exports = { toLocalSubscriptionStatus };
