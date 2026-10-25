// OxSteed Restaurants — Franchise reports.
// Aggregated sales, inventory, and operations analytics per restaurant.
// Read-only; manager-only (sales figures are sensitive).

const pool = require('../db');
const archiver = require('archiver');
const { AppError } = require('../middleware/errorHandler');
// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
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
  return { ...restaurant, locationScope: await getLocationScope(restaurant, userId) };
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
// $2 from local date, $3 to local date, $4 restaurant timezone.
//
// F-07: the business day is per store, not per restaurant. Each order's
// business_date is its local calendar date in ITS store's timezone,
// shifted back by the store's day_start_hour (a store closing at 2 AM
// attributes late-night sales to the previous business day). Orders
// without a store row inherit the restaurant timezone with a midnight
// boundary, preserving the old behavior.
const { orderFinancialsCte } = require('../services/restaurantSalesFacts');

function scopedParams(baseParams, locationScope) {
  return locationScope?.mode === 'assigned'
    ? [...baseParams, locationScope.location_ids]
    : baseParams;
}

const SALES_COMPONENT_SUMS = `
  COUNT(*) FILTER (WHERE o.status NOT IN ('cancelled', 'refunded'))::int AS orders,
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
  const params = scopedParams([restaurantId, fromDate, toDate, timezone], restaurant.locationScope);
  const cte = orderFinancialsCte(restaurant.locationScope);
  const [bounds, totals, daily, byFulfillment, bySource, paymentMethods] = await Promise.all([
    pool.query(
      `SELECT (($1::date)::timestamp AT TIME ZONE $3) AS from_instant,
              ((($2::date + 1))::timestamp AT TIME ZONE $3) AS to_instant`,
      [fromDate, toDate, timezone]
    ),
    pool.query(
      `${cte}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              ${SALES_COMPONENT_SUMS},
              COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE o.status = 'refunded')::int AS refunded
         FROM order_financials o
        GROUP BY 1
        ORDER BY revenue_cents DESC`,
      params
    ),
    pool.query(
      `${cte}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              to_char(business_date, 'YYYY-MM-DD') AS day,
              ${SALES_COMPONENT_SUMS}
         FROM order_financials o
        GROUP BY 1, 2
        ORDER BY 2 ASC`,
      params
    ),
    pool.query(
      `${cte}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              fulfillment_type,
              COUNT(*) FILTER (WHERE o.status NOT IN ('cancelled', 'refunded'))::int AS orders,
              COUNT(*) FILTER (WHERE net_collected_cents > 0)::int AS paid_orders,
              COALESCE(SUM(net_collected_cents), 0)::int AS revenue_cents
         FROM order_financials o
        GROUP BY 1, 2
        ORDER BY revenue_cents DESC`,
      params
    ),
    pool.query(
      `${cte}
       SELECT COALESCE(NULLIF(currency_code, ''), 'USD') AS currency,
              order_source,
              COUNT(*) FILTER (WHERE o.status NOT IN ('cancelled', 'refunded'))::int AS orders,
              COUNT(*) FILTER (WHERE net_collected_cents > 0)::int AS paid_orders,
              COALESCE(SUM(net_collected_cents), 0)::int AS revenue_cents
         FROM order_financials o
        GROUP BY 1, 2
        ORDER BY revenue_cents DESC`,
      params
    ),
    pool.query(
      // F-07: the payment mix covers the same business-dated order set as
      // the rest of the report (joining order_financials), not a
      // restaurant-tz instant window, so per-store day boundaries agree.
      `${cte}
       SELECT COALESCE(NULLIF(fo.currency_code, ''), 'USD') AS currency,
              p.payment_type,
              COUNT(*)::int AS payments,
              COALESCE(SUM(p.amount_cents), 0)::int AS amount_cents
         FROM restaurant_pos_payments p
         JOIN food_orders fo ON fo.id = p.food_order_id
         JOIN order_financials of2 ON of2.id = fo.id
        WHERE p.restaurant_id = $1
          AND p.payment_type <> 'refund'
          AND p.status IN ('recorded', 'captured')
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

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

