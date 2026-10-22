'use strict';

// F-08: in-store hub controllers.
// Staff endpoints (register/list/replay/reconciliation) require the canonical
// restaurant gate plus pos.manage for the money-moving replay. Device
// endpoints (heartbeat/pull/queue) authenticate with the hub's designated
// device credential through the shared restaurant_app_devices token model.

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const hub = require('../services/storeHubService');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const appFlow = require('./restaurantAppFlowController');

function restaurantIdParam(req) {
  const id = Number.parseInt(req.params.restaurantId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return id;
}

function hubIdParam(req) {
  const id = Number.parseInt(req.params.hubId, 10);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Hub not found', 404, 'hub_not_found');
  return id;
}

async function loadStaffRestaurant(req, permission) {
  const restaurantId = restaurantIdParam(req);
  const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
  if (!(await permissions.hasRestaurantPermission(restaurant, req.user.id, [permission]))) {
    throw new AppError('You do not have permission to manage store hubs', 403, 'forbidden');
  }
  return restaurant;
}

// Device authentication for the hub itself: the hub row points at a unified
// registry device, whose credential lives in restaurant_app_devices (the
// pairing flow the device originally completed).
async function authenticateHubDevice(req, res, next) {
  try {
    const restaurantId = restaurantIdParam(req);
    const hubId = hubIdParam(req);
    const { rows: [row] } = await pool.query(
      `SELECT h.id, h.location_id, h.status, d.source_app_device_id
         FROM store_hubs h
         JOIN restaurant_devices d ON d.id = h.device_id
        WHERE h.id = $1 AND h.restaurant_id = $2`,
      [hubId, restaurantId]
    );
    if (!row || !row.source_app_device_id) {
      throw new AppError('Hub device credential is required', 401, 'device_credential_required');
    }
    const device = await appFlow.requireDeviceCredential(req, restaurantId, Number(row.source_app_device_id));
    if (row.status !== 'active') throw new AppError('Hub is disabled', 409, 'hub_disabled');
    req.hub = { id: Number(row.id), locationId: Number(row.location_id), restaurantId };
    req.restaurantDevice = device;
    next();
  } catch (err) { next(err); }
}

exports.listHubs = async (req, res, next) => {
  try {
    const restaurant = await loadStaffRestaurant(req, 'settings.view');
    res.json({ hubs: await hub.listHubs(pool, restaurant.id) });
  } catch (error) { next(error); }
};

exports.registerHub = async (req, res, next) => {
  try {
    const restaurant = await loadStaffRestaurant(req, 'settings.manage');
    const scope = await getLocationScope(restaurant, req.user.id);
    const locationId = Number(req.body?.locationId ?? req.body?.location_id);
    if (scope.mode === 'assigned' && !scope.location_ids.includes(locationId)) {
      throw new AppError('You do not have access to this store', 403, 'location_scope_forbidden');
    }
    const created = await withTransaction(pool, async (client) => {
      const row = await hub.registerHub(client, {
        restaurantId: restaurant.id,
        locationId,
        name: req.body?.name,
        deviceId: req.body?.deviceId ?? req.body?.device_id ?? null,
        actorUserId: req.user.id,
      });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.hub.registered',
        target_type: 'store_hub',
        target_id: row.id,
        metadata: { location_id: row.location_id, device_id: row.device_id },
        client,
        throwOnError: true,
      });
      return row;
    }, 'restaurant_hub_register');
    res.status(201).json({ hub: created });
  } catch (error) { next(error); }
};

// Replay is money movement: pos.manage, and only for stores the caller can
// see. Held sales stay held until a manager resolves them explicitly.
exports.replaySales = async (req, res, next) => {
  try {
    const restaurant = await loadStaffRestaurant(req, 'pos.manage');
    const hubId = hubIdParam(req);
    const scope = await getLocationScope(restaurant, req.user.id);
    const result = await withTransaction(pool, async (client) => {
      const row = await hub.getHub(client, restaurant.id, hubId);
      if (scope.mode === 'assigned' && !scope.location_ids.includes(Number(row.location_id))) {
        throw new AppError('You do not have access to this store', 403, 'location_scope_forbidden');
      }
      const replayed = await hub.replaySales(client, { restaurantId: restaurant.id, hubId, actorUserId: req.user.id });
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.hub.replay',
        target_type: 'store_hub',
        target_id: hubId,
        metadata: { processed: replayed.processed },
        client,
        throwOnError: true,
      });
      return replayed;
    }, 'restaurant_hub_replay');
    res.json(result);
  } catch (error) { next(error); }
};

exports.listOfflineSales = async (req, res, next) => {
  try {
    const restaurant = await loadStaffRestaurant(req, 'pos.manage');
    const hubId = hubIdParam(req);
    const scope = await getLocationScope(restaurant, req.user.id);
    const row = await hub.getHub(pool, restaurant.id, hubId);
    if (scope.mode === 'assigned' && !scope.location_ids.includes(Number(row.location_id))) {
      throw new AppError('You do not have access to this store', 403, 'location_scope_forbidden');
    }
    res.json({
      sales: await hub.listOfflineSales(pool, {
        restaurantId: restaurant.id, hubId,
        status: req.query?.status || null,
        limit: req.query?.limit || 100,
      }),
    });
  } catch (error) { next(error); }
};

// --- Device-authenticated hub endpoints (the hub calls these) ---------------

exports.deviceHeartbeat = async (req, res, next) => {
  try {
    const updated = await hub.heartbeat(pool, {
      restaurantId: req.hub.restaurantId,
      hubId: req.hub.id,
      pullRevision: req.body?.pullRevision ?? req.body?.pull_revision ?? null,
    });
    res.json({ hub: updated });
  } catch (error) { next(error); }
};

exports.devicePull = async (req, res, next) => {
  try {
    res.json(await hub.pullChanges(pool, {
      restaurantId: req.hub.restaurantId,
      hubId: req.hub.id,
      sinceRevision: req.query?.since ?? req.query?.since_revision ?? 0,
      limit: req.query?.limit ?? 500,
    }));
  } catch (error) { next(error); }
};

exports.deviceQueueSales = async (req, res, next) => {
  try {
    const sales = Array.isArray(req.body?.sales) ? req.body.sales : [];
    res.status(201).json(await hub.queueOfflineSales(pool, {
      restaurantId: req.hub.restaurantId,
      hubId: req.hub.id,
      sales,
    }));
  } catch (error) { next(error); }
};

exports.authenticateHubDevice = authenticateHubDevice;
