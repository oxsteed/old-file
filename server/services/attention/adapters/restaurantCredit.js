'use strict';

/**
 * restaurant_credit adapter.
 * Rails are labeled separately: 'restaurant' for the restaurant-credit
 * tables (migrations 855-866), 'oxsteed' for OxSteed-credit pending actions
 * attributed to this business. Amounts are never summed across currencies —
 * each item carries its own amountCents + currencyCode.
 *
 * This adapter also owns food_credit_disputes (restaurant-credit records),
 * which is why refunds_disputes intentionally skips them.
 */

const { buildItem, makeTracker } = require('../utils');

const LOAD_URGENT_AFTER_MS = 24 * 3600 * 1000;
const DISPUTE_HIGH_AFTER_MS = 48 * 3600 * 1000;
const FUNDING_URGENT_AFTER_MS = 7 * 24 * 3600 * 1000;
const EXPOSURE_NEAR_CAP_RATIO = 0.8;

function creditDest(businessId, params) {
  return {
    type: 'component',
    component: 'RestaurantCreditManager',
    params: { businessId: String(businessId), ...params },
  };
}

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const restaurantIds = ctx.restaurants.map((r) => r.id);
  const hasRestaurants = restaurantIds.length > 0;

  const nameOf = (id) => {
    const r = ctx.restaurantById.get(Number(id));
    return r ? { id: Number(id), name: r.name } : { id: Number(id), name: `Restaurant ${id}` };
  };

  // ── Pending wallet load requests ──────────────────────────────────────────
  {
    const track = makeTracker(freshness, 'food_customer_wallet_load_requests');
    if (await ctx.tableExists('food_customer_wallet_load_requests') && hasRestaurants) {
      const { rows } = await ctx.pool.query(
        `SELECT id, restaurant_id, amount_cents, currency_code, status,
                created_at, updated_at, expires_at
           FROM food_customer_wallet_load_requests
          WHERE restaurant_id = ANY($1::bigint[])
            AND status = 'pending'
            AND (expires_at IS NULL OR expires_at > NOW())`,
        [restaurantIds]
      );
      for (const r of rows) {
        track.touch(r.updated_at || r.created_at);
        const ageMs = ctx.now - new Date(r.created_at);
        items.push(buildItem({
          category: 'restaurant_credit',
          sourceType: 'wallet_load_request',
          sourceId: r.id,
          business,
          restaurant: nameOf(r.restaurant_id),
          reason: 'attention.reasons.creditRequestPending',
          reasonParams: {},
          urgency: ageMs > LOAD_URGENT_AFTER_MS ? 'urgent' : 'high',
          createdAt: r.created_at,
          deadlineAt: r.expires_at || null,
          amountCents: r.amount_cents != null ? Number(r.amount_cents) : null,
          currencyCode: r.currency_code || 'USD',
          creditRail: 'restaurant',
          taskDestination: creditDest(business.id, { view: 'loads', loadRequestId: String(r.id) }),
        }, ctx));
      }
      track.done(false);
    } else {
      track.done(true, hasRestaurants ? 'table food_customer_wallet_load_requests is missing' : 'business has no restaurants');
    }
  }

  // ── Funding submissions awaiting review ───────────────────────────────────
  {
    const track = makeTracker(freshness, 'restaurant_credit_funding_submissions');
    if (await ctx.tableExists('restaurant_credit_funding_submissions') && hasRestaurants) {
      const { rows } = await ctx.pool.query(
        `SELECT id, restaurant_id, amount_cents, currency_code, status,
                created_at, updated_at
           FROM restaurant_credit_funding_submissions
          WHERE restaurant_id = ANY($1::bigint[])
            AND status = 'pending'`,
        [restaurantIds]
      );
      for (const s of rows) {
        track.touch(s.updated_at || s.created_at);
        const ageMs = ctx.now - new Date(s.created_at);
        items.push(buildItem({
          category: 'restaurant_credit',
          sourceType: 'funding_submission',
          sourceId: s.id,
          business,
          restaurant: nameOf(s.restaurant_id),
          reason: 'attention.reasons.fundingProofReview',
          reasonParams: {},
          urgency: ageMs > FUNDING_URGENT_AFTER_MS ? 'urgent' : 'high',
          createdAt: s.created_at,
          deadlineAt: null,
          amountCents: s.amount_cents != null ? Number(s.amount_cents) : null,
          currencyCode: s.currency_code || 'USD',
          creditRail: 'restaurant',
          taskDestination: creditDest(business.id, { view: 'funding', submissionId: String(s.id) }),
        }, ctx));
      }
      track.done(false);
    } else {
      track.done(true, hasRestaurants ? 'table restaurant_credit_funding_submissions is missing' : 'business has no restaurants');
    }
  }

  // ── Credit disputes (owned here, not in refunds_disputes) ─────────────────
  {
    const track = makeTracker(freshness, 'food_credit_disputes');
    if (await ctx.tableExists('food_credit_disputes') && hasRestaurants) {
      const { rows } = await ctx.pool.query(
        `SELECT id, restaurant_id, load_request_id, status, reason,
                opened_at, created_at, updated_at
           FROM food_credit_disputes
          WHERE restaurant_id = ANY($1::bigint[])
            AND status IN ('open', 'under_review', 'resolved_info_needed')`,
        [restaurantIds]
      );
      for (const d of rows) {
        track.touch(d.updated_at || d.opened_at || d.created_at);
        const ageMs = ctx.now - new Date(d.opened_at || d.created_at);
        items.push(buildItem({
          category: 'restaurant_credit',
          sourceType: 'food_credit_dispute',
          sourceId: d.id,
          business,
          restaurant: nameOf(d.restaurant_id),
          reason: d.status === 'resolved_info_needed'
            ? 'attention.reasons.evidenceDeadline'
            : 'attention.reasons.creditDispute',
          reasonParams: {},
          urgency: d.status === 'resolved_info_needed'
            ? 'urgent'
            : ageMs > DISPUTE_HIGH_AFTER_MS ? 'high' : 'normal',
          createdAt: d.opened_at || d.created_at,
          deadlineAt: null,
          creditRail: 'restaurant',
          taskDestination: creditDest(business.id, { view: 'disputes', disputeId: String(d.id) }),
        }, ctx));
      }
      track.done(false);
    } else {
      track.done(true, hasRestaurants ? 'table food_credit_disputes is missing' : 'business has no restaurants');
    }
  }

  // ── Exposure near/at cap ──────────────────────────────────────────────────
  {
    const track = makeTracker(freshness, 'restaurant_credit_exposure');
    if (await ctx.tableExists('restaurant_credit_exposure') && hasRestaurants
        && await ctx.tableExists('food_restaurants')) {
      const { rows } = await ctx.pool.query(
        `SELECT e.restaurant_id, e.outstanding_cents, e.cap_cents,
                fr.currency_code AS currency_code
           FROM restaurant_credit_exposure e
           JOIN food_restaurants fr ON fr.id = e.restaurant_id
          WHERE e.restaurant_id = ANY($1::bigint[])`,
        [restaurantIds]
      );
      for (const e of rows) {
        const outstanding = Number(e.outstanding_cents) || 0;
        const cap = Number(e.cap_cents) || 0;
        if (!cap) continue;
        const ratio = outstanding / cap;
        if (ratio < EXPOSURE_NEAR_CAP_RATIO) continue; // healthy headroom: no task
        track.touch(new Date().toISOString());
        const atCap = ratio >= 1;
        items.push(buildItem({
          category: 'restaurant_credit',
          sourceType: 'credit_exposure',
          sourceId: e.restaurant_id,
          business,
          restaurant: nameOf(e.restaurant_id),
          reason: atCap ? 'attention.reasons.atCapacity' : 'attention.reasons.exposureWarning',
          reasonParams: { percentUsed: Math.round(ratio * 100) },
          urgency: atCap ? 'urgent' : 'high',
          createdAt: new Date().toISOString(),
          deadlineAt: null,
          amountCents: outstanding,
          currencyCode: e.currency_code || 'USD',
          creditRail: 'restaurant',
          taskDestination: creditDest(business.id, { view: 'exposure', restaurantId: String(e.restaurant_id) }),
        }, ctx));
      }
      track.done(false);
    } else {
      track.done(true, 'restaurant_credit_exposure table is missing or business has no restaurants');
    }
  }

  // ── Approval restrictions ─────────────────────────────────────────────────
  {
    const track = makeTracker(freshness, 'restaurant_credit_approvals');
    if (await ctx.tableExists('restaurant_credit_approvals') && hasRestaurants) {
      const { rows } = await ctx.pool.query(
        `SELECT restaurant_id, status, grace_period_ends_at, updated_at
           FROM restaurant_credit_approvals
          WHERE restaurant_id = ANY($1::bigint[])
            AND status IN ('pending', 'suspended')`,
        [restaurantIds]
      );
      for (const a of rows) {
        track.touch(a.updated_at);
        items.push(buildItem({
          category: 'restaurant_credit',
          sourceType: 'credit_approval',
          sourceId: a.restaurant_id,
          business,
          restaurant: nameOf(a.restaurant_id),
          reason: a.status === 'suspended'
            ? 'attention.reasons.approvalRestricted'
            : 'attention.reasons.approvalRestricted',
          reasonParams: {},
          urgency: a.status === 'suspended' ? 'urgent' : 'normal',
          createdAt: a.updated_at || new Date().toISOString(),
          deadlineAt: a.grace_period_ends_at || null,
          creditRail: 'restaurant',
          taskDestination: creditDest(business.id, { view: 'approvals', restaurantId: String(a.restaurant_id) }),
        }, ctx));
      }
      track.done(false);
    } else {
      track.done(true, 'restaurant_credit_approvals table is missing or business has no restaurants');
    }
  }

  // ── Flagged fraud signals ─────────────────────────────────────────────────
  {
    const track = makeTracker(freshness, 'food_credit_fraud_signals');
    if (await ctx.tableExists('food_credit_fraud_signals') && hasRestaurants) {
      const { rows } = await ctx.pool.query(
        `SELECT id, restaurant_id, signal_type, severity, details, created_at
           FROM food_credit_fraud_signals
          WHERE (restaurant_id = ANY($1::bigint[]) OR restaurant_id IS NULL)
            AND reviewed = FALSE
            AND severity IN ('warn', 'block')`,
        [restaurantIds]
      );
      for (const s of rows) {
        track.touch(s.created_at);
        items.push(buildItem({
          category: 'restaurant_credit',
          sourceType: 'fraud_signal',
          sourceId: s.id,
          business,
          restaurant: s.restaurant_id != null ? nameOf(s.restaurant_id) : null,
          reason: 'attention.reasons.flaggedTransaction',
          reasonParams: { signalType: s.signal_type || '' },
          urgency: s.severity === 'block' ? 'urgent' : 'high',
          createdAt: s.created_at,
          deadlineAt: null,
          creditRail: 'restaurant',
          taskDestination: creditDest(business.id, { view: 'fraud', signalId: String(s.id) }),
        }, ctx));
      }
      track.done(false);
    } else {
      track.done(true, 'food_credit_fraud_signals table is missing or business has no restaurants');
    }
  }

  // ── OxSteed-credit pending actions attributed to this business ─────────────
  {
    const track = makeTracker(freshness, 'oxsteed_credit_pending_actions');
    if (await ctx.tableExists('oxsteed_credit_pending_actions')) {
      const { rows } = await ctx.pool.query(
        `SELECT id, action_type, status, expires_at, requested_at
           FROM oxsteed_credit_pending_actions
          WHERE status = 'pending'
            AND (payload ->> 'business_id' = $1 OR requested_by = $2)`,
        [String(business.id), business.user_id]
      );
      for (const a of rows) {
        track.touch(a.requested_at);
        const exp = a.expires_at ? new Date(a.expires_at) : null;
        const dueSoon = exp && (exp - ctx.now) < 24 * 3600 * 1000;
        items.push(buildItem({
          category: 'restaurant_credit',
          sourceType: 'oxsteed_credit_pending_action',
          sourceId: a.id,
          business,
          reason: 'attention.reasons.creditRequestPending',
          reasonParams: { actionType: a.action_type || '' },
          urgency: dueSoon ? 'high' : 'normal',
          createdAt: a.requested_at,
          deadlineAt: a.expires_at || null,
          creditRail: 'oxsteed',
          taskDestination: creditDest(business.id, { view: 'oxsteed', actionId: String(a.id) }),
        }, ctx));
      }
      track.done(false);
    } else {
      track.done(true, 'table oxsteed_credit_pending_actions is missing');
    }
  }

  return { items, freshness };
}

module.exports = { collect };
