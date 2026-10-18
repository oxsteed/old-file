// OxSteed Restaurants — Franchise reports.
// Aggregated sales, inventory, and operations analytics per restaurant.
// Read-only; manager-only (sales figures are sensitive).

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
const { resolveRestaurantAccess } = require('../services/scopeModel');
// Canonical restaurant-level analytics computations (Phase 2, Item 10).
const restaurantAnalytics = require('../analytics/restaurantAnalytics');
const { REPEAT_ORDER_WINDOW_DAYS } = restaurantAnalytics;

const MANAGE_ROLES = new Set(['owner', 'manager']);
const MAX_RANGE_DAYS = 366;

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Restaurant access via the canonical scope-model gate. The fast-fail
// `!restaurantId` guard and the manager-only reports policy are preserved
// here: the shared gate resolves standing; this module's 403 stays.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(userId, restaurantId);
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to view reports', 403, 'forbidden');
  }
  return restaurant;
}

function parseRange(query) {
  const to = query.to ? new Date(`${query.to}T23:59:59Z`) : new Date();
  const from = query.from ? new Date(`${query.from}T00:00:00Z`) : new Date(to.getTime() - 29 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new AppError('Invalid date range', 400, 'invalid_range');
  }
  if ((to - from) / 86400000 > MAX_RANGE_DAYS) {
    throw new AppError(`Date range capped at ${MAX_RANGE_DAYS} days`, 400, 'range_too_wide');
  }
  return { from: from.toISOString(), to: to.toISOString() };
}

