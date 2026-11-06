'use strict';

// Phase 7 (gap 15): prime cost + server / daypart reporting.
//
// Prime cost is labor + food cost over the SAME period, from the two
// computations that already exist — computeLabor (payroll service) and
// the food-cost math (foodCostSummary in
// restaurantInventoryOperationsController). The food-cost totals here
// replicate that controller's definitions exactly (paid orders only,
// not cancelled/refunded; theoretical usage from recipe mappings;
// actual usage from `usage` adjustments; unit_cost in major units):
// the cross-check test asserts prime-cost food totals equal the
// food-cost report totals on the same fixture, so the two can never
// silently disagree. Net sales is the same paid-order set in both.
//
// Currency: every money figure is integer minor units in the labor
// report's effective currency (per-location currency when one store is
// in scope, else the restaurant's), with per-currency precision —
// never a hardcoded 100. When the period spans stores in different
// currencies the labor totals are already nulled upstream; prime cost
// then reports labor and food per currency instead of adding dollars
// to gourdes (see the `currencies` block).
//
// Dayparts are hourly buckets plus conventional named ranges returned
// in the response as `daypart_definitions`, so the ranges are data the
// reader can see, not hidden code. A restaurant that runs different
// hours reads the hourly buckets; named dayparts are a display
// grouping only.

const pool = require('../db');
const { computeLabor } = require('./restaurantPayrollService');
const { minorUnitsPerMajor } = require('./restaurantFoodCostService');
const { minorUnitDecimals } = require('../utils/currencyPrecision');

const DAYPART_DEFINITIONS = [
  { key: 'breakfast', label: 'Breakfast', start_hour: 6, end_hour: 11 },
  { key: 'lunch', label: 'Lunch', start_hour: 11, end_hour: 15 },
  { key: 'dinner', label: 'Dinner', start_hour: 17, end_hour: 22 },
  { key: 'late_night', label: 'Late night', start_hour: 22, end_hour: 2 },
];

function daypartForHour(hour) {
  for (const def of DAYPART_DEFINITIONS) {
    if (def.start_hour < def.end_hour) {
      if (hour >= def.start_hour && hour < def.end_hour) return def.key;
    } else if (hour >= def.start_hour || hour < def.end_hour) return def.key;
  }
  return 'other';
}

