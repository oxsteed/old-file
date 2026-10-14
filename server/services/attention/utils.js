'use strict';

/**
 * server/services/attention/utils.js
 *
 * Shared helpers for the Business Attention Inbox domain adapters.
 * Each adapter exports `async function collect(business, ctx)` and returns
 * `{ items, freshness }`. Adapters never invent data: when a source table is
 * missing they report a stale freshness entry instead of a reassuring zero.
 */

const CATEGORIES = [
  'orders_fulfillment',
  'pickup_delivery',
  'bookings_scheduling',
  'service_jobs',
  'leads_quotes',
  'messages',
  'agreements_warranties',
  'invoices_billing',
  'refunds_disputes',
  'payments_settlements',
  'restaurant_credit',
  'inventory_offerings',
  'team_access',
  'devices_integrations',
  'setup_verification',
  'customer_followup',
];

// Money-movement categories: hidden from employee/support_agent roles.
const FINANCE_CATEGORIES = new Set([
  'invoices_billing',
  'refunds_disputes',
  'payments_settlements',
  'restaurant_credit',
]);

const URGENCIES = ['urgent', 'high', 'normal', 'low'];
const URGENCY_RANK = { urgent: 4, high: 3, normal: 2, low: 1 };

// Roles allowed to see finance categories (mirrors requireBusinessAccess rank,
// minus employee/support_agent).
const FINANCE_ROLES = new Set(['owner', 'manager', 'representative']);

function toISO(v) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ageDays(createdAt, now) {
  const c = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(c.getTime())) return 0;
  return Math.max(0, Math.floor((now.getTime() - c.getTime()) / 86400000));
}

/**
 * Build one attention task item. Identity is centralized here:
 * `<category>:<sourceType>:<sourceId>` — the same underlying record+problem
 * always yields the same id, so cross-adapter duplicates collapse.
 */
function buildItem(opts, ctx) {
  const {
    category, sourceType, sourceId, business, restaurant,
    reason, reasonParams, urgency, createdAt, deadlineAt,
    amountCents, currencyCode, creditRail, taskDestination,
  } = opts;
  const created = toISO(createdAt);
  const deadline = toISO(deadlineAt);
  const item = {
    id: `${category}:${sourceType}:${sourceId}`,
    businessId: business.id,
    businessName: business.business_name,
    category,
    sourceType,
    sourceId: String(sourceId),
    reason,
    reasonParams: reasonParams || {},
    urgency,
    createdAt: created,
    deadlineAt: deadline,
    // ageDays only when there is no deadline (deadline implies its own clock).
    ageDays: deadline ? null : ageDays(createdAt, ctx.now),
    creditRail: creditRail || null,
    taskDestination,
  };
  if (restaurant) {
    item.restaurantId = restaurant.id;
    item.restaurantName = restaurant.name;
  }
  // Never combine unlike currencies: amount always travels with its currency.
  if (amountCents != null && currencyCode) {
    item.amountCents = amountCents;
    item.currencyCode = currencyCode;
  }
  return item;
}

/**
 * Freshness tracker for one source table. Adapters touch() every row timestamp
 * they read; done() seals the entry.
 */
function makeTracker(freshness, source) {
  let at = null;
  return {
    touch(ts) {
      const iso = toISO(ts);
      if (iso && (!at || iso > at)) at = iso;
    },
    done(stale = false, note) {
      const entry = { source, at, stale: !!stale };
      if (note) entry.note = note;
      freshness.push(entry);
    },
  };
}

module.exports = {
  CATEGORIES,
  FINANCE_CATEGORIES,
  FINANCE_ROLES,
  URGENCIES,
  URGENCY_RANK,
  toISO,
  ageDays,
  buildItem,
  makeTracker,
};