// Same validation as parseRange, but the loyalty section defaults to the
// documented 90-day repeat-order window instead of 30 days.
function parseRange90(query) {
  if (query.from || query.to) return parseRange(query);
  const to = new Date();
  const from = new Date(to.getTime() - (REPEAT_ORDER_WINDOW_DAYS - 1) * 86400000);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ── Sales ────────────────────────────────────────────────────────────────────
// Revenue counts completed orders only; volume counts everything not
// cancelled/refunded.
exports.salesSummary = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { from, to } = parseRange(req.query);
    const [daily, totals, byFulfillment, bySource, currencyRow] = await Promise.all([
      pool.query(
        `SELECT DATE(created_at) AS day,
                COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded')) AS orders,
                COALESCE(SUM(total_cents) FILTER (WHERE status = 'completed'), 0) AS revenue_cents
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at BETWEEN $2 AND $3
          GROUP BY DATE(created_at)
          ORDER BY day ASC`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded')) AS orders,
                COALESCE(SUM(total_cents) FILTER (WHERE status = 'completed'), 0) AS revenue_cents,
                COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE status = 'refunded') AS refunded
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at BETWEEN $2 AND $3`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT fulfillment_type,
                COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded')) AS orders,
                COALESCE(SUM(total_cents) FILTER (WHERE status = 'completed'), 0) AS revenue_cents
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at BETWEEN $2 AND $3
          GROUP BY fulfillment_type
          ORDER BY revenue_cents DESC`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT order_source,
                COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded')) AS orders,
                COALESCE(SUM(total_cents) FILTER (WHERE status = 'completed'), 0) AS revenue_cents
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at BETWEEN $2 AND $3
          GROUP BY order_source
          ORDER BY revenue_cents DESC`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT currency_code FROM food_orders
          WHERE restaurant_id = $1 AND created_at BETWEEN $2 AND $3
          GROUP BY currency_code ORDER BY COUNT(*) DESC LIMIT 1`,
        [restaurantId, from, to]
      ),
    ]);
    const t = totals.rows[0];
    res.json({
      from, to,
      currency: currencyRow.rows[0]?.currency_code || 'USD',
      totals: {
        orders: Number(t.orders),
        revenue_cents: Number(t.revenue_cents),
        avg_ticket_cents: t.orders > 0 ? Math.round(Number(t.revenue_cents) / Number(t.orders)) : 0,
        cancelled: Number(t.cancelled),
        refunded: Number(t.refunded),
      },
      daily: daily.rows.map((r) => ({
        day: r.day,
        orders: Number(r.orders),
        revenue_cents: Number(r.revenue_cents),
      })),
      by_fulfillment: byFulfillment.rows.map((r) => ({
        fulfillment_type: r.fulfillment_type,
        orders: Number(r.orders),
        revenue_cents: Number(r.revenue_cents),
      })),
      by_source: bySource.rows.map((r) => ({
        order_source: r.order_source,
        orders: Number(r.orders),
        revenue_cents: Number(r.revenue_cents),
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ── Inventory ────────────────────────────────────────────────────────────────
exports.inventorySummary = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { from, to } = parseRange(req.query);
    const [byType, topWaste, lowStock] = await Promise.all([
      pool.query(
        `SELECT adjustment_type,
                COUNT(*) AS events,
                COALESCE(SUM(ABS(quantity_delta)), 0) AS total_qty
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND created_at BETWEEN $2 AND $3
          GROUP BY adjustment_type
          ORDER BY events DESC`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT item_name, COUNT(*) AS events,
                COALESCE(SUM(ABS(quantity_delta)), 0) AS wasted_qty
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND adjustment_type = 'waste'
            AND created_at BETWEEN $2 AND $3
          GROUP BY item_name
          ORDER BY wasted_qty DESC
          LIMIT 10`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT COUNT(*) AS low_count,
                COUNT(*) FILTER (WHERE quantity <= 0) AS out_count
           FROM restaurant_inventory_items
          WHERE restaurant_id = $1
            AND low_stock_threshold > 0
            AND quantity <= low_stock_threshold`,
        [restaurantId]
      ),
    ]);
    res.json({
      from, to,
      by_type: byType.rows.map((r) => ({
        adjustment_type: r.adjustment_type,
        events: Number(r.events),
        total_qty: Number(r.total_qty),
      })),
      top_waste: topWaste.rows.map((r) => ({
        item_name: r.item_name,
        events: Number(r.events),
        wasted_qty: Number(r.wasted_qty),
      })),
      low_stock_count: Number(lowStock.rows[0]?.low_count || 0),
      out_of_stock_count: Number(lowStock.rows[0]?.out_count || 0),
    });
  } catch (err) {
    next(err);
  }
};

// ── Operations ───────────────────────────────────────────────────────────────
exports.operationsSummary = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { from, to } = parseRange(req.query);
    const [checklists, audits, training] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS runs,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                AVG(CASE WHEN status = 'completed' AND total_tasks > 0
                         THEN completed_tasks::float / total_tasks END) AS avg_completion
           FROM restaurant_checklist_runs
          WHERE restaurant_id = $1 AND started_at BETWEEN $2 AND $3`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                AVG(CASE WHEN status = 'completed' AND max_score > 0
                         THEN total_score / max_score END) AS avg_score,
                COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
                (SELECT COUNT(*) FROM restaurant_corrective_actions ca
                  JOIN restaurant_audits a ON a.id = ca.audit_id
                 WHERE a.restaurant_id = $1 AND ca.status NOT IN ('resolved', 'verified')) AS open_actions
           FROM restaurant_audits
          WHERE restaurant_id = $1 AND started_at BETWEEN $2 AND $3`,
        [restaurantId, from, to]
      ),
      pool.query(
        `SELECT COUNT(*) AS assigned,
                COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
                AVG(c.score_pct) FILTER (WHERE c.id IS NOT NULL) AS avg_score,
                COUNT(*) FILTER (WHERE c.passed) AS passed
           FROM restaurant_training_assignments a
           LEFT JOIN restaurant_training_completions c ON c.assignment_id = a.id
          WHERE a.restaurant_id = $1 AND a.created_at BETWEEN $2 AND $3`,
        [restaurantId, from, to]
      ),
    ]);
    const cl = checklists.rows[0];
    const au = audits.rows[0];
    const tr = training.rows[0];
    res.json({
      from, to,
      checklists: {
        runs: Number(cl.runs),
        completed: Number(cl.completed),
        avg_completion_pct: cl.avg_completion == null ? null : Math.round(Number(cl.avg_completion) * 100),
      },
      audits: {
        completed: Number(au.completed),
        in_progress: Number(au.in_progress),
        avg_score_pct: au.avg_score == null ? null : Math.round(Number(au.avg_score) * 100),
        open_corrective_actions: Number(au.open_actions),
      },
      training: {
        assigned: Number(tr.assigned),
        completed: Number(tr.completed),
        avg_score_pct: tr.avg_score == null ? null : Math.round(Number(tr.avg_score)),
        passed: Number(tr.passed),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ── Loyalty (Phase 2, Item 10) ───────────────────────────────────────────────
// Repeat-order rate + top items by revenue. Computation lives in
// server/analytics/restaurantAnalytics.js (canonical definitions
// restaurant_repeat_order_rate / restaurant_top_items_revenue in the
// metrics registry); this endpoint is a thin, manager-only wrapper that
// applies the canonical restaurant access gate. Defaults to the 90-day
// window; explicit from/to stay within the shared range cap.
exports.loyaltySummary = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { from, to } = parseRange90(req.query);
    const [repeat, topItems] = await Promise.all([
      restaurantAnalytics.getRepeatOrderRate(pool, restaurantId, { from, to }),
      restaurantAnalytics.getTopItemsByRevenue(pool, restaurantId, { from, to, limit: 10 }),
    ]);
    res.json({
      from,
      to,
      window_days: REPEAT_ORDER_WINDOW_DAYS,
      repeat_order_rate: repeat.repeat_order_rate,
      repeat_orders: repeat.repeat_orders,
      total_identified_orders: repeat.total_identified_orders,
      repeat_customers: repeat.repeat_customers,
      guest_orders_excluded: repeat.guest_orders_excluded,
      top_items: topItems,
    });
  } catch (err) {
    next(err);
  }
};