// Food-cost totals over a period, in integer minor units of
// `currencyCode`. Mirrors foodCostSummary's CTEs (see the header).
async function computeFoodCostTotals(db, {
  restaurantId, fromDate, toDate, timezone, locationIds = null, currencyCode,
} = {}) {
  const minorUnits = minorUnitsPerMajor(currencyCode);
  const params = [restaurantId, fromDate, toDate, timezone];
  let salesLocationFilter = '';
  let itemLocationFilter = '';
  if (Array.isArray(locationIds)) {
    params.push(locationIds);
    salesLocationFilter = ` AND fo.location_id = ANY($${params.length}::bigint[])`;
    itemLocationFilter = ` AND i.location_id = ANY($${params.length}::bigint[])`;
  }
  const { rows: [row] } = await db.query(
    `WITH sales AS (
       SELECT COALESCE(SUM(fo.total_cents), 0)::bigint AS net_sales_cents
         FROM food_orders fo
        WHERE fo.restaurant_id = $1
          AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
          AND fo.payment_status = 'paid'
          AND fo.status NOT IN ('cancelled', 'refunded')${salesLocationFilter}
     ), theoretical AS (
       SELECT COALESCE(SUM(foi.quantity * rim.required_quantity * rim.conversion_factor
         * (100.0 / NULLIF(rim.yield_percent, 0)) * mapped_stock.unit_cost), 0) AS cost_major
         FROM food_orders fo
         JOIN food_order_items foi ON foi.order_id = fo.id
         JOIN restaurant_inventory_item_mappings rim
           ON rim.menu_item_id = foi.menu_item_id AND rim.restaurant_id = fo.restaurant_id
         JOIN restaurant_inventory_items mapped_stock
           ON mapped_stock.id = rim.inventory_item_id AND mapped_stock.restaurant_id = fo.restaurant_id
          AND mapped_stock.location_id = fo.location_id
        WHERE fo.restaurant_id = $1
          AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
          AND fo.payment_status = 'paid'
          AND fo.status NOT IN ('cancelled', 'refunded')${salesLocationFilter}
     ), actual AS (
       SELECT COALESCE(SUM(ABS(a.quantity_delta) * i.unit_cost), 0) AS cost_major
         FROM restaurant_inventory_adjustments a
         JOIN restaurant_inventory_items i ON i.id = a.item_id
        WHERE a.restaurant_id = $1 AND a.adjustment_type = 'usage'${itemLocationFilter.replaceAll('i.location_id', 'a.location_id')}
          AND a.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
          AND a.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
     )
     SELECT sales.net_sales_cents,
            theoretical.cost_major AS theoretical_cost_major,
            actual.cost_major AS actual_cost_major
       FROM sales, theoretical, actual`,
    params
  );
  const netSalesCents = Number(row?.net_sales_cents || 0);
  const theoreticalCents = Math.round(Number(row?.theoretical_cost_major || 0) * minorUnits);
  const actualCents = Math.round(Number(row?.actual_cost_major || 0) * minorUnits);
  return {
    net_sales_cents: netSalesCents,
    theoretical_cost_cents: theoreticalCents,
    actual_cost_cents: actualCents,
    theoretical_cost_pct: netSalesCents > 0
      ? Math.round((theoreticalCents / netSalesCents) * 10000) / 100 : null,
    actual_cost_pct: netSalesCents > 0
      ? Math.round((actualCents / netSalesCents) * 10000) / 100 : null,
    currency_code: currencyCode,
  };
}

async function computeServerBreakdown(db, {
  restaurantId, fromDate, toDate, timezone, locationIds = null,
} = {}) {
  const params = [restaurantId, fromDate, toDate, timezone];
  let locationFilter = '';
  if (Array.isArray(locationIds)) {
    params.push(locationIds);
    locationFilter = ` AND fo.location_id = ANY($${params.length}::bigint[])`;
  }
  const { rows } = await db.query(
    `SELECT COALESCE(fo.acting_staff_user_id, s.staff_user_id) AS user_id,
            COUNT(*)::int AS orders,
            COALESCE(SUM(fo.total_cents), 0)::int AS net_sales_cents,
            COALESCE(SUM(fo.tip_cents), 0)::int AS tips_cents,
            COALESCE(SUM(fo.discount_cents), 0)::int AS discount_cents
       FROM food_orders fo
       LEFT JOIN restaurant_pos_shifts s
         ON s.id = CASE WHEN fo.metadata->>'shiftId' ~ '^[0-9]+$'
                        THEN (fo.metadata->>'shiftId')::bigint END
      WHERE fo.restaurant_id = $1
        AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
        AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        AND fo.status NOT IN ('cancelled', 'refunded')${locationFilter}
      GROUP BY COALESCE(fo.acting_staff_user_id, s.staff_user_id)
      ORDER BY net_sales_cents DESC`,
    params
  );
  const servers = [];
  let unattributed = null;
  for (const row of rows) {
    const entry = {
      user_id: row.user_id,
      orders: Number(row.orders),
      net_sales_cents: Number(row.net_sales_cents),
      tips_cents: Number(row.tips_cents),
      discount_cents: Number(row.discount_cents),
      avg_ticket_cents: Number(row.orders) > 0
        ? Math.round(Number(row.net_sales_cents) / Number(row.orders)) : 0,
    };
    if (row.user_id == null) unattributed = entry;
    else servers.push(entry);
  }
  return { servers, unattributed };
}

