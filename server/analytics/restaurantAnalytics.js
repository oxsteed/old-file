'use strict';

/**
 * restaurantAnalytics — restaurant-level analytics computations (Analytics
 * platform, Phase 2, Item 10: embedded gaps).
 *
 * The platform metrics registry (server/analytics/metricsRegistry.js) is
 * platform-level and has no matching definitions for these two metrics, so
 * each computation is defined EXACTLY ONCE here (never inline in a
 * controller) and consumed by thin endpoints / tests.
 *
 * ── 90-day window ──────────────────────────────────────────────────────────
 * The restaurant reports panel shows 7/30/90-day presets; the loyalty
 * section defaults to the last 90 days (documented on the endpoint
 * response as `window_days`). Callers may pass an explicit [from, to]
 * within the controller's range cap; the definition is identical either
 * way — only the window bounds change.
 *
 * ── restaurant_repeat_order_rate ───────────────────────────────────────────
 * Share of identified orders in the window placed by customers who placed
 * more than one order at the same restaurant inside the same window.
 *
 *   repeat_order_rate = repeat_orders / total_identified_orders
 *
 * where
 *   - "orders" are food_orders with status NOT IN ('cancelled','refunded')
 *     and created_at inside the window (mirrors the sales report's order
 *     counting; cancelled/refunded orders are not purchases),
 *   - "identified" means customer_id IS NOT NULL. Guest orders (kiosk /
 *     counter / guest checkout) carry no stable identity and are excluded
 *     from BOTH numerator and denominator — the rate is "of the orders we
 *     can attribute to a customer, what share came from repeat customers".
 *     They are reported separately as `guest_orders_excluded` so the panel
 *     can show why the denominator is smaller than total orders.
 *   - a "repeat customer" is a distinct customer_id with COUNT(*) > 1 in
 *     the window. All of that customer's in-window orders count as repeat
 *     orders (first purchase included: the customer IS a repeat customer).
 * Returns NULL when total_identified_orders = 0 (no attribution possible),
 * not 0 — the UI renders an empty state, not a misleading zero.
 *
 * ── restaurant_top_items_revenue ───────────────────────────────────────────
 * Top N menu items by revenue (SUM of food_order_items.line_total_cents)
 * from the same order cohort as the sales report (non-cancelled,
 * non-refunded, in-window). Grouped by menu_item_id (stable across
 * renames); items whose menu row was deleted (menu_item_id IS NULL)
 * fall back to the item_name snapshot stored on the order line.
 * Each row: menu_item_id, item_name, units_sold, orders, revenue_cents.
 */

const REPEAT_ORDER_WINDOW_DAYS = 90;

/**
 * Compute the repeat-order rate for one restaurant over a window.
 * @param {object} db      — anything with `.query` (pool in prod, pg-mem in tests)
 * @param {number} restaurantId
 * @param {object} window  — { from: ISO string, to: ISO string }
 * @returns {Promise<{repeat_order_rate: number|null, repeat_orders, total_identified_orders,
 *                    repeat_customers, guest_orders_excluded, window_days}>}
 */
async function getRepeatOrderRate(db, restaurantId, { from, to }) {
  const { rows } = await db.query(
    `WITH cohort AS (
       SELECT id, customer_id
         FROM food_orders
        WHERE restaurant_id = $1
          AND created_at >= $2 AND created_at <= $3
          AND status NOT IN ('cancelled', 'refunded')
     ),
     identified AS (
       SELECT id, customer_id FROM cohort WHERE customer_id IS NOT NULL
     ),
     repeat_customers AS (
       SELECT customer_id
         FROM identified
        GROUP BY customer_id
       HAVING COUNT(*) > 1
     )
     SELECT
       (SELECT COUNT(*)::int FROM identified)                                   AS total_identified,
       (SELECT COUNT(*)::int FROM cohort WHERE customer_id IS NULL)              AS guest_orders,
       (SELECT COUNT(*)::int FROM repeat_customers)                              AS repeat_customers,
       (SELECT COUNT(*)::int FROM identified i
          WHERE i.customer_id IN (SELECT customer_id FROM repeat_customers))    AS repeat_orders`,
    [restaurantId, from, to]
  );
  const r = rows[0] || {};
  const total = Number(r.total_identified) || 0;
  const repeat = Number(r.repeat_orders) || 0;
  return {
    repeat_order_rate: total > 0 ? repeat / total : null,
    repeat_orders: repeat,
    total_identified_orders: total,
    repeat_customers: Number(r.repeat_customers) || 0,
    guest_orders_excluded: Number(r.guest_orders) || 0,
  };
}

/**
 * Top menu items by revenue for one restaurant over a window.
 * @param {object} db
 * @param {number} restaurantId
 * @param {object} opts — { from, to, limit = 10 }
 */
async function getTopItemsByRevenue(db, restaurantId, { from, to, limit = 10 }) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 10;
  const { rows } = await db.query(
    `SELECT
       COALESCE(foi.menu_item_id::text, 'name:' || foi.item_name) AS item_key,
       MAX(foi.menu_item_id)                                      AS menu_item_id,
       MAX(foi.item_name)                                         AS item_name,
       SUM(foi.quantity)::int                                     AS units_sold,
       COUNT(DISTINCT fo.id)::int                                AS orders,
       SUM(foi.line_total_cents)::bigint                          AS revenue_cents
       FROM food_order_items foi
       JOIN food_orders fo
         ON fo.id = foi.order_id
        AND fo.restaurant_id = $1
        AND fo.created_at >= $2 AND fo.created_at <= $3
        AND fo.status NOT IN ('cancelled', 'refunded')
      GROUP BY 1
      ORDER BY revenue_cents DESC, units_sold DESC
      LIMIT $4`,
    [restaurantId, from, to, safeLimit]
  );
  return rows.map((r) => ({
    menu_item_id: r.menu_item_id == null ? null : Number(r.menu_item_id),
    item_name: r.item_name,
    units_sold: Number(r.units_sold) || 0,
    orders: Number(r.orders) || 0,
    revenue_cents: Number(r.revenue_cents) || 0,
  }));
}

module.exports = {
  REPEAT_ORDER_WINDOW_DAYS,
  getRepeatOrderRate,
  getTopItemsByRevenue,
};
