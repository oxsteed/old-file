'use strict';

const { AppError } = require('../middleware/errorHandler');

function locationId(value) {
  if (value === undefined || value === null || value === '') return null;
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new AppError('Invalid store', 400, 'invalid_location');
  }
  return Number(value);
}

// These are code-owned SQL fragments, never caller-provided identifiers.
function overrideSql(alias, locationParameter) {
  if (!['fmi'].includes(alias) || !/^\$[1-9]\d*$/.test(locationParameter)) throw new Error('invalid_store_menu_sql');
  return `COALESCE((SELECT jsonb_build_object('price_cents', sm.price_cents,
    'is_available', sm.is_available, 'available_again_at', sm.available_again_at,
    'inventory_available', sm.inventory_available,
    'inventory_availability_state', sm.inventory_availability_state)
    FROM restaurant_store_menu_overrides sm
    WHERE sm.restaurant_id=${alias}.restaurant_id AND sm.menu_item_id=${alias}.id
      AND sm.location_id=${locationParameter}::bigint), '{}'::jsonb) AS store_override`;
}

// Expiry is evaluated on reads so a worker outage cannot leave an item
// permanently sold out. Inventory/brand unavailability always wins.
function applyOverride(item, now = new Date()) {
  const override = item.store_override || {};
  const expired = override.available_again_at && new Date(override.available_again_at).getTime() <= now.getTime();
  const inventoryAvailable = override.inventory_available ?? (item.inventory_available !== false);
  const manualAvailable = item.manual_available ?? item.is_available !== false;
  return {
    ...item,
    price_cents: override.price_cents ?? item.price_cents,
    inventory_available: inventoryAvailable,
    inventory_availability_state: override.inventory_availability_state
      ?? item.inventory_availability_state
      ?? (inventoryAvailable ? 'available' : 'unavailable'),
    is_available: manualAvailable && inventoryAvailable
      && (expired || override.is_available !== false),
  };
}

function validatePatch(body, current = {}, now = new Date()) {
  const fields = ['priceCents', 'isAvailable', 'availableAgainAt', 'reason'];
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length
    || !['priceCents', 'isAvailable', 'availableAgainAt'].some((key) => Object.hasOwn(body, key))
    || Object.keys(body).some((key) => !fields.includes(key))) {
    throw new AppError('Invalid store menu change', 400, 'invalid_store_menu_change');
  }
  if (Object.hasOwn(body, 'reason') && (typeof body.reason !== 'string' || body.reason.length > 1000)) throw new AppError('Invalid reason', 400, 'invalid_store_menu_reason');
  const next = { price_cents: current.price_cents ?? null, is_available: current.is_available ?? null,
    available_again_at: current.available_again_at ?? null };
  if (Object.hasOwn(body, 'priceCents')) {
    if (body.priceCents !== null && (!Number.isSafeInteger(body.priceCents) || body.priceCents < 0 || body.priceCents > 2147483647)) {
      throw new AppError('Invalid store price', 400, 'invalid_store_price');
    }
    next.price_cents = body.priceCents;
  }
  if (Object.hasOwn(body, 'isAvailable')) {
    if (body.isAvailable !== null && typeof body.isAvailable !== 'boolean') throw new AppError('Invalid availability', 400, 'invalid_store_availability');
    next.is_available = body.isAvailable;
    if (body.isAvailable !== false) next.available_again_at = null;
  }
  if (Object.hasOwn(body, 'availableAgainAt')) {
    if (body.availableAgainAt === null) next.available_again_at = null;
    else {
      const stamp = typeof body.availableAgainAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(body.availableAgainAt)
        ? Date.parse(body.availableAgainAt) : NaN;
      if (!Number.isFinite(stamp) || stamp <= now.getTime() || stamp > now.getTime() + 30 * 86400000) {
        throw new AppError('Invalid return-to-stock time', 400, 'invalid_store_restock_time');
      }
      next.available_again_at = new Date(stamp).toISOString();
    }
  }
  if (next.available_again_at && next.is_available !== false) throw new AppError('Return time requires a sold-out item', 400, 'invalid_store_restock_time');
  return next;
}

// A paired terminal or open drawer pins the store. An explicit browser
// selection may agree, but must never cause pricing at one store and stamping
// at another.
function pinnedLocation(requested, pinned) {
  const selected = locationId(requested);
  const fixed = locationId(pinned);
  if (selected && fixed && selected !== fixed) throw new AppError('Store differs from the active terminal or drawer', 409, 'location_conflict');
  return fixed ?? selected;
}

function locationSql(parameter = '$2') {
  if (!/^\$[1-9]\d*$/.test(parameter)) throw new Error('invalid_store_location_sql');
  return `(SELECT to_jsonb(sl) FROM restaurant_locations sl WHERE sl.restaurant_id=fr.id
    AND (${parameter}::bigint IS NULL OR sl.id=${parameter})
    ORDER BY sl.is_primary DESC, sl.id LIMIT 1) AS store_location`;
}
function assertLocation(store, requestedId) {
  if (requestedId && !store) throw new AppError('Store not found', 404, 'location_not_found');
  if (store && store.status !== 'active') throw new AppError('Store is not accepting orders', 409, 'location_unavailable');
}
function useStoreDetails(restaurant, store) {
  if (!store) return;
  for (const field of ['address_street', 'address_city', 'address_state', 'address_zip', 'address_country', 'latitude', 'longitude', 'timezone', 'tax_rate_bps', 'service_fee_bps', 'tax_inclusive', 'tax_jurisdiction', 'service_fee_taxable', 'delivery_fee_taxable', 'online_order_pacing_max_per_15_min', 'in_store_order_pacing_max_per_15_min', 'prep_time_extension_min', 'prep_time_auto_extend_max_min', 'prep_time_auto_extend_threshold_orders', 'prep_time_auto_extend_per_order_min']) {
    if (store[field] != null) restaurant[field] = store[field];
  }
  if (store.operating_hours && Object.keys(store.operating_hours).length) restaurant.operating_hours = store.operating_hours;
  if (store.status !== 'active') restaurant.is_accepting_orders_now = false;
}
module.exports = { locationId, overrideSql, applyOverride, validatePatch, locationSql, assertLocation, useStoreDetails, pinnedLocation };
