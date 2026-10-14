'use strict';

/**
 * refunds_disputes adapter.
 * Source: food_credit_refunds (restaurant → business). Pending refunds need a
 * decision; failed refunds need immediate attention.
 *
 * NOTE: food_credit_disputes are intentionally NOT collected here. They are
 * restaurant-credit records owned by the restaurant_credit adapter, so the
 * same record+problem stays one task (deduplicated by identity).
 * Marketplace/chat refunds have no business linkage in the schema and are
 * reported as a stale source rather than guessed.
 */

const { buildItem, makeTracker } = require('../utils');

const PENDING_HIGH_AFTER_MS = 7 * 24 * 3600 * 1000;

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'food_credit_refunds');
  const otherTrack = makeTracker(freshness, 'marketplace_chat_refunds');

  if (!(await ctx.tableExists('food_credit_refunds'))
      || !(await ctx.tableExists('food_restaurants'))) {
    track.done(true, 'food_credit_refunds/food_restaurants tables are missing');
  } else {
    const { rows } = await ctx.pool.query(
      `SELECT r.id, r.amount_cents, r.currency_code, r.status, r.reason,
              r.created_at, r.updated_at,
              fr.id AS restaurant_id, fr.display_name AS restaurant_name
         FROM food_credit_refunds r
         JOIN food_restaurants fr ON fr.id = r.restaurant_id
        WHERE fr.business_id = $1
          AND r.status IN ('pending', 'failed')`,
      [business.id]
    );
    for (const r of rows) {
      track.touch(r.updated_at || r.created_at);
      const restaurant = {
        id: Number(r.restaurant_id),
        name: r.restaurant_name || `Restaurant ${r.restaurant_id}`,
      };
      const dest = {
        type: 'route',
        route: `/business/${business.id}/refunds`,
        params: { refundId: String(r.id) },
      };
      if (r.status === 'failed') {
        items.push(buildItem({
          category: 'refunds_disputes',
          sourceType: 'food_credit_refund',
          sourceId: r.id,
          business,
          restaurant,
          reason: 'attention.reasons.failedCharge',
          reasonParams: {},
          urgency: 'urgent',
          createdAt: r.created_at,
          deadlineAt: null,
          amountCents: r.amount_cents != null ? Number(r.amount_cents) : null,
          currencyCode: r.currency_code || 'USD',
          taskDestination: dest,
        }, ctx));
      } else {
        const ageMs = ctx.now - new Date(r.created_at);
        items.push(buildItem({
          category: 'refunds_disputes',
          sourceType: 'food_credit_refund',
          sourceId: r.id,
          business,
          restaurant,
          reason: 'attention.reasons.refundDecision',
          reasonParams: {},
          urgency: ageMs > PENDING_HIGH_AFTER_MS ? 'high' : 'normal',
          createdAt: r.created_at,
          deadlineAt: null,
          amountCents: r.amount_cents != null ? Number(r.amount_cents) : null,
          currencyCode: r.currency_code || 'USD',
          taskDestination: dest,
        }, ctx));
      }
    }
    track.done(false);
  }

  otherTrack.done(
    true,
    'marketplace/chat refunds have no business linkage in the schema; cannot be attributed'
  );
  return { items, freshness };
}

module.exports = { collect };
