'use strict';

/**
 * payments_settlements adapter.
 * Sources: restaurant_payouts (failed / stalled), reconciliation_exceptions
 * (open or acknowledged, payout_settlement domain, attributed to this
 * business via details.business_id).
 */

const { buildItem, makeTracker } = require('../utils');

const STALLED_AFTER_MS = 48 * 3600 * 1000;

const SEVERITY_URGENCY = { critical: 'urgent', warning: 'high', info: 'normal' };

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const payoutTrack = makeTracker(freshness, 'restaurant_payouts');
  const reconTrack = makeTracker(freshness, 'reconciliation_exceptions');

  if (await ctx.tableExists('restaurant_payouts')
      && await ctx.tableExists('food_restaurants')) {
    const { rows } = await ctx.pool.query(
      `SELECT p.id, p.amount_cents, p.status, p.created_at, p.updated_at,
              fr.id AS restaurant_id, fr.display_name AS restaurant_name,
              fr.currency_code AS restaurant_currency
         FROM restaurant_payouts p
         JOIN food_restaurants fr ON fr.id = p.restaurant_id
        WHERE fr.business_id = $1
          AND p.status IN ('failed', 'requested')`,
      [business.id]
    );
    for (const p of rows) {
      payoutTrack.touch(p.updated_at || p.created_at);
      const restaurant = {
        id: Number(p.restaurant_id),
        name: p.restaurant_name || `Restaurant ${p.restaurant_id}`,
      };
      const dest = {
        type: 'route',
        route: `/business/${business.id}/payouts`,
        params: { payoutId: String(p.id) },
      };
      if (p.status === 'failed') {
        items.push(buildItem({
          category: 'payments_settlements',
          sourceType: 'restaurant_payout',
          sourceId: p.id,
          business,
          restaurant,
          reason: 'attention.reasons.failedPayout',
          reasonParams: {},
          urgency: 'urgent',
          createdAt: p.created_at,
          deadlineAt: null,
          amountCents: p.amount_cents != null ? Number(p.amount_cents) : null,
          currencyCode: p.restaurant_currency || 'USD',
          taskDestination: dest,
        }, ctx));
      } else if (ctx.now - new Date(p.created_at) > STALLED_AFTER_MS) {
        items.push(buildItem({
          category: 'payments_settlements',
          sourceType: 'restaurant_payout',
          sourceId: p.id,
          business,
          restaurant,
          reason: 'attention.reasons.payoutBlocked',
          reasonParams: {},
          urgency: 'high',
          createdAt: p.created_at,
          deadlineAt: null,
          amountCents: p.amount_cents != null ? Number(p.amount_cents) : null,
          currencyCode: p.restaurant_currency || 'USD',
          taskDestination: dest,
        }, ctx));
      }
    }
    payoutTrack.done(false);
  } else {
    payoutTrack.done(true, 'restaurant_payouts/food_restaurants tables are missing');
  }

  if (await ctx.tableExists('reconciliation_exceptions')) {
    const { rows } = await ctx.pool.query(
      `SELECT id, domain, severity, summary, created_at, updated_at
         FROM reconciliation_exceptions
        WHERE status IN ('open', 'acknowledged')
          AND domain = 'payout_settlement'
          AND details ->> 'business_id' = $1`,
      [String(business.id)]
    );
    for (const e of rows) {
      reconTrack.touch(e.updated_at || e.created_at);
      items.push(buildItem({
        category: 'payments_settlements',
        sourceType: 'reconciliation_exception',
        sourceId: e.id,
        business,
        reason: 'attention.reasons.reconciliationDiff',
        reasonParams: { summary: e.summary || '' },
        urgency: SEVERITY_URGENCY[e.severity] || 'normal',
        createdAt: e.created_at,
        deadlineAt: null,
        taskDestination: {
          type: 'route',
          route: `/business/${business.id}/payouts`,
          params: { exceptionId: String(e.id) },
        },
      }, ctx));
    }
    reconTrack.done(false);
  } else {
    reconTrack.done(true, 'table reconciliation_exceptions is missing');
  }

  return { items, freshness };
}

module.exports = { collect };