function parseCloseDate(query, timezone) {
  const raw = query?.date || localDateString(new Date(), timezone);
  if (!isRealDateString(raw)) throw new AppError('Invalid close date', 400, 'invalid_range');
  return raw;
}

function closeTotalsShape(row) {
  return salesTotalsShape({
    ...row,
    cancelled: row.cancelled,
    refunded: row.refunded,
  });
}

async function computeDailyClose(restaurantId, restaurant, query = {}) {
  const timezone = resolveReportTimezone(restaurant);
  const businessDate = parseCloseDate(query, timezone);
  const params = scopedParams([restaurantId, businessDate, businessDate, timezone], restaurant.locationScope);
  const cte = orderFinancialsCte(restaurant.locationScope);
  const [locationTotals, paymentMethods] = await Promise.all([
    pool.query(
      `${cte}
       SELECT o.location_id,
              COALESCE(l.name, 'Unassigned') AS location_name,
              COALESCE(NULLIF(o.currency_code, ''), 'USD') AS currency,
              ${SALES_COMPONENT_SUMS},
              COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE o.status = 'refunded')::int AS refunded
         FROM order_financials o
         LEFT JOIN restaurant_locations l
           ON l.restaurant_id = o.restaurant_id AND l.id = o.location_id
         ${restaurant.locationScope?.mode === 'assigned' ? 'WHERE o.location_id = ANY($5::bigint[])' : ''}
        GROUP BY o.location_id, l.name, 3
        ORDER BY location_name ASC, currency ASC`,
      params
    ),
    pool.query(
      // F-07: same business-dated order set as the close totals above.
      `${cte}
       SELECT fo.location_id,
              COALESCE(l.name, 'Unassigned') AS location_name,
              COALESCE(NULLIF(fo.currency_code, ''), 'USD') AS currency,
              p.payment_type,
              COUNT(*)::int AS payments,
              COALESCE(SUM(p.amount_cents), 0)::int AS amount_cents
         FROM restaurant_pos_payments p
         JOIN food_orders fo ON fo.id = p.food_order_id
         JOIN order_financials of2 ON of2.id = fo.id
         LEFT JOIN restaurant_locations l
           ON l.restaurant_id = fo.restaurant_id AND l.id = fo.location_id
        WHERE p.restaurant_id = $1
          AND p.status IN ('recorded', 'captured', 'refunded')
        GROUP BY fo.location_id, l.name, 3, p.payment_type
        ORDER BY location_name ASC, currency ASC, amount_cents DESC`,
      params
    ),
  ]);

  const closeByKey = new Map();
  for (const row of locationTotals.rows) {
    const key = `${row.location_id || 'none'}:${row.currency}`;
    closeByKey.set(key, {
      location_id: row.location_id === null ? null : Number(row.location_id),
      location_name: row.location_name,
      currency: row.currency,
      totals: closeTotalsShape(row),
      payment_methods: [],
    });
  }
  for (const row of paymentMethods.rows) {
    const key = `${row.location_id || 'none'}:${row.currency}`;
    if (!closeByKey.has(key)) {
      closeByKey.set(key, {
        location_id: row.location_id === null ? null : Number(row.location_id),
        location_name: row.location_name,
        currency: row.currency,
        totals: salesTotalsShape({}),
        payment_methods: [],
      });
    }
    closeByKey.get(key).payment_methods.push({
      payment_type: row.payment_type,
      payments: Number(row.payments || 0),
      amount_cents: Number(row.amount_cents || 0),
    });
  }
  const locations = [...closeByKey.values()];
  const brandByCurrency = new Map();
  for (const entry of locations) {
    if (!brandByCurrency.has(entry.currency)) brandByCurrency.set(entry.currency, []);
    brandByCurrency.get(entry.currency).push(entry.totals);
  }
  const brandTotals = [...brandByCurrency.entries()].map(([currency, totals]) => {
    const sum = totals.reduce((acc, row) => {
      for (const key of ['orders', 'paid_orders', 'revenue_cents', 'cancelled', 'refunded', 'gross_cents', 'discount_cents', 'net_sales_cents', 'tax_cents', 'tips_cents', 'service_fee_cents', 'delivery_fee_cents', 'collected_cents', 'refunds_cents']) {
        acc[key] = (acc[key] || 0) + Number(row[key] || 0);
      }
      return acc;
    }, {});
    sum.avg_ticket_cents = sum.paid_orders > 0 ? Math.round(sum.revenue_cents / sum.paid_orders) : 0;
    return { currency, totals: sum };
  });
  return { business_date: businessDate, timezone, locations, brand_totals: brandTotals };
}

