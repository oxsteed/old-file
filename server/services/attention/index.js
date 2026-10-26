'use strict';

/**
 * server/services/attention/index.js
 *
 * Aggregator for the Business Attention Inbox (GET /api/businesses/attention).
 *
 * Contract honored on every request:
 * - Recheck business access (owner or active member) — never trust a cached grant.
 * - Run one domain adapter per category, in parallel, per accessible business.
 * - Deduplicate on the centralized identity `<category>:<sourceType>:<sourceId>`.
 * - Count unresolved items only; adapters exclude routine success, intentional
 *   pauses (cancelled/expired/declined/converted), and matters awaiting only
 *   another party.
 * - Missing or failing sources surface in freshness/partialFailures — never as
 *   a reassuring zero.
 * - Read-only: collecting tasks performs no mutation.
 *
 * Food-credit disputes are owned by the restaurant_credit adapter (they are
 * restaurant-credit records) and intentionally NOT duplicated in
 * refunds_disputes, so the same record+problem stays one task.
 */

const pool = require('../../db');
const {
  CATEGORIES,
  FINANCE_CATEGORIES,
  FINANCE_ROLES,
  URGENCIES,
  URGENCY_RANK,
  toISO,
} = require('./utils');

const ADAPTER_FILES = {
  orders_fulfillment: 'ordersFulfillment',
  pickup_delivery: 'pickupDelivery',
  bookings_scheduling: 'bookingsScheduling',
  service_jobs: 'serviceJobs',
  leads_quotes: 'leadsQuotes',
  messages: 'messages',
  agreements_warranties: 'agreementsWarranties',
  invoices_billing: 'invoicesBilling',
  refunds_disputes: 'refundsDisputes',
  payments_settlements: 'paymentsSettlements',
  restaurant_credit: 'restaurantCredit',
  inventory_offerings: 'inventoryOfferings',
  team_access: 'teamAccess',
  devices_integrations: 'devicesIntegrations',
  setup_verification: 'setupVerification',
  customer_followup: 'customerFollowup',
};

function loadAdapters() {
  const out = {};
  for (const [category, file] of Object.entries(ADAPTER_FILES)) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    out[category] = require(`./adapters/${file}`);
  }
  return out;
}
const ADAPTERS = loadAdapters();

/**
 * Resolve the businesses the user may see right now: owned, or active member.
 * Throws { statusCode: 404 } when a businessId filter matches nothing the
 * user can access (same 404-not-403 posture as requireBusinessAccess).
 */
async function resolveBusinesses(userId, businessIdFilter) {
  const { rows } = await pool.query(
    `SELECT b.id, b.business_name, b.user_id,
            CASE WHEN b.user_id = $1 THEN 'owner' ELSE COALESCE(m.role, 'member') END AS role
       FROM businesses b
       LEFT JOIN business_members m
         ON m.business_id = b.id AND m.member_id = $1 AND m.status = 'active'
      WHERE (b.user_id = $1 OR m.id IS NOT NULL)
        AND ($2::int IS NULL OR b.id = $2)
      ORDER BY b.id`,
    [userId, businessIdFilter || null]
  );
  if (businessIdFilter && rows.length === 0) {
    const err = new Error('Business not found');
    err.statusCode = 404;
    err.code = 'not_found';
    throw err;
  }
  return rows;
}

async function restaurantsForBusiness(businessId, tableExists) {
  if (!(await tableExists('food_restaurants'))) return [];
  const { rows } = await pool.query(
    'SELECT id, display_name FROM food_restaurants WHERE business_id = $1 ORDER BY id ASC',
    [businessId]
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.display_name }));
}

// F-02: null = all stores (owner, or a member with no store assignment,
// which is the staged all-store default); otherwise the assigned store ids
// across every restaurant of the business.
async function assignedLocationIds(businessId, userId, tableExists) {
  if (!(await tableExists('restaurant_location_memberships'))) return null;
  const { rows } = await pool.query(
    `SELECT DISTINCT lm.location_id
       FROM restaurant_location_memberships lm
       JOIN business_members bm ON bm.id = lm.membership_id
      WHERE bm.business_id = $1 AND bm.member_id = $2
        AND bm.status = 'active' AND lm.status = 'active'
      ORDER BY lm.location_id`,
    [businessId, userId]
  );
  return rows.length ? rows.map((r) => Number(r.location_id)) : null;
}

/**
 * Main entry point.
 * opts: { userId, businessId?, category?, urgency?, page?, limit? }
 */
