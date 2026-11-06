'use strict';

// Phase 6 (gap 10): plate cost / margin per dish, computed on read from the
// live recipe mappings and supplier costs so it can never go stale. The
// formula mirrors the theoretical-cost math in foodCostSummary:
//   cost = SUM(required_qty x conversion_factor x 100/yield_percent x unit_cost)
// unit_cost is stored in major units of the restaurant's currency, so the
// cost is converted to integer minor units (cents x currency precision is
// NOT assumed: every figure carries its currency_code and the margin is
// only computed when the dish price and the cost share a currency).
// Currency precision: minor-unit conversion uses the currency's exponent
// (JPY 0, BHD 3, most 2) instead of a hardcoded 100.

const { AppError } = require('../middleware/errorHandler');

// Minor units per major unit, by ISO 4217 currency. Only the currencies
// with a non-2 exponent need entries; everything else defaults to 100.
const MINOR_UNITS = { JPY: 1, KRW: 1, VND: 1, BHD: 1000, KWD: 1000, OMR: 1000, TND: 1000 };

function minorUnitsPerMajor(currencyCode) {
  return MINOR_UNITS[String(currencyCode || '').toUpperCase()] || 100;
}

function costLine(row) {
  const required = Number(row.required_quantity) || 0;
  const conversion = Number(row.conversion_factor) || 1;
  const yieldPercent = Number(row.yield_percent) || 100;
  const unitCost = Number(row.unit_cost) || 0;
  const lineCostMajor = required * conversion * (100 / yieldPercent) * unitCost;
  return {
    inventory_item_id: Number(row.inventory_item_id),
    inventory_item_name: row.inventory_item_name,
    required_quantity: required,
    required_unit: row.required_unit || row.inventory_unit || null,
    conversion_factor: conversion,
    yield_percent: yieldPercent,
    unit_cost: unitCost,
    line_cost_major: lineCostMajor,
  };
}

function buildFoodCost({ item, restaurantCurrency, components }) {
  const currencyCode = item.currency_code || restaurantCurrency || 'USD';
  const costCurrency = restaurantCurrency || currencyCode;
  const minorUnits = minorUnitsPerMajor(costCurrency);
  const costMajor = components.reduce((sum, line) => sum + line.line_cost_major, 0);
  const costCents = Math.round(costMajor * minorUnits);
  const currencyMismatch = currencyCode !== costCurrency;
  const priceCents = Number(item.price_cents) || 0;
  // No recipe means no cost basis: report the margin as unknown, never as
  // a 100% margin on a zero cost, or an unmapped dish looks free to make.
  const noCostBasis = components.length === 0;
  const marginCents = currencyMismatch || noCostBasis ? null : priceCents - costCents;
  const marginPercent = currencyMismatch || noCostBasis || priceCents <= 0
    ? null
    : Math.round(((priceCents - costCents) / priceCents) * 10000) / 100;
  return {
    menu_item_id: Number(item.id),
    name: item.name,
    price_cents: priceCents,
    currency_code: currencyCode,
    cost_cents: costCents,
    cost_currency_code: costCurrency,
    cost_major: Math.round(costMajor * 10000) / 10000,
    margin_cents: marginCents,
    margin_percent: marginPercent,
    currency_mismatch: currencyMismatch,
    has_mappings: components.length > 0,
    components: components.map((line) => ({
      ...line,
      line_cost_cents: Math.round(line.line_cost_major * minorUnits),
    })),
    computed_at: new Date().toISOString(),
  };
}

async function loadComponents(db, restaurantId, menuItemIds, locationIds = null) {
  const params = [restaurantId, menuItemIds];
  let locationFilter = '';
  if (locationIds) {
    params.push(locationIds);
    locationFilter = ` AND rii.location_id = ANY($${params.length}::bigint[])`;
  }
  const { rows } = await db.query(
    `SELECT rim.menu_item_id,
            rim.inventory_item_id,
            rii.name AS inventory_item_name,
            rii.unit AS inventory_unit,
            rim.required_quantity,
            rim.required_unit,
            rim.conversion_factor,
            rim.yield_percent,
            rii.unit_cost
       FROM restaurant_inventory_item_mappings rim
       JOIN restaurant_inventory_items rii
         ON rii.id = rim.inventory_item_id
        AND rii.restaurant_id = rim.restaurant_id
        AND rii.is_active = TRUE${locationFilter}
      WHERE rim.restaurant_id = $1
        AND rim.menu_item_id = ANY($2::bigint[])
      ORDER BY rim.menu_item_id, rii.name`,
    params
  );
  const byMenuItem = new Map();
  for (const row of rows) {
    const list = byMenuItem.get(Number(row.menu_item_id)) || [];
    list.push(costLine(row));
    byMenuItem.set(Number(row.menu_item_id), list);
  }
  return byMenuItem;
}

async function computeMenuItemFoodCost(db, { restaurantId, menuItemId, locationIds = null }) {
  const { rows: [restaurant] } = await db.query(
    'SELECT currency_code FROM food_restaurants WHERE id = $1',
    [restaurantId]
  );
  if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows: [item] } = await db.query(
    `SELECT id, name, price_cents, currency_code
       FROM food_menu_items
      WHERE id = $1 AND restaurant_id = $2`,
    [menuItemId, restaurantId]
  );
  if (!item) throw new AppError('Menu item not found', 404, 'menu_item_not_found');
  const components = (await loadComponents(db, restaurantId, [menuItemId], locationIds))
    .get(Number(menuItemId)) || [];
  return buildFoodCost({ item, restaurantCurrency: restaurant.currency_code, components });
}

async function listMenuFoodCosts(db, { restaurantId, locationIds = null, sort = 'margin_asc' }) {
  const { rows: [restaurant] } = await db.query(
    'SELECT currency_code FROM food_restaurants WHERE id = $1',
    [restaurantId]
  );
  if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows: items } = await db.query(
    `SELECT id, name, price_cents, currency_code
       FROM food_menu_items
      WHERE restaurant_id = $1
        AND publication_status = 'published'
        AND archived_at IS NULL
      ORDER BY sort_order ASC, id ASC`,
    [restaurantId]
  );
  const byMenuItem = items.length
    ? await loadComponents(db, restaurantId, items.map((item) => Number(item.id)), locationIds)
    : new Map();
  const costs = items.map((item) => buildFoodCost({
    item,
    restaurantCurrency: restaurant.currency_code,
    components: byMenuItem.get(Number(item.id)) || [],
  }));
  const byMargin = (a, b) => {
    if (a.margin_percent == null && b.margin_percent == null) return 0;
    if (a.margin_percent == null) return 1;
    if (b.margin_percent == null) return -1;
    return a.margin_percent - b.margin_percent;
  };
  if (sort === 'margin_desc') costs.sort((a, b) => byMargin(b, a));
  else if (sort === 'margin_asc') costs.sort(byMargin);
  else if (sort === 'name') costs.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return costs;
}

module.exports = {
  computeMenuItemFoodCost,
  listMenuFoodCosts,
  minorUnitsPerMajor,
};