async function computeLocationComparison(restaurantId, restaurant, query = {}) {
  const timezone = resolveReportTimezone(restaurant);
  const { fromDate, toDate } = parseSalesRange(query, timezone);
  const { rows } = await pool.query(
    `${orderFinancialsCte(restaurant.locationScope)}
     SELECT o.location_id,
            COALESCE(l.name, 'Unassigned') AS location_name,
            COALESCE(NULLIF(o.currency_code, ''), 'USD') AS currency,
            ${SALES_COMPONENT_SUMS},
            COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled,
            COUNT(*) FILTER (WHERE o.status = 'refunded')::int AS refunded
       FROM order_financials o
       LEFT JOIN restaurant_locations l
         ON l.restaurant_id = o.restaurant_id AND l.id = o.location_id
      ${restaurant.locationScope?.mode === 'assigned' ? 'WHERE o.location_id = ANY($5::bigint[])' : ''}
      GROUP BY o.location_id, l.name, 3
      ORDER BY currency ASC, revenue_cents DESC, location_name ASC`,
    scopedParams([restaurantId, fromDate, toDate, timezone], restaurant.locationScope)
  );
  const locations = rows.map((row) => ({
    location_id: row.location_id === null ? null : Number(row.location_id),
    location_name: row.location_name,
    currency: row.currency,
    totals: closeTotalsShape(row),
  }));
  const brandByCurrency = new Map();
  for (const entry of locations) {
    if (!brandByCurrency.has(entry.currency)) brandByCurrency.set(entry.currency, []);
    brandByCurrency.get(entry.currency).push(entry.totals);
  }
  const brandTotals = [...brandByCurrency.entries()].map(([currency, totals]) => {
    const sum = totals.reduce((acc, row) => {
      for (const key of ['orders', 'paid_orders', 'revenue_cents', 'cancelled', 'refunded', 'gross_cents', 'discount_cents', 'net_sales_cents', 'tax_cents', 'tips_cents', 'service_fee_cents', 'delivery_fee_cents', 'collected_cents', 'refunds_cents']) {
        acc[key] = (acc[key] || 0) + Number(row[key] || 0);
      }
      return acc;
    }, {});
    sum.avg_ticket_cents = sum.paid_orders > 0 ? Math.round(sum.revenue_cents / sum.paid_orders) : 0;
    return { currency, totals: sum };
  });
  return { from_date: fromDate, to_date: toDate, timezone, locations, brand_totals: brandTotals };
}

exports.salesLocationComparison = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    res.json(await computeLocationComparison(restaurantId, restaurant, req.query));
  } catch (err) {
    next(err);
  }
};

const SALES_LOCATION_COMPARISON_CSV_COLUMNS = [
  'from_date', 'to_date', 'location_id', 'location_name', 'currency', 'orders',
  'paid_orders', 'gross_cents', 'discount_cents', 'net_sales_cents', 'tax_cents',
  'tips_cents', 'service_fee_cents', 'delivery_fee_cents', 'refunds_cents',
  'net_collected_cents', 'avg_ticket_cents',
];