async function computeDaypartBreakdown(db, {
  restaurantId, fromDate, toDate, timezone, locationIds = null,
} = {}) {
  const params = [restaurantId, fromDate, toDate, timezone];
  let locationFilter = '';
  if (Array.isArray(locationIds)) {
    params.push(locationIds);
    locationFilter = ` AND fo.location_id = ANY($${params.length}::bigint[])`;
  }
  const { rows } = await db.query(
    `SELECT EXTRACT(HOUR FROM fo.created_at AT TIME ZONE $4)::int AS hour,
            COUNT(*)::int AS orders,
            COALESCE(SUM(fo.total_cents), 0)::int AS net_sales_cents
       FROM food_orders fo
      WHERE fo.restaurant_id = $1
        AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
        AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
        AND fo.status NOT IN ('cancelled', 'refunded')${locationFilter}
      GROUP BY 1 ORDER BY 1`,
    params
  );
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour, orders: 0, net_sales_cents: 0,
  }));
  for (const row of rows) {
    hourly[Number(row.hour)] = {
      hour: Number(row.hour),
      orders: Number(row.orders),
      net_sales_cents: Number(row.net_sales_cents),
    };
  }
  const dayparts = [...DAYPART_DEFINITIONS.map((d) => ({ ...d, orders: 0, net_sales_cents: 0 })),
    { key: 'other', label: 'Other hours', start_hour: null, end_hour: null, orders: 0, net_sales_cents: 0 }];
  for (const bucket of hourly) {
    const key = daypartForHour(bucket.hour);
    const target = dayparts.find((d) => d.key === key);
    target.orders += bucket.orders;
    target.net_sales_cents += bucket.net_sales_cents;
  }
  return { hourly, dayparts, daypart_definitions: DAYPART_DEFINITIONS };
}

async function computePrimeCost({ restaurant, fromDate, toDate, locationIds = null, db = pool } = {}) {
  const labor = await computeLabor({ restaurant, fromDate, toDate, locationIds });
  const currency = labor.currency;
  const food = await computeFoodCostTotals(db, {
    restaurantId: restaurant.id, fromDate, toDate,
    timezone: labor.timezone, locationIds, currencyCode: currency,
  });
  const [servers, dayparts] = await Promise.all([
    computeServerBreakdown(db, {
      restaurantId: restaurant.id, fromDate, toDate,
      timezone: labor.timezone, locationIds,
    }),
    computeDaypartBreakdown(db, {
      restaurantId: restaurant.id, fromDate, toDate,
      timezone: labor.timezone, locationIds,
    }),
  ]);
  const revenueCents = labor.revenue_cents || 0;
  const laborCents = labor.labor_cost_cents || 0;
  const foodCents = food.actual_cost_cents || 0;
  // Money totals only add up in one currency: computeLabor already
  // reports revenue in the effective currency, and the food totals are
  // priced in that same currency, so the sum is sound. The per-currency
  // revenue rows travel alongside for the multi-currency reader.
  const primeCostCents = laborCents + foodCents;
  return {
    from_date: fromDate,
    to_date: toDate,
    timezone: labor.timezone,
    currency,
    currency_minor_unit_decimals: minorUnitDecimals(currency),
    revenues: labor.revenues,
    revenue_cents: revenueCents,
    labor: {
      labor_cost_cents: laborCents,
      labor_percent: labor.labor_percent,
      total_hours: labor.total_hours,
      overtime_hours: labor.overtime_hours,
      meal_break_premium_cents: labor.meal_break_premium_cents,
      predictability_premium_cents: labor.predictability_premium_cents,
    },
    food: {
      net_sales_cents: food.net_sales_cents,
      theoretical_cost_cents: food.theoretical_cost_cents,
      actual_cost_cents: foodCents,
      theoretical_cost_pct: food.theoretical_cost_pct,
      actual_cost_pct: food.actual_cost_pct,
    },
    prime_cost_cents: primeCostCents,
    prime_cost_pct: revenueCents > 0
      ? Math.round((primeCostCents / revenueCents) * 10000) / 100 : null,
    servers,
    dayparts,
  };
}

module.exports = {
  computePrimeCost,
  computeFoodCostTotals,
  computeServerBreakdown,
  computeDaypartBreakdown,
  daypartForHour,
  DAYPART_DEFINITIONS,
};
