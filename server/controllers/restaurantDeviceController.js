'use strict';

// F-26 convergence: the unified device fleet.
// GET /api/restaurants/:restaurantId/devices/registry reads the canonical
// restaurant_devices registry (role, store, capabilities). The legacy
// pairing flows keep working behind adapters; this is the surface new code
// (hubs, HQ console, printer claiming) builds on.

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const devices = require('../services/unifiedDeviceService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

async function loadRestaurant(req, permission) {
  const restaurantId = parsePositiveInt(req.params.restaurantId);
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, [permission]))) {
    throw new AppError('You do not have permission to view devices', 403, 'forbidden');
  }
  return restaurant;
}

exports.listFleet = async (req, res, next) => {
  try {
    const restaurant = await loadRestaurant(req, 'settings.view');
    const scope = await getLocationScope(restaurant, req.user.id);
    const requestedLocation = parsePositiveInt(req.query?.locationId ?? req.query?.location_id);
    if (requestedLocation && scope.mode === 'assigned' && !scope.location_ids.includes(requestedLocation)) {
      throw new AppError('You do not have access to this store', 403, 'location_scope_forbidden');
    }
    const locationId = scope.mode === 'assigned' && !requestedLocation
      ? null
      : requestedLocation;
    let rows = await devices.listDevices(pool, restaurant.id, {
      locationId,
      role: req.query?.role || null,
      status: req.query?.status || null,
    });
    if (scope.mode === 'assigned') {
      rows = rows.filter((d) => scope.location_ids.includes(d.locationId));
    }
    res.json({ devices: rows });
  } catch (error) { next(error); }
};

exports.setDeviceStatus = async (req, res, next) => {
  try {
    const restaurant = await loadRestaurant(req, 'settings.manage');
    const deviceId = parsePositiveInt(req.params.deviceId);
    if (!deviceId) throw new AppError('Device not found', 404, 'device_not_found');
    const status = String(req.body?.status || '').trim();
    const scope = await getLocationScope(restaurant, req.user.id);
    const updated = await withTransaction(pool, async (client) => {
      const row = await devices.setDeviceStatus(client, {
        restaurantId: restaurant.id, deviceId, status, actorUserId: req.user.id,
        allowedLocationIds: scope.mode === 'assigned' ? scope.location_ids : null,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: status === 'disabled' ? 'restaurant.device.disabled' : 'restaurant.device.enabled',
        target_type: 'restaurant_device',
        target_id: row.id,
        client,
        throwOnError: true,
      });
      return row;
    }, 'restaurant_device_status');
    res.json({ device: updated });
  } catch (error) { next(error); }
};