// Keep the XLSX writer deliberately small and dependency-free beyond the
// already-installed ZIP implementation. Values are written as inline strings
// or numbers, so user-controlled store names cannot become formulas.
function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xlsxColumnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function xlsxCell(reference, value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function xlsxWorksheet(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => xlsxCell(`${xlsxColumnName(columnIndex)}${rowIndex + 1}`, value)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

function buildSalesLocationWorkbook(report) {
  const locationHeaders = SALES_LOCATION_COMPARISON_CSV_COLUMNS;
  const locationRows = [
    ['Sales location comparison', ''],
    ['From date', report.from_date, 'To date', report.to_date],
    ['Timezone', report.timezone],
    [],
    locationHeaders,
    ...report.locations.map((location) => {
      const s = location.totals;
      return [
        report.from_date, report.to_date, location.location_id ?? '', location.location_name,
        location.currency, s.orders, s.paid_orders, s.gross_cents, s.discount_cents,
        s.net_sales_cents, s.tax_cents, s.tips_cents, s.service_fee_cents,
        s.delivery_fee_cents, s.refunds_cents, s.revenue_cents, s.avg_ticket_cents,
      ];
    }),
  ];
  const brandHeaders = ['currency', ...SALES_LOCATION_COMPARISON_CSV_COLUMNS.slice(5)];
  const brandRows = [
    ['Brand totals by currency'],
    [],
    brandHeaders,
    ...report.brand_totals.map(({ currency, totals: s }) => [
      currency, s.orders, s.paid_orders, s.gross_cents, s.discount_cents, s.net_sales_cents,
      s.tax_cents, s.tips_cents, s.service_fee_cents, s.delivery_fee_cents, s.refunds_cents,
      s.revenue_cents, s.avg_ticket_cents,
    ]),
  ];
  return { locations: xlsxWorksheet(locationRows), totals: xlsxWorksheet(brandRows) };
}

function streamXlsx(res, filename, sheets) {
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => { if (!res.headersSent) res.status(500); res.end(); });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  archive.pipe(res);
  archive.append(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '</Types>', { name: '[Content_Types].xml' }
  );
  archive.append(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>', { name: '_rels/.rels' }
  );
  archive.append(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Store Comparison" sheetId="1" r:id="rId1"/><sheet name="Brand Totals" sheetId="2" r:id="rId2"/></sheets>' +
      '</workbook>', { name: 'xl/workbook.xml' }
  );
  archive.append(
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '</Relationships>', { name: 'xl/_rels/workbook.xml.rels' }
  );
  archive.append(sheets.locations, { name: 'xl/worksheets/sheet1.xml' });
  archive.append(sheets.totals, { name: 'xl/worksheets/sheet2.xml' });
  archive.finalize();
}

exports.salesLocationComparisonCsv = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const report = await computeLocationComparison(restaurantId, restaurant, req.query);
    const lines = [SALES_LOCATION_COMPARISON_CSV_COLUMNS.join(',')];
    for (const location of report.locations) {
      const s = location.totals;
      lines.push([
        report.from_date,
        report.to_date,
        location.location_id ?? '',
        csvCell(location.location_name),
        location.currency,
        s.orders,
        s.paid_orders,
        s.gross_cents,
        s.discount_cents,
        s.net_sales_cents,
        s.tax_cents,
        s.tips_cents,
        s.service_fee_cents,
        s.delivery_fee_cents,
        s.refunds_cents,
        s.revenue_cents,
        s.avg_ticket_cents,
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sales-location-comparison-${report.from_date}-to-${report.to_date}.csv"`
    );
    res.send(`${lines.join('\n')}\n`);
  } catch (err) {
    next(err);
  }
};

exports.salesLocationComparisonXlsx = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const report = await computeLocationComparison(restaurantId, restaurant, req.query);
    streamXlsx(
      res,
      `sales-location-comparison-${report.from_date}-to-${report.to_date}.xlsx`,
      buildSalesLocationWorkbook(report)
    );
  } catch (err) {
    next(err);
  }
};

