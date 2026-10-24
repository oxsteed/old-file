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
const paidOrderPredicate = (alias = 'fo') => `${alias}.payment_status = 'paid' AND ${alias}.status NOT IN ('cancelled','refunded')`;

/**
 * Compute the repeat-order rate for one restaurant over a window.
 * @param {object} db      — anything with `.query` (pool in prod, pg-mem in tests)
 * @param {number} restaurantId
 * @param {object} window  — { from: ISO string, to: ISO string }
 * @returns {Promise<{repeat_order_rate: number|null, repeat_orders, total_identified_orders,
 *                    repeat_customers, guest_orders_excluded, window_days}>}
 */
async function getRepeatOrderRate(db, restaurantId, { from, to, locationIds = null }) {
  const { rows } = await db.query(
    `WITH cohort AS (
       SELECT fo.id, fo.customer_id
         FROM food_orders fo
        WHERE restaurant_id = $1
          AND created_at >= $2 AND created_at <= $3
          AND ${paidOrderPredicate()}${locationIds ? ' AND fo.location_id = ANY($4::bigint[])' : ''}
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
    [restaurantId, from, to, ...(locationIds ? [locationIds] : [])]
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
async function getTopItemsByRevenue(db, restaurantId, { from, to, limit = 10, locationIds = null }) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 10;
  const { rows } = await db.query(
    `SELECT
       COALESCE(foi.menu_item_id::text, 'name:' || foi.item_name) AS item_key,
       MAX(foi.menu_item_id)                                      AS menu_item_id,
       MAX(foi.item_name)                                         AS item_name,
       SUM(foi.quantity)::int                                     AS units_sold,
       COUNT(DISTINCT fo.id)::int                                AS orders,
       SUM(foi.line_total_cents)::bigint                          AS revenue_cents
       ,UPPER(fo.currency_code) AS currency_code
       FROM food_order_items foi
       JOIN food_orders fo
         ON fo.id = foi.order_id
        AND fo.restaurant_id = $1
        AND fo.created_at >= $2 AND fo.created_at <= $3
        AND ${paidOrderPredicate()}${locationIds ? ' AND fo.location_id = ANY($5::bigint[])' : ''}
      GROUP BY 1, UPPER(fo.currency_code)
      ORDER BY revenue_cents DESC, units_sold DESC
      LIMIT $4`,
    [restaurantId, from, to, safeLimit, ...(locationIds ? [locationIds] : [])]
  );
  return rows.map((r) => ({
    menu_item_id: r.menu_item_id == null ? null : Number(r.menu_item_id),
    item_name: r.item_name,
    units_sold: Number(r.units_sold) || 0,
    orders: Number(r.orders) || 0,
    revenue_cents: r.revenue_cents == null ? '0' : String(r.revenue_cents),
    currency_code: r.currency_code,
  }));
}

// Acquisition-month cohorts; age zero is the initial purchase month.
// Counts are based on paid orders and stable customer ids, never guest ids.
async function getRetentionCohorts(db, restaurantId, { from, to, locationIds = null }) {
  const { rows } = await db.query(`WITH purchases AS (
      SELECT customer_id,date_trunc('month',created_at)::date AS month
      FROM food_orders fo WHERE restaurant_id=$1 AND customer_id IS NOT NULL
        AND created_at <= $3 AND ${paidOrderPredicate()}${locationIds ? ' AND fo.location_id = ANY($4::bigint[])' : ''}
    ), acquired AS (
      SELECT customer_id,MIN(month) AS cohort FROM purchases GROUP BY 1
    ), activity AS (
      SELECT DISTINCT a.customer_id,a.cohort,p.month,
        (EXTRACT(YEAR FROM age(p.month,a.cohort))*12+EXTRACT(MONTH FROM age(p.month,a.cohort)))::INT AS month_index
      FROM acquired a JOIN purchases p USING(customer_id)
      WHERE a.cohort>=date_trunc('month',$2::timestamptz)::date
    ), cohorts AS (SELECT cohort,COUNT(*)::INT AS customers FROM acquired
      WHERE cohort>=date_trunc('month',$2::timestamptz)::date GROUP BY 1)
    SELECT c.cohort AS cohort_month,c.customers AS cohort_customers,g.month_index,
      COUNT(a.customer_id)::INT AS returning_customers,
      ROUND(COUNT(a.customer_id)::numeric/NULLIF(c.customers,0),4)::FLOAT AS retention_rate
    FROM cohorts c CROSS JOIN LATERAL generate_series(0,
      (EXTRACT(YEAR FROM age(date_trunc('month',$3::timestamptz)::date,c.cohort))*12+
       EXTRACT(MONTH FROM age(date_trunc('month',$3::timestamptz)::date,c.cohort)))::INT) g(month_index)
    LEFT JOIN activity a ON a.cohort=c.cohort AND a.month_index=g.month_index
    GROUP BY c.cohort,c.customers,g.month_index ORDER BY 1,3`, [restaurantId, from, to, ...(locationIds ? [locationIds] : [])]);
  return rows;
}

module.exports = {
  REPEAT_ORDER_WINDOW_DAYS,
  getRepeatOrderRate,
  getTopItemsByRevenue,
  getRetentionCohorts,
  paidOrderPredicate,
};
