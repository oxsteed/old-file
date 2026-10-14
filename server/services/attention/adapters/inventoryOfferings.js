'use strict';

/**
 * inventory_offerings adapter — low-stock alerts.
 * Source: business_product_low_stock_alerts. Alert rows exist only when the
 * business configured low-stock monitoring, so presence implies opt-in.
 */

const { buildItem, makeTracker } = require('../utils');

async function collect(business, ctx) {
  const items = [];
  const freshness = [];
  const track = makeTracker(freshness, 'business_product_low_stock_alerts');

  const hasAll = await ctx.tableExists('business_product_low_stock_alerts')
    && await ctx.tableExists('business_product_variants')
    && await ctx.tableExists('business_products');

  if (!hasAll) {
    track.done(true, 'low-stock alert/product tables are missing');
    return { items, freshness };
  }

  const { rows } = await ctx.pool.query(
    `SELECT a.id, a.last_alerted, a.created_at,
            v.variant_name, p.name AS product_name, p.sku
       FROM business_product_low_stock_alerts a
       JOIN business_product_variants v ON v.id = a.variant_id
       JOIN business_products p ON p.id = v.product_id
      WHERE p.business_id = $1 AND a.is_active`,
    [business.id]
  );

  for (const a of rows) {
    track.touch(a.last_alerted || a.created_at);
    items.push(buildItem({
      category: 'inventory_offerings',
      sourceType: 'low_stock_alert',
      sourceId: a.id,
      business,
      reason: 'attention.reasons.lowStock',
      reasonParams: {
        productName: a.product_name || '',
        variantName: a.variant_name || '',
        sku: a.sku || '',
      },
      urgency: 'normal',
      createdAt: a.last_alerted || a.created_at,
      deadlineAt: null,
      taskDestination: {
        type: 'route',
        route: `/business/${business.id}/products`,
        params: { alertId: String(a.id) },
      },
    }, ctx));
  }

  track.done(false);
  return { items, freshness };
}

module.exports = { collect };
