'use strict';
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { resolveLocationRow, deviceLocationId } = require('../services/restaurantLocationService');
const { resolveActingStaff } = require('../services/restaurantStaffIdentityService');
const { getLocationRole } = require('../services/restaurantLocationAccessService');
const menu = require('../services/restaurantStoreMenuService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const sockets = require('../services/socketService');

async function access(req, codes) {
  const restaurantId = menu.locationId(req.params.restaurantId);
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  let allowed = await permissions.hasRestaurantPermission(restaurant, req.user.id, codes);
  const locationId = menu.locationId(req.params.locationId);
  // Legacy availability URLs omit a store and retain primary-store
  // resolution inside resolveLocationRow below. Explicit store URLs are
  // checked here before any write.
  const locationRole = locationId
    ? await getLocationRole(restaurant, req.user.id, locationId)
    : restaurant.effective_role;
  const roleOptions = locationRole && locationRole !== restaurant.effective_role ? { roleOverride: locationRole } : undefined;
  if (roleOptions) allowed = await permissions.hasRestaurantPermission(restaurant, req.user.id, codes, roleOptions);
  if (!allowed) throw new AppError('Permission denied', 403, 'forbidden');
  return restaurant;
}

exports.list = async (req, res, next) => {
  try {
    const restaurant = await access(req, ['menu.manage', 'menu.view', 'pos.use', 'kitchen.update']);
    const store = await resolveLocationRow(pool, { restaurantId: restaurant.id, requestedLocationId: menu.locationId(req.params.locationId) });
    if (!store) throw new AppError('Store not found', 404, 'location_not_found');
    const { rows } = await pool.query(`SELECT fmi.id, fmi.name, fmi.price_cents, fmi.currency_code,
      fmi.is_available, fmi.publication_status, ${menu.overrideSql('fmi', '$2')}
      FROM food_menu_items fmi WHERE fmi.restaurant_id=$1 AND fmi.archived_at IS NULL
      ORDER BY fmi.sort_order, fmi.id LIMIT 1001`, [restaurant.id, store.id]);
    if (rows.length > 1000) throw new AppError('Menu requires pagination', 409, 'store_menu_too_large');
    res.json({ location: store, items: rows.map((item) => ({ ...menu.applyOverride(item), brand_price_cents: item.price_cents })) });
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    // A cashier may 86; changing prices requires the menu-management grant.
    menu.validatePatch(req.body, { is_available: false });
    const restaurant = await access(req, Object.hasOwn(req.body, 'priceCents') ? ['menu.manage'] : ['menu.manage', 'pos.use', 'kitchen.update']);
    const result = await withTransaction(pool, async (client) => {
      const actingStaff = await resolveActingStaff(req, restaurant.id);
      const deviceStore = actingStaff?.deviceId ? await deviceLocationId(client, { restaurantId: restaurant.id, deviceId: actingStaff.deviceId }) : null;
      const store = await resolveLocationRow(client, { restaurantId: restaurant.id, requestedLocationId: menu.locationId(req.params.locationId), deviceLocationId: deviceStore });
      if (!store) throw new AppError('Store not found', 404, 'location_not_found');
      const storeRole = await getLocationRole(restaurant, req.user.id, store.id, client);
      if (storeRole && storeRole !== restaurant.effective_role
        && !(await permissions.hasRestaurantPermission(restaurant, req.user.id, codes, { roleOverride: storeRole }))) {
        throw new AppError('Permission denied', 403, 'forbidden');
      }
      const { rows: [item] } = await client.query('SELECT id, name, price_cents, currency_code, is_available FROM food_menu_items WHERE restaurant_id=$1 AND id=$2 FOR UPDATE', [restaurant.id, menu.locationId(req.params.itemId)]);
      if (!item) throw new AppError('Menu item not found', 404, 'menu_item_not_found');
      const { rows: [before] } = await client.query('SELECT * FROM restaurant_store_menu_overrides WHERE restaurant_id=$1 AND location_id=$2 AND menu_item_id=$3', [restaurant.id, store.id, item.id]);
      const patch = menu.validatePatch(req.body, before);
      const { rows: [after] } = await client.query(`INSERT INTO restaurant_store_menu_overrides
        (restaurant_id,location_id,menu_item_id,price_cents,is_available,available_again_at,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(restaurant_id,location_id,menu_item_id)
        DO UPDATE SET price_cents=EXCLUDED.price_cents,is_available=EXCLUDED.is_available,
          available_again_at=EXCLUDED.available_again_at,updated_by=EXCLUDED.updated_by,updated_at=NOW() RETURNING *`,
      [restaurant.id, store.id, item.id, patch.price_cents, patch.is_available, patch.available_again_at, req.user.id]);
      await logBusinessAction(req, { business_id: restaurant.business_id, actor_role: restaurant.effective_role,
        action: 'restaurant.store_menu.updated', target_type: 'menu_item', target_id: item.id,
        before_state: before || {}, after_state: after, metadata: { location_id: store.id, ...(req.body.reason ? { reason: req.body.reason.trim() } : {}) }, client, throwOnError: true });
      const effective = menu.applyOverride({ ...item, store_override: after });
      return { override: after, item: effective, event: { menu_item_id: item.id, location_id: store.id,
        previous_available: menu.applyOverride({ ...item, store_override: before }).is_available,
        next_available: effective.is_available } };
    }, 'restaurant_store_menu_update');
    try { sockets.broadcastToBusinessInbox(restaurant.business_id, 'food:menu:availability', result); } catch { /* polling recovers */ }
    res.json(result);
  } catch (error) { next(error); }
};
