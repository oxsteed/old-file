'use strict';

/**
 * pickup_delivery adapter — delivery orders with missed windows or failed payment.
 * Sources: food_orders (fulfillment_type='delivery').
 * There is no authoritative delivery-assignment table, so "unassigned
 * deliveries" is reported as a stale source instead of guessed.
 */

const { buildItem, makeTracker } = require('../utils');

const MISSED_URGENT_AFTER_MS = 60 * 60 * 1000; // > 60m late → urgent

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'food_orders');
  const assignTrack = makeTracker(freshness, 'delivery_assignments');

  if (!(await ctx.tableExists('food_orders'))) {
    track.done(true, 'table food_orders is missing');
    assignTrack.done(true, 'no authoritative delivery-assignment table');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT o.id, o.restaurant_id, o.status, o.payment_status,
            o.total_cents, o.currency_code, o.promised_at,
            o.created_at, o.updated_at,
            r.display_name AS restaurant_name
       FROM food_orders o
       LEFT JOIN food_restaurants r ON r.id = o.restaurant_id
      WHERE o.business_id = $1
        AND o.fulfillment_type = 'delivery'
        AND o.status NOT IN ('completed', 'cancelled', 'refunded')
        AND ($2::bigint[] IS NULL OR o.location_id = ANY($2::bigint[]))`,
    [business.id, ctx.locationIds || null]
  );

  for (const o of rows) {
    track.touch(o.updated_at || o.created_at);
    const restaurant = o.restaurant_id != null
      ? { id: Number(o.restaurant_id), name: o.restaurant_name || `Restaurant ${o.restaurant_id}` }
      : null;
    const dest = {
      type: 'route',
      route: `/business/${business.id}/deliveries`,
      params: { orderId: String(o.id) },
    };
    const base = {
      category: 'pickup_delivery',
      sourceType: 'food_order',
      sourceId: o.id,
      business,
      restaurant,
      createdAt: o.created_at,
      amountCents: o.total_cents,
      currencyCode: o.currency_code || 'USD',
      taskDestination: dest,
    };

    if (o.payment_status === 'failed') {
      items.push(buildItem({
        ...base,
        reason: 'attention.reasons.failedDelivery',
        reasonParams: {},
        urgency: 'urgent',
      }, ctx));
      continue;
    }

    const promised = o.promised_at ? new Date(o.promised_at) : null;
    if (promised && !Number.isNaN(promised.getTime()) && promised < ctx.now
        && o.status !== 'ready') {
      const lateMs = ctx.now - promised;
      items.push(buildItem({
        ...base,
        reason: 'attention.reasons.missedDelivery',
        reasonParams: { minutesLate: Math.floor(lateMs / 60000) },
        urgency: lateMs > MISSED_URGENT_AFTER_MS ? 'urgent' : 'high',
        deadlineAt: o.promised_at,
      }, ctx));
    }
  }

  track.done(false);
  // Honest gap: assignment state has no queryable source; never infer it.
  assignTrack.done(true, 'no authoritative delivery-assignment table; unassigned deliveries cannot be determined');
  return { items, freshness };
}

module.exports = { collect };
