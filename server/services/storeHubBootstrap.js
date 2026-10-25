'use strict';
const AppError = require('../utils/appError');
const menu = require('./restaurantStoreMenuService');
const tax = require('./restaurantOrderTaxService');

async function bootstrap(client, { restaurantId, locationId }) {
  const { rows: [restaurant] } = await client.query('SELECT * FROM food_restaurants WHERE id=$1', [restaurantId]);
  const { rows: [location] } = await client.query('SELECT * FROM restaurant_locations WHERE restaurant_id=$1 AND id=$2', [restaurantId, locationId]);
  if (!restaurant || !location || restaurant.status !== 'active' || location.status !== 'active')
    throw new AppError('Store is unavailable', 409, 'store_unavailable');
  if(Number(location.service_fee_bps ?? restaurant.service_fee_bps)>0)
    throw new AppError('This store requires online fee calculation',409,'hub_service_fee_unsupported');
  const { rows: items } = await client.query(
    `SELECT fmi.id,fmi.name,fmi.price_cents,fmi.currency_code,fmi.is_available,fmi.manual_available,
       fmi.inventory_available,fmi.tax_rate_bps,fmi.tax_exempt,fmi.tax_category,
       fmi.availability_schedule,${menu.overrideSql('fmi', '$2')},
       EXISTS(SELECT 1 FROM food_modifier_groups mg WHERE mg.menu_item_id=fmi.id AND (mg.is_required=TRUE OR mg.min_select>0)) AS requires_modifiers
     FROM food_menu_items fmi WHERE fmi.restaurant_id=$1 AND fmi.publication_status='published' AND fmi.archived_at IS NULL`,
    [restaurantId, locationId],
  );
  const { rows: shifts } = await client.query(
    `SELECT id,staff_label FROM restaurant_pos_shifts WHERE restaurant_id=$1 AND location_id=$2 AND status='open'`,
    [restaurantId, locationId],
  );
  return {
    restaurantId: Number(restaurantId), locationId: Number(locationId),
    currencyCode: restaurant.currency_code, timezone: location.timezone || restaurant.timezone,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    taxPolicy: await tax.resolveStoreTaxPolicyForOrder(client, { restaurantId, locationRow: location, restaurantRow: restaurant }),
    // Complex modifier/daypart choices must use the online POS until their
    // complete pricing contract is cached. Never silently omit required choices.
    items: items.map(i => menu.applyOverride(i)).filter(i => i.is_available && !i.requires_modifiers
      && (!i.availability_schedule || Object.keys(i.availability_schedule).length === 0)),
    shifts,
  };
}
module.exports = { bootstrap };
