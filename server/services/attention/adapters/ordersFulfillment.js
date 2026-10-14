'use strict';

/**
 * orders_fulfillment adapter — food orders needing business action.
 * Sources: food_orders (+ food_restaurants for names).
 * Unresolved only: excludes completed / cancelled / refunded.
 */

const { buildItem, makeTracker } = require('../utils');

const NEW_ORDER_HIGH_AFTER_MS = 15 * 60 * 1000; // unaccepted > 15m → high
const STALLED_READY_AFTER_MS = 30 * 60 * 1000; // ready > 30m → stalled/high

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'food_orders');

  if (!(await ctx.tableExists('food_orders'))) {
    track.done(true, 'table food_orders is missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT o.id, o.restaurant_id, o.status, o.payment_status,
            o.total_cents, o.currency_code, o.promised_at,
            o.created_at, o.updated_at, o.ready_at,
            r.display_name AS restaurant_name
       FROM food_orders o
       LEFT JOIN food_restaurants r ON r.id = o.restaurant_id
      WHERE o.business_id = $1
        AND o.status NOT IN ('completed', 'cancelled', 'refunded')`,
    [business.id]
  );

  for (const o of rows) {
    track.touch(o.updated_at || o.created_at);
    const restaurant = o.restaurant_id != null
      ? { id: Number(o.restaurant_id), name: o.restaurant_name || `Restaurant ${o.restaurant_id}` }
      : null;
    const dest = {
      type: 'route',
      route: `/business/${business.id}/orders`,
      params: { orderId: String(o.id) },
    };
    const base = {
      category: 'orders_fulfillment',
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
        reason: 'attention.reasons.failedCharge',
        reasonParams: {},
        urgency: 'urgent',
        deadlineAt: null,
      }, ctx));
      continue;
    }

    const promised = o.promised_at ? new Date(o.promised_at) : null;
    if (promised && !Number.isNaN(promised.getTime()) && promised < ctx.now) {
      const lateMs = ctx.now - promised;
      items.push(buildItem({
        ...base,
        reason: 'attention.reasons.overdueFulfillment',
        reasonParams: { minutesLate: Math.floor(lateMs / 60000) },
        urgency: 'urgent',
        deadlineAt: o.promised_at,
      }, ctx));
      continue;
    }

    if (o.status === 'received') {
      const ageMs = ctx.now - new Date(o.created_at);
      items.push(buildItem({
        ...base,
        reason: 'attention.reasons.newOrder',
        reasonParams: {},
        urgency: ageMs > NEW_ORDER_HIGH_AFTER_MS ? 'high' : 'normal',
        deadlineAt: o.promised_at || null,
      }, ctx));
      continue;
    }

    if (o.status === 'ready' && o.ready_at) {
      const readyMs = ctx.now - new Date(o.ready_at);
      if (readyMs > STALLED_READY_AFTER_MS) {
        items.push(buildItem({
          ...base,
          reason: 'attention.reasons.stalledFulfillment',
          reasonParams: { minutesReady: Math.floor(readyMs / 60000) },
          urgency: 'high',
          deadlineAt: null,
        }, ctx));
      }
    }
  }

  track.done(false);
  return { items, freshness };
}

module.exports = { collect };