async function collectAttention(opts) {
  const { userId } = opts;
  if (!userId) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    err.code = 'auth_required';
    throw err;
  }

  const category = opts.category || null;
  const urgency = opts.urgency || null;
  if (category && !CATEGORIES.includes(category)) {
    const err = new Error(`Unknown category: ${category}`);
    err.statusCode = 400;
    err.code = 'invalid_category';
    throw err;
  }
  if (urgency && !URGENCIES.includes(urgency)) {
    const err = new Error(`Unknown urgency: ${urgency}`);
    err.statusCode = 400;
    err.code = 'invalid_urgency';
    throw err;
  }

  let page = Number.parseInt(opts.page, 10);
  let limit = Number.parseInt(opts.limit, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  limit = Math.min(limit, 100);

  const businessIdFilter = opts.businessId != null && opts.businessId !== ''
    ? Number.parseInt(opts.businessId, 10)
    : null;
  if (opts.businessId != null && opts.businessId !== '' && !Number.isFinite(businessIdFilter)) {
    const err = new Error('Invalid business id.');
    err.statusCode = 400;
    err.code = 'invalid_business_id';
    throw err;
  }

  // Per-request table-existence cache (never trust a stale module cache
  // across deploys; this Map dies with the request).
  const tableCache = new Map();
  async function tableExists(name) {
    if (tableCache.has(name)) return tableCache.get(name);
    try {
      const { rows } = await pool.query(
        `SELECT to_regclass('public."${name}"') AS reg`
      );
      const ok = !!(rows[0] && rows[0].reg);
      tableCache.set(name, ok);
      return ok;
    } catch {
      tableCache.set(name, false);
      return false;
    }
  }

  let businesses;
  try {
    businesses = await resolveBusinesses(userId, businessIdFilter);
  } catch (err) {
    if (err.statusCode === 404) throw err;
    // The access check itself failed: report, don't zero-fill.
    return emptyResult(page, limit, [
      { source: 'businesses', error: err.message || 'access check failed' },
    ]);
  }

  const now = new Date();
  const allItems = [];
  const freshnessBySource = new Map();
  const partialFailures = [];

  const mergeFreshness = (entries) => {
    for (const e of entries || []) {
      const prev = freshnessBySource.get(e.source);
      if (!prev) {
        freshnessBySource.set(e.source, { ...e });
      } else {
        // Keep the newest observation; stale is sticky.
        if (e.at && (!prev.at || e.at > prev.at)) prev.at = e.at;
        if (e.stale) prev.stale = true;
        if (e.note && !prev.note) prev.note = e.note;
      }
    }
  };

  // One ctx per business: role-gated finance visibility, restaurant map.
  for (const business of businesses) {
    const role = business.role;
    const canSeeFinance = FINANCE_ROLES.has(role);
    const restaurants = await restaurantsForBusiness(business.id, tableExists);
    const restaurantById = new Map(restaurants.map((r) => [r.id, r]));
    const ctx = {
      pool,
      userId,
      now,
      tableExists,
      restaurants,
      restaurantById,
      role,
      canSeeFinance,
      business,
      // F-02: store-assigned staff only see their stores' orders.
      locationIds: role === 'owner' ? null : await assignedLocationIds(business.id, userId, tableExists),
    };

    const runnable = CATEGORIES.filter((c) => canSeeFinance || !FINANCE_CATEGORIES.has(c));
    const settled = await Promise.allSettled(
      runnable.map((c) => ADAPTERS[c].collect(business, ctx))
    );
    runnable.forEach((c, i) => {
      const r = settled[i];
      if (r.status === 'fulfilled' && r.value) {
        mergeFreshness(r.value.freshness);
        for (const item of r.value.items || []) allItems.push(item);
      } else if (r.status === 'rejected') {
        const message = (r.reason && r.reason.message) || 'adapter failed';
        partialFailures.push({ source: c, error: message });
        mergeFreshness([{ source: c, at: null, stale: true, note: message }]);
      }
    });
  }

  // Deduplicate on centralized identity: same record+problem = one task.
  // First occurrence wins (adapters run per business; a record belongs to one
  // business, so cross-business collisions indicate shared records).
  const seen = new Map();
  for (const item of allItems) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  let items = [...seen.values()];

  // Filters.
  if (category) items = items.filter((i) => i.category === category);
  if (urgency) items = items.filter((i) => i.urgency === urgency);

  // Sort: urgency rank desc, then newest first.
  items.sort((a, b) => {
    const dr = (URGENCY_RANK[b.urgency] || 0) - (URGENCY_RANK[a.urgency] || 0);
    if (dr !== 0) return dr;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  // Totals over the full filtered set (before pagination).
  const byCategory = {};
  const byUrgency = {};
  const bizIds = new Set();
  for (const i of items) {
    byCategory[i.category] = (byCategory[i.category] || 0) + 1;
    byUrgency[i.urgency] = (byUrgency[i.urgency] || 0) + 1;
    bizIds.add(i.businessId);
  }

  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const pageItems = items.slice(start, start + limit);

  return {
    totals: {
      total,
      affectedBusinesses: bizIds.size,
      byCategory,
      byUrgency,
    },
    items: pageItems,
    freshness: [...freshnessBySource.values()].map((f) => ({
      source: f.source,
      at: f.at || null,
      stale: !!f.stale,
      ...(f.note ? { note: f.note } : {}),
    })),
    partialFailures,
    page,
    limit,
    totalPages,
  };
}

function emptyResult(page, limit, partialFailures) {
  return {
    totals: { total: 0, affectedBusinesses: 0, byCategory: {}, byUrgency: {} },
    items: [],
    freshness: [],
    partialFailures,
    page,
    limit,
    totalPages: 1,
  };
}

module.exports = {
  collectAttention,
  CATEGORIES,
  URGENCIES,
  resolveBusinesses,
};
