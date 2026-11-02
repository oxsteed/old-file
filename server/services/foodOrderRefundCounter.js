'use strict';

// Shared refunded-cents counter for food orders (restaurant-side finding 3).
//
// The admin refund path historically wrote metadata.admin_refunded_cents
// only, while the agent and kitchen paths refunded the full order total
// without reading any counter. A partial admin refund followed by an agent
// or kitchen refund therefore overstated the refundable amount, relying
// entirely on Stripe / wallet / credit per-debit caps to catch the excess.
//
// The canonical counter is metadata.refunded_cents. The legacy
// admin_refunded_cents key is kept in sync on every write and read as its
// max, so rows written before this change keep their history and no
// migration is needed (food_orders.metadata is already JSONB).
//
// Readers must use readRefundedCents; writers must stamp both keys via
// withRefundedCents. Nothing in this module moves money itself.

function readRefundedCents(metadata) {
  if (!metadata || typeof metadata !== 'object') return 0;
  const candidates = [metadata.refunded_cents, metadata.admin_refunded_cents];
  let best = 0;
  for (const raw of candidates) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n > best) best = n;
  }
  return best;
}

function withRefundedCents(metadata, cumulativeCents) {
  const next = metadata && typeof metadata === 'object' ? { ...metadata } : {};
  const cumulative = Math.max(0, Math.round(Number(cumulativeCents || 0)));
  next.refunded_cents = cumulative;
  next.admin_refunded_cents = cumulative;
  return next;
}

function remainingCents(totalCents, metadata) {
  const total = Math.max(0, Math.round(Number(totalCents || 0)));
  return Math.max(0, total - readRefundedCents(metadata));
}

module.exports = { readRefundedCents, withRefundedCents, remainingCents };
