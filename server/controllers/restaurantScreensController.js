"use strict";
const crypto = require("crypto");
const pool = require("../db");
const AppError = require("../utils/appError");
const sync = require("../services/restaurantScreenSync");
const app = require("./restaurantAppFlowController");
const food = require("./foodController");
const { getLocationScope } = require("../services/restaurantLocationAccessService");

async function access(req, manage = false) {
  const restaurantId = sync.positive(req.params.restaurantId);
  let restaurant,
    device = null,
    locationScope = { mode: "all", location_ids: null, assignments: [] };
  if (req.params.deviceId) {
    device = await app.requireDeviceCredential(
      req,
      restaurantId,
      sync.positive(req.params.deviceId),
    );
    if (manage)
      throw new AppError("Staff authorization required", 403, "forbidden");
    const { rows } = await pool.query(
      "SELECT * FROM food_restaurants WHERE id=$1",
      [restaurantId],
    );
    restaurant = rows[0];
  } else {
    if (!req.user?.id)
      throw new AppError("Sign in required", 401, "unauthorized");
    restaurant = await app.requireScreenStaff(
      req.user.id,
      restaurantId,
      manage,
    );
    locationScope = await getLocationScope(restaurant, req.user.id);
  }
  const locationId = device
    ? device.location_id
    : sync.positive(req.query.locationId, true);
  if (
    locationScope.mode === "assigned" &&
    locationId &&
    !locationScope.location_ids.includes(locationId)
  )
    throw new AppError("You do not have access to this store", 403, "location_scope_forbidden");
  if (locationId) {
    const { rows } = await pool.query(
      "SELECT id FROM restaurant_locations WHERE id=$1 AND restaurant_id=$2",
      [locationId, restaurantId],
    );
    if (!rows[0])
      throw new AppError("Location not found", 404, "location_not_found");
  }
  const role = device?.config?.screenRole || device?.mode;
  const locationIds = device
    ? [locationId]
    : locationScope.mode === "assigned"
      ? (locationId ? [locationId] : locationScope.location_ids)
      : null;
  return {
    restaurant,
    device,
    restaurantId,
    locationId,
    locationIds,
    allLocations: !device && locationScope.mode !== "assigned" && !locationId,
    readOrders:
      !device || device.app_key === "kitchen" || device.app_key === "pos",
    role,
  };
}
const handler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (e) {
    next(e);
  }
};
exports.snapshot = handler(async (req, res) => {
  const scope = await access(req);
  res.json(await sync.snapshot(scope, req.query));
});
exports.changes = handler(async (req, res) => {
  const scope = await access(req);
  res.json(await sync.changes(scope, req.query.cursor || 0, req.query.limit));
});
exports.control = handler(async (req, res) => {
  const scope = await access(req, true);
  const scopedLocations = scope.allLocations ? null : (scope.locationIds || [scope.locationId]);
  const locationFilter = scope.allLocations ? "" : " AND location_id = ANY($2::bigint[])";
  const locationParams = scope.allLocations
    ? [scope.restaurantId]
    : [scope.restaurantId, scopedLocations];
  const [
    {
      rows: [restaurant],
    },
    { rows: devices },
    { rows: locations },
    { rows: stations },
    { rows: tickets },
  ] = await Promise.all([
    pool.query(
      "SELECT id,business_id,screens_v2_enabled,currency_code,(SELECT revision FROM restaurant_screen_streams WHERE restaurant_id=food_restaurants.id) AS screen_head FROM food_restaurants WHERE id=$1",
      [scope.restaurantId],
    ),
    pool.query(
      `SELECT * FROM restaurant_app_devices WHERE restaurant_id=$1${locationFilter} AND app_key IN ('kitchen','display','pos') ORDER BY id`,
      locationParams,
    ),
    pool.query(
      `SELECT id,name FROM restaurant_locations WHERE restaurant_id=$1${scope.allLocations ? "" : " AND id = ANY($2::bigint[])"} ORDER BY id`,
      locationParams,
    ),
    pool.query(
      `SELECT * FROM restaurant_kitchen_stations WHERE restaurant_id=$1${locationFilter} ORDER BY id`,
      locationParams,
    ),
    pool.query(
      `SELECT id,location_id,device_id,status,conflict_code,expected_total_cents,created_at,payload,order_id FROM restaurant_screen_tickets WHERE restaurant_id=$1${locationFilter} AND status IN ('pending','conflict') ORDER BY created_at LIMIT 201`,
      locationParams,
    ),
  ]);
  res.json({
    businessId: restaurant.business_id,
    revision: Number(restaurant.screen_head || 0),
    enabled: !!restaurant.screens_v2_enabled,
    currencyCode: restaurant.currency_code,
    devices: devices.map((d) => ({
      ...app.publicScreenDevice(d),
      connection: sync.deviceHealth(d),
      configPending:
        Number(d.applied_config_version) < Number(d.config_version),
    })),
    locations,
    stations,
    tickets: tickets.slice(0, 200),
    ticketsHasMore: tickets.length > 200,
    serverTime: new Date().toISOString(),
  });
});
exports.enable = handler(async (req, res) => {
  const scope = await access(req, true);
  if (typeof req.body.enabled !== "boolean")
    throw new AppError("Enabled must be a boolean", 400, "validation_failed");
  await pool.query(
    "UPDATE food_restaurants SET screens_v2_enabled=$2 WHERE id=$1",
    [scope.restaurantId, req.body.enabled],
  );
  res.json({ enabled: req.body.enabled });
});
exports.importTicket = handler(async (req, res) => {
  const scope = await access(req);
  const requestedLocationId = req.body.locationId ?? req.body.location_id;
  if (!scope.device && requestedLocationId !== undefined) {
    scope.locationId = sync.positive(requestedLocationId, true);
    if (scope.locationId) {
      const { rows } = await pool.query(
        "SELECT id FROM restaurant_locations WHERE id=$1 AND restaurant_id=$2",
        [scope.locationId, scope.restaurantId],
      );
      if (!rows[0])
        throw new AppError("Location not found", 404, "location_not_found");
    }
    if (
      scope.locationIds &&
      !scope.locationIds.some((id) => String(id) === String(scope.locationId))
    )
      throw new AppError("You do not have access to this store", 403, "location_scope_forbidden");
  }
  if (!scope.device && scope.locationIds && !scope.locationId)
    throw new AppError("A store is required for offline tickets", 400, "screen_location_required");
  if (
    scope.device &&
    (!["pos", "display"].includes(scope.device.app_key) ||
      !["pos", "kiosk"].includes(scope.role))
  )
    throw new AppError("This screen cannot submit tickets", 403, "forbidden");

  const id = String(req.body.id || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new AppError("Invalid operation ID", 400, "validation_failed");
  if (
    scope.device &&
    String(req.body.locationId ?? "") !== String(scope.locationId ?? "")
  )
    throw new AppError(
      "Device location changed; staff review required",
      409,
      "screen_location_changed",
    );
  const source = req.body.payload || {};
  if (
    !Array.isArray(source.items) ||
    !source.items.length ||
    source.items.length > 100 ||
    JSON.stringify(source).length > 64000
  )
    throw new AppError("Invalid offline ticket", 400, "validation_failed");
  if (
    source.paymentMode &&
    !["pay_at_counter", "pay_at_restaurant"].includes(source.paymentMode)
  )
    throw new AppError(
      "Offline payment is not permitted",
      409,
      "screen_payment_online_required",
    );
  const expected = Number(req.body.expectedTotalCents);
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw new AppError("Invalid estimated total", 400, "validation_failed");
  const payload = {
    items: source.items,
    fulfillmentType: ["pickup", "dine_in"].includes(source.fulfillmentType)
      ? source.fulfillmentType
      : "pickup",
    guestName: String(source.guestName || "").slice(0, 140),
    menuFingerprint: source.menuFingerprint || null,
  };
  const hash = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        restaurantId: scope.restaurantId,
        locationId: scope.locationId,
        payload,
        expected,
      }),
    )
    .digest("hex");
  const result = await pool.query(
    `INSERT INTO restaurant_screen_tickets(id,restaurant_id,location_id,device_id,created_by,payload,request_hash,expected_total_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING *`,
    [
      id,
      scope.restaurantId,
      scope.locationId,
      scope.device?.id || null,
      req.user?.id || null,
      payload,
      hash,
      expected,
    ],
  );
  const ticket =
    result.rows[0] ||
    (
      await pool.query(
        "SELECT * FROM restaurant_screen_tickets WHERE id=$1 AND restaurant_id=$2",
        [id, scope.restaurantId],
      )
    ).rows[0];
  if (
    !ticket ||
    String(ticket.restaurant_id) !== String(scope.restaurantId) ||
    ticket.request_hash !== hash
  )
    throw new AppError(
      "Operation ID already used",
      409,
      "screen_idempotency_conflict",
    );
  res
    .status(201)
    .json({ id: ticket.id, status: ticket.status, orderId: ticket.order_id });
});
exports.acceptTicket = handler(async (req, res) => {
  const scope = await access(req, true);
  const ticketLocationFilter = scope.allLocations
    ? ""
    : " AND location_id = ANY($3::bigint[])";
  const {
    rows: [ticket],
  } = await pool.query(
    `SELECT * FROM restaurant_screen_tickets WHERE id=$1 AND restaurant_id=$2${ticketLocationFilter}`,
    scope.allLocations
      ? [req.params.ticketId, scope.restaurantId]
      : [req.params.ticketId, scope.restaurantId, scope.locationIds],
  );
  if (!ticket)
    throw new AppError("Ticket not found", 404, "screen_ticket_not_found");
  if (ticket.status === "dismissed")
    throw new AppError("Ticket dismissed", 409, "screen_ticket_dismissed");
  // createOrder retains all ordinary validation and transaction boundaries.
  // The trusted marker is set here only, never accepted from a client body.
  req.screenTicket = ticket;
  req.screenApprovedTotal = req.body.approvedTotalCents;
  req.screenApprovedFingerprint = req.body.approvedFingerprint;
  req.body = {
    ...ticket.payload,
    orderSource: "kiosk",
    paymentMode: "pay_at_counter",
    client_order_id: ticket.id,
  };
  req.headers["idempotency-key"] = req.body.client_order_id;
  try {
    await food.createOrder(req, res, (nextError) => {
      throw nextError;
    });
  } catch (error) {
    if (error.status === 409 || error.status === 400)
      await pool.query(
        "UPDATE restaurant_screen_tickets SET status='conflict',conflict_code=$3,updated_at=NOW() WHERE id=$1 AND restaurant_id=$2 AND status IN ('pending','conflict')",
        [ticket.id, scope.restaurantId, error.code],
      );
    throw error;
  }
});
exports.dismissTicket = handler(async (req, res) => {
  const scope = await access(req, true);
  const ticketLocationFilter = scope.allLocations
    ? ""
    : " AND location_id = ANY($3::bigint[])";
  const { rows } = await pool.query(
    `UPDATE restaurant_screen_tickets SET status='dismissed',updated_at=NOW() WHERE id=$1 AND restaurant_id=$2${ticketLocationFilter} AND status IN ('pending','conflict') RETURNING id`,
    scope.allLocations
      ? [req.params.ticketId, scope.restaurantId]
      : [req.params.ticketId, scope.restaurantId, scope.locationIds],
  );
  if (!rows[0])
    throw new AppError(
      "Ticket cannot be dismissed",
      409,
      "screen_ticket_conflict",
    );
  res.json({ dismissed: true });
});
exports.access = access;