exports.salesClose = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    res.json(await computeDailyClose(restaurantId, restaurant, req.query));
  } catch (err) {
    next(err);
  }
};

const SALES_CLOSE_CSV_COLUMNS = [
  'business_date', 'location_id', 'location_name', 'currency', 'orders',
  'paid_orders', 'gross_cents', 'discount_cents', 'net_sales_cents',
  'tax_cents', 'tips_cents', 'service_fee_cents', 'delivery_fee_cents',
  'refunds_cents', 'net_collected_cents', 'avg_ticket_cents',
];

exports.salesCloseCsv = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const close = await computeDailyClose(restaurantId, restaurant, req.query);
    const lines = [SALES_CLOSE_CSV_COLUMNS.join(',')];
    for (const location of close.locations) {
      const s = location.totals;
      lines.push([
        close.business_date,
        location.location_id ?? '',
        csvCell(location.location_name),
        location.currency,
        s.orders,
        s.paid_orders,
        s.gross_cents,
        s.discount_cents,
        s.net_sales_cents,
        s.tax_cents,
        s.tips_cents,
        s.service_fee_cents,
        s.delivery_fee_cents,
        s.refunds_cents,
        s.revenue_cents,
        s.avg_ticket_cents,
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-close-${close.business_date}.csv"`);
    res.send(`${lines.join('\n')}\n`);
  } catch (err) {
    next(err);
  }
};

// Accounting handoff: one order row when no POS tender exists, otherwise one
// row per recorded tender/refund. Amounts remain in minor units and currencies
// are never converted or combined. This is deliberately a journal export,
// not a QuickBooks/Xero integration or a claim that an external ledger posted.
const SALES_JOURNAL_COLUMNS = [
  'business_date', 'order_id', 'location_id', 'location_name', 'currency',
  'order_source', 'fulfillment_type', 'order_status', 'payment_status',
  'subtotal_cents', 'discount_cents', 'tax_cents', 'service_fee_cents',
  'delivery_fee_cents', 'tip_cents', 'order_total_cents', 'payment_id',
  'payment_type', 'payment_status_detail', 'payment_amount_cents',
  'payment_reference', 'payment_created_at',
];

const ACCOUNTING_EXPORT_FORMATS = new Set(['quickbooks', 'xero']);
const ACCOUNTING_ACCOUNT_CODES = Object.freeze({
  SALES: '4000',
  TAX_PAYABLE: '2100',
  SERVICE_FEES: '4100',
  DELIVERY_FEES: '4200',
  TIPS_PAYABLE: '2200',
  PAYMENT_CLEARING: '1000',
});

function accountingMoney(cents) {
  const amount = Number(cents || 0);
  return (Number.isFinite(amount) ? amount / 100 : 0).toFixed(2);
}

function accountingDate(value) {
  return String(value || '').slice(0, 10);
}

function accountingLines(rows) {
  const lines = [];
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.order_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  for (const orderRows of grouped.values()) {
    const row = orderRows[0];
    const base = {
      date: accountingDate(row.business_date),
      reference: `OX-${row.order_id}`,
      description: `Restaurant order ${row.order_id}`,
      currency: row.currency || 'USD',
      location: row.location_name || row.location_id || '',
    };
    const credit = (account, amount, description) => {
      if (Number(amount || 0) === 0) return;
      lines.push({ ...base, account, description: description || base.description, debit: '0.00', credit: accountingMoney(amount) });
    };
    const debit = (account, amount, description) => {
      if (Number(amount || 0) === 0) return;
      lines.push({ ...base, account, description: description || base.description, debit: accountingMoney(amount), credit: '0.00' });
    };
    const netSales = Number(row.subtotal_cents || 0) - Number(row.discount_cents || 0);
    credit(ACCOUNTING_ACCOUNT_CODES.SALES, netSales, `Restaurant sales ${row.order_id}`);
    credit(ACCOUNTING_ACCOUNT_CODES.TAX_PAYABLE, row.tax_cents, `Sales tax ${row.order_id}`);
    credit(ACCOUNTING_ACCOUNT_CODES.SERVICE_FEES, row.service_fee_cents, `Service fees ${row.order_id}`);
    credit(ACCOUNTING_ACCOUNT_CODES.DELIVERY_FEES, row.delivery_fee_cents, `Delivery fees ${row.order_id}`);
    credit(ACCOUNTING_ACCOUNT_CODES.TIPS_PAYABLE, row.tip_cents, `Tips ${row.order_id}`);
    const paymentRows = orderRows.filter((payment) => payment.payment_id != null || Number(payment.payment_amount_cents || 0) !== 0);
    if (paymentRows.length === 0) {
      debit(ACCOUNTING_ACCOUNT_CODES.PAYMENT_CLEARING, row.order_total_cents, `Order total ${row.order_id}`);
    } else {
      for (const payment of paymentRows) {
        const paymentAmount = Number(payment.payment_amount_cents || 0);
        if (paymentAmount !== 0) debit(ACCOUNTING_ACCOUNT_CODES.PAYMENT_CLEARING, paymentAmount, `Tender ${payment.payment_type || 'payment'} ${row.order_id}`);
      }
    }
  }
  return lines;
}

function buildAccountingCsv(format, rows) {
  if (!ACCOUNTING_EXPORT_FORMATS.has(format)) throw new AppError('Unsupported accounting export format', 400, 'unsupported_accounting_export');
  const lines = accountingLines(rows);
  const columns = format === 'quickbooks'
    ? ['Date', 'Transaction Type', 'Document Number', 'Account', 'Description', 'Debit', 'Credit', 'Currency', 'Location']
    : ['Date', 'JournalNumber', 'AccountCode', 'Description', 'Debit', 'Credit', 'Currency', 'Reference', 'Location'];
  const body = lines.map((line) => {
    const values = format === 'quickbooks'
      ? [line.date, 'Journal Entry', line.reference, line.account, line.description, line.debit, line.credit, line.currency, line.location]
      : [line.date, line.reference, line.account, line.description, line.debit, line.credit, line.currency, line.reference, line.location];
    return values.map((value) => csvCell(value)).join(',');
  });
  return `${[columns.join(','), ...body].join('\n')}\n`;
}

async function loadSalesJournalRows(restaurantId, restaurant, reqQuery) {
  const timezone = resolveReportTimezone(restaurant);
  const { fromDate, toDate } = parseSalesRange(reqQuery || {}, timezone);
  const { rows } = await pool.query(
    // F-07: business_date follows the same per-store definition as the
    // sales fact CTE (store timezone + day-start hour).
    `SELECT to_char(((o.created_at AT TIME ZONE COALESCE(NULLIF(l.timezone, ''), $4))
                       - (COALESCE(l.day_start_hour, 0) * INTERVAL '1 hour'))::date, 'YYYY-MM-DD') AS business_date,
            o.id AS order_id, o.location_id, l.name AS location_name,
            COALESCE(NULLIF(o.currency_code, ''), 'USD') AS currency,
            o.order_source, o.fulfillment_type, o.status AS order_status,
            o.payment_status,o.tax_rule_snapshot, o.subtotal_cents, o.discount_cents, o.tax_cents,
            o.service_fee_cents, o.delivery_fee_cents, o.tip_cents,
            o.total_cents AS order_total_cents, p.id AS payment_id,
            p.payment_type, p.status AS payment_status_detail,
            p.amount_cents AS payment_amount_cents, p.reference AS payment_reference,
            p.created_at AS payment_created_at
       FROM food_orders o
       LEFT JOIN restaurant_locations l
         ON l.restaurant_id = o.restaurant_id AND l.id = o.location_id
       LEFT JOIN restaurant_pos_payments p
         ON p.restaurant_id = o.restaurant_id AND p.food_order_id = o.id
        AND p.status IN ('recorded', 'captured', 'refunded')
      WHERE o.restaurant_id = $1
        AND ((o.created_at AT TIME ZONE COALESCE(NULLIF(l.timezone, ''), $4))
               - (COALESCE(l.day_start_hour, 0) * INTERVAL '1 hour'))::date >= $2::date
        AND ((o.created_at AT TIME ZONE COALESCE(NULLIF(l.timezone, ''), $4))
               - (COALESCE(l.day_start_hour, 0) * INTERVAL '1 hour'))::date < ($3::date + 1)
        ${restaurant.locationScope?.mode === 'assigned' ? 'AND o.location_id = ANY($5::bigint[])' : ''}
      ORDER BY o.created_at ASC, o.id ASC, p.created_at ASC NULLS FIRST, p.id ASC`,
    scopedParams([restaurantId, fromDate, toDate, timezone], restaurant.locationScope)
  );
  return { rows, fromDate, toDate };
}

exports.salesJournalExportCsv = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows, fromDate, toDate } = await loadSalesJournalRows(restaurantId, restaurant, req.query);
    const lines = [SALES_JOURNAL_COLUMNS.join(',')];
    for (const row of rows) {
      lines.push(SALES_JOURNAL_COLUMNS.map((column) => csvCell(row[column])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sales-journal-${fromDate}-to-${toDate}.csv"`
    );
    res.send(`${lines.join('\n')}\n`);
  } catch (err) {
    next(err);
  }
};

