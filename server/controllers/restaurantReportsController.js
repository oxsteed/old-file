// OxSteed Restaurants — Franchise reports.
// Aggregated sales, inventory, and operations analytics per restaurant.
// Read-only; manager-only (sales figures are sensitive).

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissionsService = require('../services/permissionsService');
// Canonical restaurant-level analytics computations (Phase 2, Item 10).
const restaurantAnalytics = require('../analytics/restaurantAnalytics');
const { REPEAT_ORDER_WINDOW_DAYS } = restaurantAnalytics;

const MAX_RANGE_DAYS = 366;

function parsePositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Restaurant access via the canonical scope-model gate. The fast-fail
// `!restaurantId` guard and the manager-only reports policy are preserved
// here: the shared gate resolves standing; this module's 403 stays.
// S-08: the reports policy itself now resolves through the permission
// catalog (analytics.view_financial: granted to owners and managers by
// default) instead of a role-name check, so per-membership deny overrides
// actually close reports and allow overrides can open them deliberately.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(userId, restaurantId);
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, ['analytics.view_financial']);
  if (!allowed) {
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
// F-07: one trustworthy sales report. The previous implementation parsed
// ranges as UTC days, grouped by the database session zone, counted every
// 'completed' order's total as revenue (including unpaid ones), summed
// across currencies under one label, and divided by all non-cancelled
// orders for the average ticket. This version:
// - resolves from/to as LOCAL dates in the restaurant's timezone and
//   groups by local business date;
// - defines revenue as NET COLLECTED, mirroring getManagerReports in
//   restaurantAppFlowController: per order, recorded/captured POS
//   payments minus refund payments when the order has payments, else the
//   order total when payment_status = 'paid', else 0. Unpaid completed
//   orders contribute nothing;
// - never mixes currencies: every figure is computed per currency and
//   the top-level fields mirror the highest-revenue currency;
// - avg ticket = net collected / paid orders in the same currency;
// - carries a full breakdown (gross, discounts, net sales, tax, tips,
//   fees, refunds) plus a payment-method mix, and a CSV export with the
//   same facts (salesExportCsv below).

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveReportTimezone(restaurant) {
  const tz = restaurant && restaurant.timezone ? String(restaurant.timezone) : 'UTC';
  try {
    // Throws RangeError for anything that is not a valid IANA zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

function localDateString(date, timezone) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function shiftDateString(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isRealDateString(value) {
  if (!DATE_ONLY_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// from/to are local calendar dates (YYYY-MM-DD) in the restaurant's
// timezone, matching what the reports panel sends. Defaults: the last 30
// local days including today.
function parseSalesRange(query, timezone) {
  if ((query.from && !isRealDateString(query.from)) || (query.to && !isRealDateString(query.to))) {
    throw new AppError('Invalid date range', 400, 'invalid_range');
  }
  const toDate = query.to || localDateString(new Date(), timezone);
  const fromDate = query.from || shiftDateString(toDate, -29);
  if (fromDate > toDate) {
    throw new AppError('Invalid date range', 400, 'invalid_range');
  }
  const days = Math.round(
    (new Date(`${toDate}T12:00:00Z`) - new Date(`${fromDate}T12:00:00Z`)) / 86400000
  ) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new AppError(`Date range capped at ${MAX_RANGE_DAYS} days`, 400, 'range_too_wide');
  }
  return { fromDate, toDate };
}

// Per-order financials, mirroring the net-collected definition in
// getManagerReports (restaurantAppFlowController) exactly. $1 restaurant,
// $2 from local date, $3 to local date, $4 timezone.
const ORDER_FINANCIALS_CTE = `
  WITH order_financials AS (
    SELECT fo.*,
           CASE
             WHEN COALESCE(pos.payment_count, 0) > 0
               THEN GREATEST(0, pos.collected_cents - pos.refunded_cents)
             WHEN fo.payment_status = 'paid' THEN fo.total_cents
             ELSE 0
           END::int AS net_collected_cents,
           COALESCE(pos.collected_cents, 0)::int AS collected_cents,
           COALESCE(pos.refunded_cents, 0)::int AS refunded_cents
      FROM food_orders fo
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (
                 WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
               )::int AS payment_count,
               COALESCE(SUM(amount_cents) FILTER (
                 WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
               ), 0)::int AS collected_cents,
               COALESCE(SUM(amount_cents) FILTER (
                 WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')
               ), 0)::int AS refunded_cents
          FROM restaurant_pos_payments p
         WHERE p.food_order_id = fo.id
      ) pos ON TRUE
     WHERE fo.restaurant_id = $1
       AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
       AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
  )`;

const SALES_COMPONENT_SUMS = `
  COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded'))::int AS orders,
  COUNT(*) FILTER (WHERE net_collected_cents > 0)::int AS paid_orders,
  COALESCE(SUM(net_collected_cents), 0)::int AS revenue_cents,
  COALESCE(SUM(subtotal_cents) FILTER (WHERE net_collected_cents > 0), 0)::int AS gross_cents,
  COALESCE(SUM(discount_cents) FILTER (WHERE net_collected_cents > 0), 0)::int AS discount_cents,
  COALESCE(SUM(tax_cents) FILTER (WHERE net_collected_cents > 0), 0)::int AS tax_cents,
  COALESCE(SUM(tip_cents) FILTER (WHERE net_collected_cents > 0), 0)::int AS tips_cents,
  COALESCE(SUM(service_fee_cents) FILTER (WHERE net_collected_cents > 0), 0)::int AS service_fee_cents,
  COALESCE(SUM(delivery_fee_cents) FILTER (WHERE net_collected_cents > 0), 0)::int AS delivery_fee_cents,
  COALESCE(SUM(collected_cents), 0)::int AS collected_cents,
  COALESCE(SUM(refunded_cents), 0)::int AS refunds_cents`;

function salesTotalsShape(row) {
  const revenue = Number(row.revenue_cents || 0);
  const paidOrders = Number(row.paid_orders || 0);
  const gross = Number(row.gross_cents || 0);
  const discounts = Number(row.discount_cents || 0);
  return {
    orders: Number(row.orders || 0),
    paid_orders: paidOrders,
    revenue_cents: revenue,
    avg_ticket_cents: paidOrders > 0 ? Math.round(revenue / paidOrders) : 0,
    cancelled: Number(row.cancelled || 0),
    refunded: Number(row.refunded || 0),
    gross_cents: gross,
    discount_cents: discounts,
    net_sales_cents: gross - discounts,
    tax_cents: Number(row.tax_cents || 0),
    tips_cents: Number(row.tips_cents || 0),
    service_fee_cents: Number(row.service_fee_cents || 0),
    delivery_fee_cents: Number(row.delivery_fee_cents || 0),
    collected_cents: Number(row.collected_cents || 0),
    refunds_cents: Number(row.refunds_cents || 0),
  };
}

function salesDayShape(row) {
  const revenue = Number(row.revenue_cents || 0);
  const paidOrders = Number(row.paid_orders || 0);
  const gross = Number(row.gross_cents || 0);
  const discounts = Number(row.discount_cents || 0);
  return {
    day: row.day,
    orders: Number(row.orders || 0),
    paid_orders: paidOrders,
    revenue_cents: revenue,
    avg_ticket_cents: paidOrders > 0 ? Math.round(revenue / paidOrders) : 0,
    gross_cents: gross,
    discount_cents: discounts,
    net_sales_cents: gross - discounts,
    tax_cents: Number(row.tax_cents || 0),
    tips_cents: Number(row.tips_cents || 0),
    service_fee_cents: Number(row.service_fee_cents || 0),
    delivery_fee_cents: Number(row.delivery_fee_cents || 0),
    refunds_cents: Number(row.refunds_cents || 0),
  };
}

async function computeSalesReport(restaurantId, restaurant, query) {
  const timezone = resolveReportTimezone(restaurant);
  const { fromDate, toDate } = parseSalesRange(query || {}, timezone);
  const params = [restaurantId, fromDate, toDate, timezone];
  const [bounds, totals, daily, byFulfillment, bySource, paymentMethods] = await Promise.all([
    pool.query(
      `SELECT (($1::date)::timestamp AT TIME ZONE $3) AS from_instant,
              ((($2::date + 1))::timestamp AT TIME ZONE $3) AS to_instant`,
      [fromDate, toDate, timezone]
    ),
    pool.query(
      `${ORDER_FINANCIALS_CTE}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              ${SALES_COMPONENT_SUMS},
              COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE status = 'refunded')::int AS refunded
         FROM order_financials
        GROUP BY 1
        ORDER BY revenue_cents DESC`,
      params
    ),
    pool.query(
      `${ORDER_FINANCIALS_CTE}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              to_char((created_at AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS day,
              ${SALES_COMPONENT_SUMS}
         FROM order_financials
        GROUP BY 1, 2
        ORDER BY 2 ASC`,
      params
    ),
    pool.query(
      `${ORDER_FINANCIALS_CTE}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              fulfillment_type,
              COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded'))::int AS orders,
              COUNT(*) FILTER (WHERE net_collected_cents > 0)::int AS paid_orders,
              COALESCE(SUM(net_collected_cents), 0)::int AS revenue_cents
         FROM order_financials
        GROUP BY 1, 2
        ORDER BY revenue_cents DESC`,
      params
    ),
    pool.query(
      `${ORDER_FINANCIALS_CTE}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              order_source,
              COUNT(*) FILTER (WHERE status NOT IN ('cancelled', 'refunded'))::int AS orders,
              COUNT(*) FILTER (WHERE net_collected_cents > 0)::int AS paid_orders,
              COALESCE(SUM(net_collected_cents), 0)::int AS revenue_cents
         FROM order_financials
        GROUP BY 1, 2
        ORDER BY revenue_cents DESC`,
      params
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(fo.currency_code, ''), 'USD') AS currency,
              p.payment_type,
              COUNT(*)::int AS payments,
              COALESCE(SUM(p.amount_cents), 0)::int AS amount_cents
         FROM restaurant_pos_payments p
         JOIN food_orders fo ON fo.id = p.food_order_id
        WHERE p.restaurant_id = $1
          AND p.payment_type <> 'refund'
          AND p.status IN ('recorded', 'captured')
          AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        GROUP BY 1, 2
        ORDER BY amount_cents DESC`,
      params
    ),
  ]);

  const byCurrency = new Map();
  const entryFor = (currency) => {
    if (!byCurrency.has(currency)) {
      byCurrency.set(currency, {
        currency,
        totals: null,
        daily: [],
        by_fulfillment: [],
        by_source: [],
        payment_methods: [],
      });
    }
    return byCurrency.get(currency);
  };
  for (const row of totals.rows) entryFor(row.currency).totals = salesTotalsShape(row);
  for (const row of daily.rows) entryFor(row.currency).daily.push(salesDayShape(row));
  for (const row of byFulfillment.rows) {
    entryFor(row.currency).by_fulfillment.push({
      fulfillment_type: row.fulfillment_type,
      orders: Number(row.orders),
      paid_orders: Number(row.paid_orders),
      revenue_cents: Number(row.revenue_cents),
    });
  }
  for (const row of bySource.rows) {
    entryFor(row.currency).by_source.push({
      order_source: row.order_source,
      orders: Number(row.orders),
      paid_orders: Number(row.paid_orders),
      revenue_cents: Number(row.revenue_cents),
    });
  }
  for (const row of paymentMethods.rows) {
    entryFor(row.currency).payment_methods.push({
      payment_type: row.payment_type,
      payments: Number(row.payments),
      amount_cents: Number(row.amount_cents),
    });
  }
  const currencies = [...byCurrency.values()].filter((c) => c.totals);
  currencies.sort((a, b) => b.totals.revenue_cents - a.totals.revenue_cents);

  const primary = currencies[0] || null;
  const emptyTotals = salesTotalsShape({});
  const bound = bounds.rows[0] || {};
  return {
    from: bound.from_instant ? new Date(bound.from_instant).toISOString() : null,
    to: bound.to_instant ? new Date(bound.to_instant).toISOString() : null,
    from_date: fromDate,
    to_date: toDate,
    timezone,
    currency: primary ? primary.currency : (restaurant.currency_code || 'USD'),
    totals: primary ? primary.totals : emptyTotals,
    daily: primary ? primary.daily : [],
    by_fulfillment: primary ? primary.by_fulfillment : [],
    by_source: primary ? primary.by_source : [],
    payment_methods: primary ? primary.payment_methods : [],
    currencies,
  };
}

exports.salesSummary = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const report = await computeSalesReport(restaurantId, restaurant, req.query);
    res.json(report);
  } catch (err) {
    next(err);
  }
};

// CSV export with exactly the facts computeSalesReport produces: one row
// per local business day per currency, plus a TOTAL row per currency.
const SALES_CSV_COLUMNS = [
  'date', 'currency', 'orders', 'paid_orders', 'gross_cents', 'discounts_cents',
  'net_sales_cents', 'tax_cents', 'tips_cents', 'service_fees_cents',
  'delivery_fees_cents', 'refunds_cents', 'net_collected_cents', 'avg_ticket_cents',
];

function salesCsvRow(date, currency, s) {
  return [
    date, currency, s.orders, s.paid_orders, s.gross_cents, s.discount_cents,
    s.net_sales_cents, s.tax_cents, s.tips_cents, s.service_fee_cents,
    s.delivery_fee_cents, s.refunds_cents, s.revenue_cents, s.avg_ticket_cents,
  ].join(',');
}

exports.salesExportCsv = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const report = await computeSalesReport(restaurantId, restaurant, req.query);
    const lines = [SALES_CSV_COLUMNS.join(',')];
    if (report.currencies.length === 0) {
      lines.push(salesCsvRow('TOTAL', report.currency, report.totals));
    }
    for (const c of report.currencies) {
      for (const d of c.daily) lines.push(salesCsvRow(d.day, c.currency, d));
      lines.push(salesCsvRow('TOTAL', c.currency, c.totals));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sales-report-${report.from_date}-to-${report.to_date}.csv"`
    );
    res.send(`${lines.join('\n')}\n`);
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
    const [repeat, topItems, retention] = await Promise.all([
      restaurantAnalytics.getRepeatOrderRate(pool, restaurantId, { from, to }),
      restaurantAnalytics.getTopItemsByRevenue(pool, restaurantId, { from, to, limit: 10 }),
      restaurantAnalytics.getRetentionCohorts(pool, restaurantId, { from, to }),
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
      retention_cohorts: retention,
      observed_through: to,
    });
  } catch (err) {
    next(err);
  }
};