exports.authenticateKitchen = async (req, res, next) => {
  try {
    const scope = await access(req);
    if (scope.device?.app_key !== "kitchen")
      throw new AppError("Kitchen device required", 403, "forbidden");
    if (req.body.expectedRevision === undefined || !req.get("Idempotency-Key"))
      throw new AppError(
        "Revision and operation ID required",
        400,
        "screen_operation_required",
      );
    req.screenDevice = scope.device;
    req.screenRestaurant = {
      ...scope.restaurant,
      effective_role: "screen_expeditor",
    };
    next();
  } catch (e) {
    next(e);
  }
};

exports.createOrder = handler(async (req, res) => {
  const scope = await access(req);
  if (
    !scope.device ||
    scope.device.app_key !== "display" ||
    scope.role !== "kiosk"
  )
    throw new AppError("Paired kiosk required", 403, "forbidden");
  if (!scope.restaurant.screens_v2_enabled)
    throw new AppError("Managed screens disabled", 409, "screens_disabled");
  req.restaurantDevice = scope.device;
  req.screenLocationId = scope.locationId;
  req.screenExpectedFingerprint = req.body.menuFingerprint;
  req.screenExpectedTotal = Number(req.body.expectedTotalCents);
  if (
    !Number.isSafeInteger(req.screenExpectedTotal) ||
    req.screenExpectedTotal < 0
  )
    throw new AppError("Quote required", 400, "validation_failed");
  req.body = {
    ...req.body,
    orderSource: "kiosk",
    paymentMode: "pay_at_counter",
  };
  await food.createOrder(req, res, (error) => {
    throw error;
  });
});

exports.orderAction = async (req, res, next) => {
  if (["finish_check", "hand_off"].includes(req.body.action)) {
    if (req.screenDevice.config?.screenRole !== "expeditor")
      return next(new AppError("Expeditor device required", 403, "forbidden"));
    req.body = {
      ...req.body,
      status: req.body.action === "finish_check" ? "ready" : "completed",
      action: req.body.action === "finish_check" ? "mark_ready" : "hand_off",
      enforceKitchenReadiness: true,
    };
    return food.updateOrderStatus(req, res, next);
  }
  return app.performKitchenOrderAction(req, res, next);
};