exports.salesAccountingExportCsv = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const format = String(req.params.provider || '').trim().toLowerCase();
    const { rows, fromDate, toDate } = await loadSalesJournalRows(restaurantId, restaurant, req.query);
    const body = buildAccountingCsv(format, rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-${format}-${fromDate}-to-${toDate}.csv"`);
    res.send(body);
  } catch (err) {
    next(err);
  }
};

exports.salesBiExportNdjson = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows, fromDate, toDate } = await loadSalesJournalRows(restaurantId, restaurant, req.query);
    const records = [
      { type: 'metadata', schema: 'oxsteed.restaurant.sales.v1', from_date: fromDate, to_date: toDate, amount_unit: 'minor', customer_identity: 'excluded' },
      ...rows.map((row) => ({
        type: 'order_tender',
        ...row,
        order_id: Number(row.order_id),
        payment_id: row.payment_id == null ? null : Number(row.payment_id),
        location_id: row.location_id == null ? null : Number(row.location_id),
      })),
    ];
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sales-bi-${fromDate}-to-${toDate}.ndjson"`);
    res.send(`${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  } catch (err) {
    next(err);
  }
};

exports._accountingTest = { accountingLines, buildAccountingCsv, ACCOUNTING_ACCOUNT_CODES, loadSalesJournalRows };

// ── Inventory ────────────────────────────────────────────────────────────────
exports.inventorySummary = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { from, to } = parseRange(req.query);
    const [byType, topWaste, lowStock] = await Promise.all([
      pool.query(
        `SELECT adjustment_type,
                COUNT(*) AS events,
                COALESCE(SUM(ABS(quantity_delta)), 0) AS total_qty
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND created_at BETWEEN $2 AND $3${restaurant.locationScope.mode === 'assigned' ? ' AND location_id = ANY($4::bigint[])' : ''}
          GROUP BY adjustment_type
          ORDER BY events DESC`,
        scopedParams([restaurantId, from, to],restaurant.locationScope)
      ),
      pool.query(
        `SELECT item_name, COUNT(*) AS events,
                COALESCE(SUM(ABS(quantity_delta)), 0) AS wasted_qty
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND adjustment_type = 'waste'
            AND created_at BETWEEN $2 AND $3${restaurant.locationScope.mode === 'assigned' ? ' AND location_id = ANY($4::bigint[])' : ''}
          GROUP BY item_name
          ORDER BY wasted_qty DESC
          LIMIT 10`,
        scopedParams([restaurantId, from, to],restaurant.locationScope)
      ),
      pool.query(
        `SELECT COUNT(*) AS low_count,
                COUNT(*) FILTER (WHERE quantity <= 0) AS out_count
           FROM restaurant_inventory_items
          WHERE restaurant_id = $1${restaurant.locationScope.mode === 'assigned' ? ' AND location_id = ANY($2::bigint[])' : ''}
            AND low_stock_threshold > 0
            AND quantity <= low_stock_threshold`,
        scopedParams([restaurantId],restaurant.locationScope)
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
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { from, to } = parseRange(req.query);
    const [checklists, audits, training] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS runs,
                COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                AVG(CASE WHEN status = 'completed' AND total_tasks > 0
                         THEN completed_tasks::float / total_tasks END) AS avg_completion
           FROM restaurant_checklist_runs
          WHERE restaurant_id = $1 AND started_at BETWEEN $2 AND $3${restaurant.locationScope.mode === 'assigned' ? ' AND location_id = ANY($4::bigint[])' : ''}`,
        scopedParams([restaurantId, from, to],restaurant.locationScope)
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                AVG(CASE WHEN status = 'completed' AND max_score > 0
                         THEN total_score / max_score END) AS avg_score,
                COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
                (SELECT COUNT(*) FROM restaurant_corrective_actions ca
                  JOIN restaurant_audits a ON a.id = ca.audit_id
                 WHERE a.restaurant_id = $1${restaurant.locationScope.mode === 'assigned' ? ' AND a.location_id = ANY($4::bigint[])' : ''} AND ca.status NOT IN ('resolved', 'verified')) AS open_actions
           FROM restaurant_audits
          WHERE restaurant_id = $1 AND started_at BETWEEN $2 AND $3${restaurant.locationScope.mode === 'assigned' ? ' AND location_id = ANY($4::bigint[])' : ''}`,
        scopedParams([restaurantId, from, to],restaurant.locationScope)
      ),
      pool.query(
        `SELECT COUNT(*) AS assigned,
                COUNT(*) FILTER (WHERE a.status = 'completed') AS completed,
                AVG(c.score_pct) FILTER (WHERE c.id IS NOT NULL) AS avg_score,
                COUNT(*) FILTER (WHERE c.passed) AS passed
           FROM restaurant_training_assignments a
           LEFT JOIN restaurant_training_completions c ON c.assignment_id = a.id
          WHERE a.restaurant_id = $1 AND a.created_at BETWEEN $2 AND $3${restaurant.locationScope.mode === 'assigned' ? ` AND EXISTS (SELECT 1 FROM restaurant_location_memberships lm JOIN business_members bm ON bm.id=lm.membership_id WHERE lm.restaurant_id=a.restaurant_id AND bm.member_id=a.user_id AND bm.status='active' AND lm.status='active' AND lm.location_id=ANY($4::bigint[]))` : ''}`,
        scopedParams([restaurantId, from, to],restaurant.locationScope)
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
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { from, to } = parseRange90(req.query);
    const [repeat, topItems, retention] = await Promise.all([
      restaurantAnalytics.getRepeatOrderRate(pool, restaurantId, { from, to, locationIds:restaurant.locationScope.mode==='assigned'?restaurant.locationScope.location_ids:null }),
      restaurantAnalytics.getTopItemsByRevenue(pool, restaurantId, { from, to, limit: 10, locationIds:restaurant.locationScope.mode==='assigned'?restaurant.locationScope.location_ids:null }),
      restaurantAnalytics.getRetentionCohorts(pool, restaurantId, { from, to, locationIds:restaurant.locationScope.mode==='assigned'?restaurant.locationScope.location_ids:null }),
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
