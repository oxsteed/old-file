'use strict';

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const socketService = require('../services/socketService');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');
const posTerminal = require('../services/restaurantPosTerminalService');
const { reconcilePosOrderPayment } = require('../services/restaurantPosPaymentLedgerService');
const { uploadFile, getSignedDownloadUrl, deleteFile } = require('../utils/storage');
const { enqueueKitchenPrinterJobs } = require('../services/restaurantKitchenPrinterService');
const { getEffectivePermissions } = require('../services/permissionsService');

const MANAGE_ROLES = new Set(['owner', 'manager']);
const APP_KEYS = new Set(['manager', 'pos', 'kitchen', 'display', 'inventory', 'crew', 'runner', 'restaurant']);
const DEVICE_STATUSES = new Set(['pending', 'paired', 'disabled']);
const DEVICE_SYNC_STATUSES = new Set(['healthy', 'degraded', 'error']);
const ORDER_SOURCES = new Set(['counter', 'kiosk', 'tablet']);
const FULFILLMENT = new Set(['pickup', 'dine_in', 'delivery', 'kiosk']);
const PAYMENT_STATUS = new Set(['unpaid', 'requires_payment', 'paid', 'failed', 'refunded']);
const KITCHEN_ITEM_STATUS = new Set(['queued', 'preparing', 'ready', 'held', 'bumped', 'delayed', 'problem', 'cancelled']);
const KITCHEN_ACTIONS = new Set(['start', 'prepare', 'ready', 'bump', 'recall', 'hold', 'delay', 'problem', 'cancel']);
const KITCHEN_ACTION_FROM = {
  start: new Set(['queued', 'held', 'delayed', 'problem']),
  prepare: new Set(['queued', 'held', 'delayed', 'problem']),
  ready: new Set(['preparing', 'delayed', 'problem']),
  bump: new Set(['ready']),
  recall: new Set(['bumped']),
  hold: new Set(['queued', 'preparing', 'delayed', 'problem']),
  delay: new Set(['queued', 'preparing', 'held']),
  problem: new Set(['queued', 'preparing', 'held']),
  cancel: new Set(['queued', 'preparing', 'ready', 'held', 'delayed', 'problem']),
};
const CREW_STATUS = new Set(['not_started', 'in_progress', 'needs_approval', 'completed', 'cancelled']);
const CREW_TRANSITIONS = {
  not_started: new Set(['in_progress', 'cancelled']),
  in_progress: new Set(['needs_approval', 'completed', 'cancelled']),
  needs_approval: new Set(['in_progress', 'completed', 'cancelled']),
  completed: new Set(['in_progress']),
  cancelled: new Set(['not_started']),
};
const POS_TICKET_STATES = new Set(['open', 'held', 'voided', 'refunded', 'closed']);
const POS_PAYMENT_TYPES = new Set(['cash', 'card', 'external', 'gift_card', 'wallet_credit', 'comp', 'refund']);
const POS_PAYMENT_STATUSES = new Set(['recorded', 'pending', 'captured', 'failed', 'refunded', 'voided']);
const POS_DRAWER_EVENT_TYPES = new Set(['cash_in', 'cash_out', 'cash_drop', 'no_sale', 'drawer_count', 'payout']);
const PRINTER_JOB_TYPES = new Set(['kitchen_ticket', 'receipt', 'expo_label', 'runner_handoff']);
const PRINTER_JOB_STATUSES = new Set(['queued', 'sent', 'printed', 'failed', 'cancelled']);
const RUNNER_SETTLEMENT_STATUSES = new Set(['pending', 'approved', 'paid', 'disputed', 'voided']);
const CREW_PROOF_TYPES = new Set(['photo', 'document', 'signature', 'note', 'other']);
const PAYMENT_MODE_ALIASES = {
  pay_at_counter: 'pay_at_restaurant',
  pay_at_restaurant: 'pay_at_restaurant',
  pay_at_restaurant_counter: 'pay_at_restaurant',
  wallet_credit: 'restaurant_credit',
  restaurant_credit: 'restaurant_credit',
  direct: 'direct_payment',
  direct_payment: 'direct_payment',
  off_platform: 'direct_payment',
};
const LEGACY_PAYMENT_MODE = {
  pay_at_restaurant: 'pay_at_counter',
  restaurant_credit: 'wallet_credit',
  direct_payment: 'direct_payment',
};
const ROLE_PERMISSIONS = {
  owner: ['*'],
  manager: [
    'restaurant.manage',
    'orders.manage',
    'pos.manage',
    'kitchen.manage',
    'display.manage',
    'inventory.manage',
    'crew.manage',
    'runner.manage',
    'support.manage',
  ],
  representative: ['orders.view', 'kitchen.view', 'inventory.view', 'display.view', 'support.view'],
  employee: [
    'orders.view',
    'pos.use',
    'kitchen.view',
    'kitchen.update',
    'inventory.view',
    'inventory.update',
    'crew.update',
    'runner.update',
    'display.view',
  ],
  support_agent: ['support.manage'],
};

function parsePositiveInt(value, fallback = null) {
  const n = Number.parseInt(String(value), 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseCents(value, field, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be a non-negative amount in cents' });
  }
  return Math.round(n);
}

function normalizeString(value, max = 255) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

function asBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
}

function safeJson(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function normalizeRestaurantPaymentMode(value, fallback = 'pay_at_restaurant') {
  const raw = normalizeString(value, 40);
  if (raw && !PAYMENT_MODE_ALIASES[raw]) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      paymentMode: 'Must be restaurant_credit, pay_at_restaurant, or direct_payment',
    });
  }
  const canonical = raw ? PAYMENT_MODE_ALIASES[raw] : fallback;
  if (!PAYMENT_MODE_ALIASES[canonical]) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      paymentMode: 'Must be restaurant_credit, pay_at_restaurant, or direct_payment',
    });
  }
  return {
    canonical,
    legacy: LEGACY_PAYMENT_MODE[canonical] || canonical,
    collection: canonical === 'restaurant_credit'
      ? 'restaurant_credit'
      : canonical === 'direct_payment'
        ? 'direct_payment'
        : 'pay_at_restaurant',
  };
}

function paymentContractMetadata(contract, overrides = {}) {
  return {
    mode: contract.canonical,
    legacyMode: contract.legacy,
    collection: contract.collection,
    ...overrides,
  };
}

async function insertPosReceiptAudit(client, {
  restaurantId,
  order,
  eventType,
  channel = 'Payment update',
  createdBy,
  reason = null,
  metadata = {},
  idempotencyKey = null,
}) {
  const { rows: [event] } = await client.query(
    `INSERT INTO restaurant_pos_receipt_events
       (restaurant_id, food_order_id, queue_number, guest_name, total_cents,
        payment_status, channel, event_type, reason, metadata, idempotency_key, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
     ON CONFLICT (restaurant_id, idempotency_key)
       WHERE idempotency_key IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      restaurantId,
      order.id,
      order.queue_number,
      order.guest_name,
      order.total_cents,
      order.payment_status,
      channel,
      eventType,
      reason,
      JSON.stringify(safeJson(metadata)),
      idempotencyKey,
      createdBy,
    ]
  );
  return event || null;
}

function normalizeBusinessSnapshot(row, fallbackId = null) {
  const business = safeJson(row?.business, row || {});
  return {
    id: business.id || fallbackId,
    business_name: business.business_name || business.name || null,
    business_type: business.business_type || null,
    is_primary: business.is_primary ?? false,
    is_active: business.is_active ?? true,
    country: business.country || business.address_country || null,
    city: business.city || business.address_city || null,
    state: business.state || business.address_state || null,
  };
}

function normalizeCountry(value) {
  const raw = normalizeString(value, 2);
  return raw ? raw.toUpperCase() : null;
}

function normalizeCurrency(value) {
  const raw = normalizeString(value, 3);
  return raw ? raw.toUpperCase() : null;
}

function parseFiniteNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be a number' });
  }
  return n;
}

function parseOptionalInteger(value, field, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [field]: `Must be an integer between ${min} and ${max}`,
    });
  }
  return number;
}

function parseOptionalBoolean(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be true or false' });
  }
  return value;
}

function geoDistanceMeters(lat1, lng1, lat2, lng2) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lng2 - lng1);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
    * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.*, b.user_id AS business_owner_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role
                  FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2
                   AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  const restaurant = rows[0];
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
}

function assertManage(restaurant) {
  if (!MANAGE_ROLES.has(restaurant.effective_role)) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

function normalizeLocationPatch(value) {
  const source = safeJson(value, null);
  if (!source) return null;
  return {
    id: parsePositiveInt(source.id),
    name: normalizeString(source.name, 160),
    addressStreet: normalizeString(source.addressStreet ?? source.address_street, 255),
    addressCity: normalizeString(source.addressCity ?? source.address_city, 120),
    addressState: normalizeString(source.addressState ?? source.address_state, 120),
    addressZip: normalizeString(source.addressZip ?? source.address_zip, 40),
    addressCountry: normalizeCountry(source.addressCountry ?? source.address_country) || 'US',
    latitude: source.latitude === undefined || source.latitude === null || source.latitude === '' ? null : parseFiniteNumber(source.latitude, 'latitude'),
    longitude: source.longitude === undefined || source.longitude === null || source.longitude === '' ? null : parseFiniteNumber(source.longitude, 'longitude'),
    timezone: normalizeString(source.timezone, 80),
    phone: normalizeString(source.phone, 40),
    status: normalizeString(source.status, 24),
    operatingHours: safeJson(source.operatingHours ?? source.operating_hours, null),
    isPrimary: source.isPrimary ?? source.is_primary ?? true,
  };
}

function effectivePermissions(role, override = null) {
  const base = new Set(ROLE_PERMISSIONS[role] || []);
  const source = safeJson(override, {});
  for (const permission of source.allow || source.allowed || []) base.add(permission);
  for (const permission of source.deny || source.denied || []) base.delete(permission);
  return Array.from(base);
}

function appModuleFlags(restaurant, role, permissions = []) {
  const canManage = MANAGE_ROLES.has(role);
  const allowed = (permission) => canManage || permissions.includes('*') || permissions.includes(permission);
  return {
    manager: canManage,
    pos: restaurant.accepts_in_store_orders !== false && (allowed('pos.use') || allowed('pos.manage')),
    kitchen: restaurant.kitchen_display_enabled !== false && (allowed('kitchen.view') || allowed('kitchen.update') || allowed('kitchen.manage')),
    display: allowed('display.view') || allowed('display.manage'),
    inventory: allowed('inventory.view') || allowed('inventory.update') || allowed('inventory.manage'),
    crew: allowed('crew.update') || allowed('crew.manage'),
    runner: (Array.isArray(restaurant.fulfillment_modes) ? restaurant.fulfillment_modes.includes('delivery') : true)
      && (allowed('runner.update') || allowed('runner.manage')),
    support: allowed('support.view') || allowed('support.manage'),
  };
}

function broadcastRestaurant(restaurant, event, payload) {
  try {
    socketService.broadcastToBusinessInbox(restaurant.business_id, event, payload);
    if (payload?.order) {
      socketService.broadcastToRestaurantDisplay(restaurant.id, 'food:display:changed', {
        restaurantId: String(restaurant.id),
        queueNumber: payload.order.queue_number,
        status: payload.order.status,
      });
    }
  } catch (_) {
    // best-effort; database state is authoritative
  }
}

async function createPosDeliveryRunnerTask(client, order, deliveryAddress, createdBy) {
  if (order.fulfillment_type !== 'delivery') return null;
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`runner-task:${order.restaurant_id}:${order.id}`]
  );
  const { rows: [existing] } = await client.query(
    `SELECT * FROM restaurant_runner_tasks
      WHERE restaurant_id = $1 AND food_order_id = $2 AND task_type = 'Delivery'
      ORDER BY created_at DESC LIMIT 1`,
    [order.restaurant_id, order.id]
  );
  if (existing) return existing;
  const stopName = [deliveryAddress.line1, deliveryAddress.city].filter(Boolean).join(', ')
    || order.guest_name
    || 'Delivery stop';
  const { rows: [task] } = await client.query(
    `INSERT INTO restaurant_runner_tasks
       (restaurant_id, food_order_id, order_reference, stop_name, task_type, status,
        route_window, customer_contact_rule, requires_proof, cash_collection_required, created_by)
     VALUES ($1,$2,$3,$4,'Delivery','Queued','ASAP',$5,TRUE,$6,$7)
     RETURNING *`,
    [
      order.restaurant_id,
      order.id,
      `#${order.queue_number}`,
      stopName.slice(0, 200),
      deliveryAddress.instructions || 'Deliver to customer address on file.',
      order.payment_status === 'unpaid',
      createdBy,
    ]
  );
  return task;
}

async function recalcOrderTotals(client, orderId) {
  const { rows: [totals] } = await client.query(
    `SELECT COALESCE(SUM(line_total_cents), 0)::int AS subtotal_cents
       FROM food_order_items
      WHERE order_id = $1`,
    [orderId]
  );
  const subtotal = Number(totals?.subtotal_cents || 0);
  const { rows: [order] } = await client.query(
    `UPDATE food_orders
        SET subtotal_cents = $1,
            tax_cents = ROUND(
              GREATEST(0, $1 - discount_cents)::numeric * tax_rate_bps / 10000
            )::int,
            service_fee_cents = ROUND(
              GREATEST(0, $1 - discount_cents)::numeric * service_fee_bps / 10000
            )::int,
            total_cents = GREATEST(0, $1 - discount_cents)
              + ROUND(GREATEST(0, $1 - discount_cents)::numeric * tax_rate_bps / 10000)::int
              + ROUND(GREATEST(0, $1 - discount_cents)::numeric * service_fee_bps / 10000)::int
              + tip_cents + delivery_fee_cents,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [subtotal, orderId]
  );
  return order;
}

async function assertMutablePosOrders(client, restaurantId, orders) {
  const invalid = orders.find((order) => !['open', 'held'].includes(order.pos_ticket_state || 'open')
    || !['unpaid', 'requires_payment'].includes(order.payment_status)
    || ['cancelled', 'refunded', 'completed'].includes(order.status));
  if (invalid) {
    throw new AppError('Only open or held unpaid tickets can be changed', 409, 'pos_ticket_not_mutable');
  }
  const orderIds = orders.map((order) => Number(order.id));
  const { rows: [payments] } = await client.query(
    `SELECT COUNT(*)::int AS payment_count
       FROM restaurant_pos_payments
      WHERE restaurant_id = $1
        AND food_order_id = ANY($2::bigint[])
        AND payment_type <> 'refund'
        AND status IN ('pending','recorded','captured')`,
    [restaurantId, orderIds]
  );
  if (Number(payments.payment_count || 0) > 0) {
    throw new AppError('Tickets with payment activity cannot be split or merged', 409, 'pos_ticket_has_payments');
  }
}

async function syncKitchenOrderStatus(client, orderId, preferredStatus = null) {
  const { rows: [totals] } = await client.query(
    `SELECT COUNT(*)::int AS total_items,
            COUNT(*) FILTER (WHERE kitchen_status IN ('ready','bumped'))::int AS ready_items,
            COUNT(*) FILTER (WHERE kitchen_status IN ('cancelled'))::int AS cancelled_items
       FROM food_order_items
      WHERE order_id = $1`,
    [orderId]
  );
  const totalItems = Number(totals?.total_items || 0);
  const readyItems = Number(totals?.ready_items || 0);
  const cancelledItems = Number(totals?.cancelled_items || 0);
  let nextStatus = preferredStatus;
  if (totalItems > 0 && cancelledItems >= totalItems) {
    nextStatus = 'cancelled';
  } else if (totalItems > 0 && readyItems + cancelledItems >= totalItems) {
    nextStatus = 'ready';
  } else if (!nextStatus) {
    nextStatus = 'preparing';
  }
  const { rows: [order] } = await client.query(
    `UPDATE food_orders
        SET status = CASE
              WHEN status IN ('completed','cancelled','refunded') THEN status
              WHEN $2 = 'cancelled' THEN 'cancelled'
              WHEN $2 = 'ready' THEN 'ready'
              WHEN status IN ('received','accepted') THEN $2
              ELSE status
            END,
            accepted_at = CASE WHEN $2 IN ('preparing','ready') THEN COALESCE(accepted_at, NOW()) ELSE accepted_at END,
            ready_at = CASE WHEN $2 = 'ready' THEN COALESCE(ready_at, NOW()) ELSE ready_at END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [orderId, nextStatus]
  );
  return order;
}

async function loadRestaurantSnapshot(restaurantId) {
  const { rows: [restaurant] } = await pool.query(
    `SELECT id, business_id, display_name, status, fulfillment_modes,
            accepts_online_orders, accepts_in_store_orders, kitchen_display_enabled,
            prep_time_min, delivery_radius_meters, tax_rate_bps, service_fee_bps,
            online_order_pause_reason, settings, timezone, currency_code
       FROM food_restaurants
      WHERE id = $1`,
    [restaurantId]
  );
  return restaurant;
}

async function buildBootstrapPayload(user, restaurantId, query = {}) {
    const restaurant = await requireRestaurantAccess(user.id, restaurantId);
    const appKey = normalizeString(query.app || query.appKey, 32);
    if (appKey && !APP_KEYS.has(appKey)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { app: 'Unsupported app key' });
    }
    const requestedDeviceId = parsePositiveInt(query.deviceId || query.device_id);

    const [{ rows: membershipRows }, { rows: devices }, { rows: locations }, { rows: businessRows }, snapshot] = await Promise.all([
      pool.query(
        `SELECT id, role, status
           FROM business_members
          WHERE business_id = $1 AND member_id = $2
          LIMIT 1`,
        [restaurant.business_id, user.id]
      ),
      pool.query(
        `SELECT d.id, d.app_key, d.device_name, d.mode, d.location_id, d.status, d.config, d.last_seen_at, d.updated_at,
                row_to_json(l.*) AS location
           FROM restaurant_app_devices d
           LEFT JOIN restaurant_locations l
             ON l.id = d.location_id AND l.restaurant_id = d.restaurant_id
          WHERE d.restaurant_id = $1 AND d.status <> 'disabled'
          ORDER BY d.updated_at DESC
          LIMIT 500`,
        [restaurantId]
      ),
      pool.query(
        `SELECT id, name, address_street, address_city, address_state, address_zip,
                address_country, latitude, longitude, timezone, phone, is_primary,
                status, operating_hours, updated_at
           FROM restaurant_locations
          WHERE restaurant_id = $1
          ORDER BY is_primary DESC, name ASC`,
        [restaurantId]
      ),
      pool.query(
        `SELECT to_jsonb(b) AS business
           FROM businesses b
          WHERE id = $1
          LIMIT 1`,
        [restaurant.business_id]
      ),
      loadRestaurantSnapshot(restaurantId),
    ]);
    const businessMember = membershipRows[0] || null;
    const role = restaurant.effective_role;
    const teamPermissionResult = await getEffectivePermissions({
      businessId: restaurant.business_id,
      userId: user.id,
      role,
      membershipId: businessMember?.id || null,
    });
    const permissions = Array.from(new Set([
      ...effectivePermissions(role),
      ...teamPermissionResult.permissions,
    ]));
    const enabledModules = appModuleFlags(snapshot, role, permissions);
    const activeDevice = requestedDeviceId
      ? devices.find((device) => Number(device.id) === requestedDeviceId) || null
      : appKey
        ? devices.find((device) => device.app_key === appKey && device.status === 'paired') || devices.find((device) => device.app_key === appKey) || null
        : null;
    const primaryLocation = locations.find((location) => location.is_primary) || locations[0] || null;
    if (requestedDeviceId && !activeDevice) {
      throw new AppError('Device is not assigned to this restaurant workspace', 404, 'device_not_found');
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name || null,
        lastName: user.last_name || null,
        phone: user.phone || null,
        preferredLanguage: user.preferred_language || null,
      },
      restaurant: snapshot,
      business: businessRows[0] ? normalizeBusinessSnapshot(businessRows[0], restaurant.business_id) : {
        id: restaurant.business_id,
        business_name: null,
      },
      locations,
      location: activeDevice?.location || primaryLocation,
      membership: {
        role,
        businessMember,
        permissions,
        permissionSource: teamPermissionResult.raw,
        isOwner: role === 'owner',
        canManage: MANAGE_ROLES.has(role),
      },
      app: {
        key: appKey || null,
        requestedDeviceId: requestedDeviceId || null,
        enabledModules,
        settings: {
          fulfillmentModes: snapshot.fulfillment_modes,
          acceptsOnlineOrders: snapshot.accepts_online_orders,
          acceptsInStoreOrders: snapshot.accepts_in_store_orders,
          kitchenDisplayEnabled: snapshot.kitchen_display_enabled,
          prepTimeMin: snapshot.prep_time_min,
          deliveryRadiusMeters: snapshot.delivery_radius_meters,
          taxRateBps: snapshot.tax_rate_bps,
          serviceFeeBps: snapshot.service_fee_bps,
          onlineOrderPauseReason: snapshot.online_order_pause_reason,
          timezone: snapshot.timezone,
          currencyCode: snapshot.currency_code,
        },
      },
      device: activeDevice,
      devices,
    };
}

exports.getBootstrap = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    res.json(await buildBootstrapPayload(req.user, restaurantId, req.query));
  } catch (err) {
    next(err);
  }
};

exports.discoverBootstrap = async (req, res, next) => {
  try {
    const appKey = normalizeString(req.query.app || req.query.appKey, 32);
    if (appKey && !APP_KEYS.has(appKey)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { app: 'Unsupported app key' });
    }
    const requestedRestaurantId = parsePositiveInt(req.query.restaurantId || req.query.restaurant_id);
    const requestedDeviceId = parsePositiveInt(req.query.deviceId || req.query.device_id);
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (fr.id)
              fr.id, fr.business_id, fr.display_name, fr.status, fr.fulfillment_modes,
              fr.accepts_online_orders, fr.accepts_in_store_orders, fr.kitchen_display_enabled,
              fr.prep_time_min, fr.delivery_radius_meters, fr.tax_rate_bps, fr.service_fee_bps,
              fr.online_order_pause_reason, fr.settings, fr.timezone, fr.currency_code,
              b.business_name, FALSE AS business_is_primary,
              CASE
                WHEN b.user_id = $1 OR fr.owner_user_id = $1 THEN 'owner'
                ELSE bm.role
              END AS effective_role,
              bm.id AS membership_id
         FROM food_restaurants fr
         JOIN businesses b ON b.id = fr.business_id
         LEFT JOIN business_members bm
           ON bm.business_id = fr.business_id
          AND bm.member_id = $1
          AND bm.status = 'active'
        WHERE b.user_id = $1 OR fr.owner_user_id = $1 OR bm.member_id = $1
        ORDER BY fr.id,
                 CASE WHEN b.user_id = $1 OR fr.owner_user_id = $1 THEN 0 ELSE 1 END,
                 b.is_primary DESC,
                 fr.display_name ASC`,
      [req.user.id]
    );
    if (!rows.length) {
      throw new AppError('No restaurant workspace is assigned to this account', 404, 'restaurant_workspace_not_found');
    }
    let deviceRestaurantId = null;
    if (requestedDeviceId) {
      const { rows: [device] } = await pool.query(
        `SELECT restaurant_id
           FROM restaurant_app_devices
          WHERE id = $1 AND status = 'paired'
            AND ($2::text IS NULL OR app_key = $2)`,
        [requestedDeviceId, appKey]
      );
      if (device && rows.some((row) => Number(row.id) === Number(device.restaurant_id))) {
        deviceRestaurantId = Number(device.restaurant_id);
      }
      if (!deviceRestaurantId) {
        throw new AppError('Paired device is not assigned to an accessible restaurant workspace', 404, 'device_not_found');
      }
    }
    const requested = requestedRestaurantId
      ? rows.find((row) => Number(row.id) === requestedRestaurantId)
      : null;
    if (requestedRestaurantId && !requested) {
      throw new AppError('Restaurant workspace not found', 404, 'restaurant_workspace_not_found');
    }
    const selected = requested
      || rows.find((row) => Number(row.id) === deviceRestaurantId)
      || rows.find((row) => row.effective_role === 'owner' && row.business_is_primary)
      || rows.find((row) => row.effective_role === 'owner')
      || rows[0];
    const selectionReason = requested
      ? 'requested_restaurant'
      : deviceRestaurantId
        ? 'paired_device'
        : selected.effective_role === 'owner'
          ? 'owned_restaurant'
          : 'first_accessible_restaurant';
    const payload = await buildBootstrapPayload(req.user, Number(selected.id), req.query);
    const restaurants = await Promise.all(rows.map(async (row) => {
      const teamPermissionResult = await getEffectivePermissions({
        businessId: row.business_id,
        userId: req.user.id,
        role: row.effective_role,
        membershipId: row.membership_id || null,
      });
      const permissions = Array.from(new Set([
        ...effectivePermissions(row.effective_role),
        ...teamPermissionResult.permissions,
      ]));
      return {
        id: row.id,
        businessId: row.business_id,
        businessName: row.business_name,
        displayName: row.display_name,
        status: row.status,
        role: row.effective_role,
        permissions,
        permissionSource: teamPermissionResult.raw,
        enabledModules: appModuleFlags(row, row.effective_role, permissions),
      };
    }));
    res.json({
      ...payload,
      restaurants,
      selection: {
        restaurantId: Number(selected.id),
        reason: selectionReason,
        requestedRestaurantId: requestedRestaurantId || null,
        requestedDeviceId: requestedDeviceId || null,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.getManagerDashboard = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const days = Math.min(parsePositiveInt(req.query.days, 7), 90);
    const timezone = normalizeString(restaurant.timezone, 80) || 'UTC';
    const rangeParams = [restaurantId, days, timezone];

    const [
      { rows: [today] },
      { rows: activeOrders },
      { rows: topItems },
      { rows: [inventory] },
      { rows: [support] },
      { rows: [staff] },
      { rows: [orderMetrics] },
      { rows: orderBreakdown },
      { rows: [kitchen] },
      { rows: [runner] },
      { rows: [devices] },
    ] = await Promise.all([
      pool.query(
        `WITH order_financials AS (
           SELECT fo.*,
                  CASE
                    WHEN COALESCE(pos.payment_count, 0) > 0
                      THEN GREATEST(0, pos.collected_cents - pos.refunded_cents)
                    WHEN fo.payment_status = 'paid' THEN fo.total_cents
                    ELSE 0
                  END::int AS net_collected_cents,
                  CASE
                    WHEN COALESCE(pos.payment_count, 0) > 0 THEN pos.refunded_cents
                    WHEN fo.payment_status = 'refunded' THEN fo.total_cents
                    ELSE 0
                  END::int AS refunded_cents
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
              AND (fo.created_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
         )
         SELECT COUNT(*) FILTER (WHERE status NOT IN ('cancelled','refunded'))::int AS order_count,
                COUNT(*) FILTER (WHERE net_collected_cents > 0)::int AS paid_order_count,
                COALESCE(SUM(total_cents) FILTER (WHERE status NOT IN ('cancelled','refunded')),0)::int AS gross_order_value_cents,
                COALESCE(SUM(net_collected_cents),0)::int AS sales_cents,
                COALESCE(SUM(refunded_cents),0)::int AS refunded_cents,
                COALESCE(SUM(tip_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS tips_cents,
                COALESCE(AVG(net_collected_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS average_ticket_cents
           FROM order_financials`,
        [restaurantId, timezone]
      ),
      pool.query(
        `SELECT id, queue_number, guest_name, fulfillment_type, status, payment_status,
                order_source, total_cents, promised_at, created_at,
                (promised_at IS NOT NULL AND promised_at < NOW() AND status NOT IN ('ready','completed','cancelled','refunded')) AS is_delayed
           FROM food_orders
          WHERE restaurant_id = $1
            AND status IN ('received','accepted','preparing','ready')
          ORDER BY created_at ASC
          LIMIT 25`,
        [restaurantId]
      ),
      pool.query(
        `WITH order_financials AS (
           SELECT fo.id, fo.total_cents,
                  CASE
                    WHEN COALESCE(pos.payment_count, 0) > 0
                      THEN GREATEST(0, pos.collected_cents - pos.refunded_cents)
                    WHEN fo.payment_status = 'paid' THEN fo.total_cents
                    ELSE 0
                  END::int AS net_collected_cents
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
              AND fo.created_at >= (
                ((NOW() AT TIME ZONE $3)::date - ($2::int - 1))::timestamp AT TIME ZONE $3
              )
         )
         SELECT foi.item_name, SUM(foi.quantity)::int AS quantity,
                COALESCE(SUM(ROUND(
                  foi.line_total_cents::numeric * ofn.net_collected_cents
                  / NULLIF(ofn.total_cents, 0)
                )), 0)::int AS revenue_cents
           FROM food_order_items foi
           JOIN order_financials ofn ON ofn.id = foi.order_id
          WHERE ofn.net_collected_cents > 0
          GROUP BY foi.item_name
          ORDER BY quantity DESC, revenue_cents DESC
          LIMIT 10`,
        rangeParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total_items,
                COUNT(*) FILTER (WHERE quantity <= low_stock_threshold OR quantity <= 0)::int AS low_stock_items
           FROM restaurant_inventory_items
          WHERE restaurant_id = $1 AND is_active = TRUE`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS open_cases,
                COUNT(*) FILTER (WHERE is_escalated = TRUE)::int AS escalated_cases
           FROM restaurant_support_cases
          WHERE restaurant_id = $1
            AND status NOT IN ('resolved','closed','canceled')`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS active_members
           FROM business_members
          WHERE business_id = $1 AND status = 'active'`,
        [restaurant.business_id]
      ),
      pool.query(
        `WITH order_financials AS (
           SELECT fo.*,
                  CASE
                    WHEN COALESCE(pos.payment_count, 0) > 0
                      THEN GREATEST(0, pos.collected_cents - pos.refunded_cents)
                    WHEN fo.payment_status = 'paid' THEN fo.total_cents
                    ELSE 0
                  END::int AS net_collected_cents,
                  CASE
                    WHEN COALESCE(pos.payment_count, 0) > 0 THEN pos.refunded_cents
                    WHEN fo.payment_status = 'refunded' THEN fo.total_cents
                    ELSE 0
                  END::int AS refunded_cents
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
              AND fo.created_at >= (
                ((NOW() AT TIME ZONE $3)::date - ($2::int - 1))::timestamp AT TIME ZONE $3
              )
         )
         SELECT COUNT(*)::int AS order_count,
                COUNT(*) FILTER (WHERE status NOT IN ('cancelled','refunded'))::int AS accepted_order_count,
                COUNT(*) FILTER (WHERE net_collected_cents > 0)::int AS paid_order_count,
                COUNT(*) FILTER (WHERE net_collected_cents = 0 AND status NOT IN ('cancelled','refunded'))::int AS unpaid_order_count,
                COALESCE(SUM(total_cents) FILTER (WHERE status NOT IN ('cancelled','refunded')),0)::int AS gross_order_value_cents,
                COALESCE(SUM(net_collected_cents),0)::int AS sales_cents,
                COALESCE(SUM(refunded_cents),0)::int AS refunded_cents,
                COALESCE(SUM(tax_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS tax_cents,
                COALESCE(SUM(service_fee_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS service_fee_cents,
                COALESCE(SUM(delivery_fee_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS delivery_fee_cents,
                COALESCE(SUM(tip_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS tips_cents,
                COALESCE(SUM(discount_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS discounts_cents,
                COALESCE(AVG(net_collected_cents) FILTER (WHERE net_collected_cents > 0),0)::int AS average_ticket_cents,
                COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled_orders,
                COUNT(*) FILTER (WHERE status = 'refunded' OR payment_status = 'refunded')::int AS refunded_orders,
                COUNT(*) FILTER (WHERE fulfillment_type = 'delivery')::int AS delivery_orders,
                COUNT(*) FILTER (WHERE fulfillment_type = 'pickup')::int AS pickup_orders,
                COUNT(*) FILTER (WHERE fulfillment_type = 'dine_in')::int AS dine_in_orders,
                COUNT(*) FILTER (WHERE order_source IN ('counter','kiosk','tablet'))::int AS in_store_orders,
                COUNT(*) FILTER (WHERE order_source NOT IN ('counter','kiosk','tablet'))::int AS online_orders
           FROM order_financials`,
        rangeParams
      ),
      pool.query(
        `WITH order_financials AS (
           SELECT fo.*,
                  CASE
                    WHEN COALESCE(pos.payment_count, 0) > 0
                      THEN GREATEST(0, pos.collected_cents - pos.refunded_cents)
                    WHEN fo.payment_status = 'paid' THEN fo.total_cents
                    ELSE 0
                  END::int AS net_collected_cents
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
              AND fo.created_at >= (
                ((NOW() AT TIME ZONE $3)::date - ($2::int - 1))::timestamp AT TIME ZONE $3
              )
         )
         SELECT COALESCE(status, 'unknown') AS status,
                COALESCE(payment_status, 'unknown') AS payment_status,
                COALESCE(order_source, 'unknown') AS order_source,
                COALESCE(fulfillment_type, 'unknown') AS fulfillment_type,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(net_collected_cents),0)::int AS sales_cents
           FROM order_financials
          GROUP BY status, payment_status, order_source, fulfillment_type
          ORDER BY order_count DESC, sales_cents DESC`,
        rangeParams
      ),
      pool.query(
        `SELECT COUNT(*)::int AS item_count,
                COUNT(*) FILTER (WHERE foi.kitchen_status = 'queued')::int AS queued_items,
                COUNT(*) FILTER (WHERE foi.kitchen_status = 'preparing')::int AS preparing_items,
                COUNT(*) FILTER (WHERE foi.kitchen_status = 'ready')::int AS ready_items,
                COUNT(*) FILTER (WHERE foi.kitchen_status = 'bumped')::int AS bumped_items,
                COUNT(*) FILTER (WHERE foi.kitchen_status = 'delayed')::int AS delayed_items,
                COUNT(*) FILTER (WHERE foi.kitchen_status = 'problem')::int AS problem_items,
                COALESCE(AVG(EXTRACT(EPOCH FROM (
                  COALESCE(foi.bumped_at, foi.updated_at, NOW())
                  - COALESCE(foi.kitchen_started_at, fo.accepted_at, fo.created_at)
                ))),0)::int AS average_prep_seconds
           FROM food_order_items foi
           JOIN food_orders fo ON fo.id = foi.order_id
          WHERE fo.restaurant_id = $1
            AND fo.created_at >= (
              ((NOW() AT TIME ZONE $3)::date - ($2::int - 1))::timestamp AT TIME ZONE $3
            )`,
        rangeParams
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status IN ('Queued','Assigned','Ready','Picked up','En route','Issue'))::int AS active_tasks,
                COUNT(*) FILTER (
                  WHERE status = 'Completed'
                    AND (completed_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
                )::int AS completed_today,
                COUNT(*) FILTER (WHERE status = 'Issue')::int AS issue_tasks,
                COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - picked_up_at))),0)::int AS average_delivery_seconds
           FROM restaurant_runner_tasks
          WHERE restaurant_id = $1`,
        [restaurantId, timezone]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'paired')::int AS paired_devices,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_devices,
                COUNT(*) FILTER (
                  WHERE status = 'paired'
                    AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '5 minutes')
                )::int AS stale_devices,
                MAX(last_seen_at) AS last_seen_at
           FROM restaurant_app_devices
          WHERE restaurant_id = $1`,
        [restaurantId]
      ),
    ]);

    const activeDelayedOrders = activeOrders.filter((order) => order.is_delayed).length;
    const inventorySummary = inventory || { total_items: 0, low_stock_items: 0 };
    const supportSummary = support || { open_cases: 0, escalated_cases: 0 };
    const runnerSummary = runner || { active_tasks: 0, completed_today: 0, issue_tasks: 0, average_delivery_seconds: 0 };
    const kitchenSummary = kitchen || {
      item_count: 0,
      queued_items: 0,
      preparing_items: 0,
      ready_items: 0,
      bumped_items: 0,
      delayed_items: 0,
      problem_items: 0,
      average_prep_seconds: 0,
    };
    const deviceSummary = devices || { paired_devices: 0, pending_devices: 0, stale_devices: 0, last_seen_at: null };

    res.json({
      restaurant: await loadRestaurantSnapshot(restaurantId),
      range: {
        days,
        label: `${days} day${days === 1 ? '' : 's'}`,
        timezone,
      },
      today,
      activeOrders,
      topItems,
      inventory: inventorySummary,
      support: supportSummary,
      staff,
      reporting: {
        orders: orderMetrics || {
          order_count: 0,
          sales_cents: 0,
          tips_cents: 0,
          average_ticket_cents: 0,
          cancelled_orders: 0,
          refunded_orders: 0,
          delivery_orders: 0,
          pickup_orders: 0,
          dine_in_orders: 0,
          in_store_orders: 0,
          online_orders: 0,
        },
        orderBreakdown,
        kitchen: kitchenSummary,
        runner: runnerSummary,
        devices: deviceSummary,
      },
      alerts: {
        delayedOrders: activeDelayedOrders,
        lowStockItems: inventorySummary.low_stock_items,
        openCases: supportSummary.open_cases,
        escalatedCases: supportSummary.escalated_cases,
        kitchenDelayedItems: kitchenSummary.delayed_items,
        kitchenProblemItems: kitchenSummary.problem_items,
        runnerIssueTasks: runnerSummary.issue_tasks,
        staleDevices: deviceSummary.stale_devices,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updatePublishing = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const allowedStatus = new Set(['draft', 'active', 'paused']);
    const status = normalizeString(req.body.status, 24);
    if (status && !allowedStatus.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Status must be draft, active, or paused' });
    }

    const rawFulfillmentModes = req.body.fulfillmentModes ?? req.body.fulfillment_modes;
    let fulfillmentModes = null;
    if (rawFulfillmentModes !== undefined) {
      if (!Array.isArray(rawFulfillmentModes) || !rawFulfillmentModes.length) {
        throw new AppError('Validation failed', 400, 'validation_failed', { fulfillmentModes: 'Select at least one fulfillment mode' });
      }
      fulfillmentModes = rawFulfillmentModes.map((mode) => normalizeString(mode, 24));
      const invalidMode = fulfillmentModes.find((mode) => !FULFILLMENT.has(mode));
      if (invalidMode) {
        throw new AppError('Validation failed', 400, 'validation_failed', { fulfillmentModes: `Unsupported mode: ${invalidMode}` });
      }
      fulfillmentModes = Array.from(new Set(fulfillmentModes));
    }
    const acceptsOnlineOrders = parseOptionalBoolean(
      req.body.acceptsOnlineOrders ?? req.body.accepts_online_orders,
      'acceptsOnlineOrders'
    );
    const acceptsInStoreOrders = parseOptionalBoolean(
      req.body.acceptsInStoreOrders ?? req.body.accepts_in_store_orders,
      'acceptsInStoreOrders'
    );
    const kitchenDisplayEnabled = parseOptionalBoolean(
      req.body.kitchenDisplayEnabled ?? req.body.kitchen_display_enabled,
      'kitchenDisplayEnabled'
    );
    const prepTimeMin = parseOptionalInteger(req.body.prepTimeMin ?? req.body.prep_time_min, 'prepTimeMin', 1, 240);
    const deliveryRadiusMeters = parseOptionalInteger(
      req.body.deliveryRadiusMeters ?? req.body.delivery_radius_meters,
      'deliveryRadiusMeters',
      0,
      500000
    );
    const taxRateBps = parseOptionalInteger(req.body.taxRateBps ?? req.body.tax_rate_bps, 'taxRateBps', 0, 10000);
    const serviceFeeBps = parseOptionalInteger(req.body.serviceFeeBps ?? req.body.service_fee_bps, 'serviceFeeBps', 0, 10000);
    const topLevelLatitude = req.body.latitude === undefined || req.body.latitude === null || req.body.latitude === ''
      ? null
      : parseFiniteNumber(req.body.latitude, 'latitude');
    const topLevelLongitude = req.body.longitude === undefined || req.body.longitude === null || req.body.longitude === ''
      ? null
      : parseFiniteNumber(req.body.longitude, 'longitude');
    if (topLevelLatitude !== null && (topLevelLatitude < -90 || topLevelLatitude > 90)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { latitude: 'Must be between -90 and 90' });
    }
    if (topLevelLongitude !== null && (topLevelLongitude < -180 || topLevelLongitude > 180)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { longitude: 'Must be between -180 and 180' });
    }
    const settingsPatch = safeJson(req.body.settings, null);
    const operatingHours = safeJson(req.body.operatingHours ?? req.body.operating_hours, null);
    const locationPatch = normalizeLocationPatch(req.body.primaryLocation || req.body.primary_location || req.body.location);
    if (locationPatch?.status && !['active', 'paused', 'closed'].includes(locationPatch.status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { locationStatus: 'Status must be active, paused, or closed' });
    }
    if (locationPatch?.latitude !== null && (locationPatch.latitude < -90 || locationPatch.latitude > 90)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { latitude: 'Must be between -90 and 90' });
    }
    if (locationPatch?.longitude !== null && (locationPatch.longitude < -180 || locationPatch.longitude > 180)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { longitude: 'Must be between -180 and 180' });
    }

    const pauseReasonProvided = Object.prototype.hasOwnProperty.call(req.body, 'onlineOrderPauseReason')
      || Object.prototype.hasOwnProperty.call(req.body, 'online_order_pause_reason');

    const result = await withTransaction(pool, async (client) => {
      const addressStreet = locationPatch?.addressStreet ?? normalizeString(req.body.addressStreet ?? req.body.address_street, 255);
      const addressCity = locationPatch?.addressCity ?? normalizeString(req.body.addressCity ?? req.body.address_city, 120);
      const addressState = locationPatch?.addressState ?? normalizeString(req.body.addressState ?? req.body.address_state, 120);
      const addressZip = locationPatch?.addressZip ?? normalizeString(req.body.addressZip ?? req.body.address_zip, 40);
      const addressCountry = locationPatch?.addressCountry ?? normalizeCountry(req.body.addressCountry ?? req.body.address_country);
      const latitude = locationPatch?.latitude ?? topLevelLatitude;
      const longitude = locationPatch?.longitude ?? topLevelLongitude;
      const timezone = locationPatch?.timezone ?? normalizeString(req.body.timezone, 80);

      const { rows: [updated] } = await client.query(
        `UPDATE food_restaurants
            SET status = COALESCE($1, status),
                accepts_online_orders = COALESCE($2, accepts_online_orders),
                accepts_in_store_orders = COALESCE($3, accepts_in_store_orders),
                kitchen_display_enabled = COALESCE($4, kitchen_display_enabled),
                fulfillment_modes = COALESCE($5, fulfillment_modes),
                prep_time_min = COALESCE($6, prep_time_min),
                delivery_radius_meters = COALESCE($7, delivery_radius_meters),
                tax_rate_bps = COALESCE($8, tax_rate_bps),
                service_fee_bps = COALESCE($9, service_fee_bps),
                online_order_pause_reason = CASE WHEN $10 = TRUE THEN $11 ELSE online_order_pause_reason END,
                settings = CASE WHEN $12::jsonb IS NULL THEN settings ELSE settings || $12::jsonb END,
                operating_hours = CASE WHEN $13::jsonb IS NULL THEN operating_hours ELSE $13::jsonb END,
                timezone = COALESCE($14, timezone),
                currency_code = COALESCE($15, currency_code),
                address_street = COALESCE($16, address_street),
                address_city = COALESCE($17, address_city),
                address_state = COALESCE($18, address_state),
                address_zip = COALESCE($19, address_zip),
                address_country = COALESCE($20, address_country),
                latitude = COALESCE($21, latitude),
                longitude = COALESCE($22, longitude),
                updated_at = NOW()
          WHERE id = $23
          RETURNING *`,
        [
          status,
          acceptsOnlineOrders,
          acceptsInStoreOrders,
          kitchenDisplayEnabled,
          fulfillmentModes,
          prepTimeMin,
          deliveryRadiusMeters,
          taxRateBps,
          serviceFeeBps,
          pauseReasonProvided,
          normalizeString(req.body.onlineOrderPauseReason ?? req.body.online_order_pause_reason, 1000),
          settingsPatch ? JSON.stringify(settingsPatch) : null,
          operatingHours ? JSON.stringify(operatingHours) : null,
          timezone,
          normalizeCurrency(req.body.currencyCode ?? req.body.currency_code),
          addressStreet,
          addressCity,
          addressState,
          addressZip,
          addressCountry,
          latitude,
          longitude,
          restaurantId,
        ]
      );

      let primaryLocation = null;
      if (locationPatch) {
        let existingPrimary = null;
        if (!locationPatch.id) {
          const { rows: [row] } = await client.query(
            `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND is_primary = TRUE LIMIT 1`,
            [restaurantId]
          );
          existingPrimary = row || null;
        }
        if (locationPatch.isPrimary !== false) {
          await client.query(
            `UPDATE restaurant_locations SET is_primary = FALSE, updated_at = NOW() WHERE restaurant_id = $1`,
            [restaurantId]
          );
        }
        const locationValues = [
          restaurantId,
          locationPatch.name || updated.display_name || 'Primary location',
          locationPatch.addressStreet,
          locationPatch.addressCity,
          locationPatch.addressState,
          locationPatch.addressZip,
          locationPatch.addressCountry,
          locationPatch.latitude,
          locationPatch.longitude,
          locationPatch.timezone || updated.timezone,
          locationPatch.phone || updated.phone,
          locationPatch.isPrimary !== false,
          locationPatch.status,
          locationPatch.operatingHours ? JSON.stringify(locationPatch.operatingHours) : JSON.stringify(operatingHours || {}),
        ];
        if (locationPatch.id) {
          const { rows: [location] } = await client.query(
            `UPDATE restaurant_locations
                SET name = COALESCE($2, name),
                    address_street = COALESCE($3, address_street),
                    address_city = COALESCE($4, address_city),
                    address_state = COALESCE($5, address_state),
                    address_zip = COALESCE($6, address_zip),
                    address_country = COALESCE($7, address_country),
                    latitude = COALESCE($8, latitude),
                    longitude = COALESCE($9, longitude),
                    timezone = COALESCE($10, timezone),
                    phone = COALESCE($11, phone),
                    is_primary = COALESCE($12, is_primary),
                    status = COALESCE($13, status),
                    operating_hours = CASE WHEN $14::jsonb = '{}'::jsonb THEN operating_hours ELSE $14::jsonb END,
                    updated_at = NOW()
              WHERE restaurant_id = $1 AND id = $15
              RETURNING *`,
            [...locationValues, locationPatch.id]
          );
          if (!location) throw new AppError('Location not found', 404, 'location_not_found');
          primaryLocation = location || null;
        } else {
          if (existingPrimary) {
            const { rows: [location] } = await client.query(
              `UPDATE restaurant_locations
                  SET name = COALESCE($2, name),
                      address_street = COALESCE($3, address_street),
                      address_city = COALESCE($4, address_city),
                      address_state = COALESCE($5, address_state),
                      address_zip = COALESCE($6, address_zip),
                      address_country = COALESCE($7, address_country),
                      latitude = COALESCE($8, latitude),
                      longitude = COALESCE($9, longitude),
                      timezone = COALESCE($10, timezone),
                      phone = COALESCE($11, phone),
                      is_primary = COALESCE($12, is_primary),
                      status = COALESCE($13, status),
                      operating_hours = CASE WHEN $14::jsonb = '{}'::jsonb THEN operating_hours ELSE $14::jsonb END,
                      updated_at = NOW()
                WHERE restaurant_id = $1 AND id = $15
                RETURNING *`,
              [...locationValues, existingPrimary.id]
            );
            primaryLocation = location || null;
          } else {
            const { rows: [location] } = await client.query(
              `INSERT INTO restaurant_locations
                 (restaurant_id, name, address_street, address_city, address_state, address_zip,
                  address_country, latitude, longitude, timezone, phone, is_primary, status, operating_hours)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,'active'),$14)
               RETURNING *`,
              locationValues
            );
            primaryLocation = location || null;
          }
        }
      }

      return { restaurant: updated, primaryLocation };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.getPublishing = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const [{ rows: [publishing] }, { rows: locations }] = await Promise.all([
      pool.query(
        `SELECT id, business_id, display_name, status, accepts_online_orders,
                accepts_in_store_orders, kitchen_display_enabled, fulfillment_modes,
                prep_time_min, delivery_radius_meters, tax_rate_bps, service_fee_bps,
                online_order_pause_reason, operating_hours, timezone, currency_code,
                address_street, address_city, address_state, address_zip, address_country,
                latitude, longitude, settings, updated_at
           FROM food_restaurants WHERE id = $1`,
        [restaurantId]
      ),
      pool.query(
        `SELECT * FROM restaurant_locations
          WHERE restaurant_id = $1
          ORDER BY is_primary DESC, name ASC`,
        [restaurantId]
      ),
    ]);
    res.json({ publishing, locations, primaryLocation: locations.find((location) => location.is_primary) || locations[0] || null });
  } catch (err) {
    next(err);
  }
};

function validateManagedLocation(location) {
  if (location.status && !['active', 'paused', 'closed'].includes(location.status)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Must be active, paused, or closed' });
  }
  if (location.latitude !== null && (location.latitude < -90 || location.latitude > 90)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { latitude: 'Must be between -90 and 90' });
  }
  if (location.longitude !== null && (location.longitude < -180 || location.longitude > 180)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { longitude: 'Must be between -180 and 180' });
  }
  if (location.addressCountry && !/^[A-Z]{2}$/.test(location.addressCountry)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { addressCountry: 'Must be a two-letter country code' });
  }
  if (location.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: location.timezone }).format();
    } catch (err) {
      throw new AppError('Validation failed', 400, 'validation_failed', { timezone: 'Must be a valid IANA timezone' });
    }
  }
}

exports.createRestaurantLocation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const location = normalizeLocationPatch(req.body);
    if (!location?.name) {
      throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Location name is required' });
    }
    validateManagedLocation(location);
    const isPrimaryProvided = Object.prototype.hasOwnProperty.call(req.body, 'isPrimary')
      || Object.prototype.hasOwnProperty.call(req.body, 'is_primary');
    const result = await withTransaction(pool, async (client) => {
      const { rows: [countRow] } = await client.query(
        `SELECT COUNT(*)::int AS count FROM restaurant_locations WHERE restaurant_id = $1`,
        [restaurantId]
      );
      const isPrimary = Number(countRow.count || 0) === 0
        ? true
        : isPrimaryProvided
          ? location.isPrimary === true
          : false;
      if (isPrimary) {
        await client.query(
          `UPDATE restaurant_locations SET is_primary = FALSE, updated_at = NOW() WHERE restaurant_id = $1`,
          [restaurantId]
        );
      }
      const { rows: [created] } = await client.query(
        `INSERT INTO restaurant_locations
           (restaurant_id, name, address_street, address_city, address_state, address_zip,
            address_country, latitude, longitude, timezone, phone, is_primary, status, operating_hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          restaurantId,
          location.name,
          location.addressStreet,
          location.addressCity,
          location.addressState,
          location.addressZip,
          location.addressCountry || 'US',
          location.latitude,
          location.longitude,
          location.timezone || restaurant.timezone || 'UTC',
          location.phone,
          isPrimary,
          location.status || 'active',
          JSON.stringify(location.operatingHours || {}),
        ]
      );
      const { rows: locations } = await client.query(
        `SELECT * FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY is_primary DESC, name ASC`,
        [restaurantId]
      );
      return { location: created, locations };
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.updateRestaurantLocation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const locationId = parsePositiveInt(req.params.locationId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const normalized = normalizeLocationPatch(req.body);
    validateManagedLocation(normalized);
    const fields = [
      ['name', 'name', 160, 'string'],
      ['addressStreet', 'address_street', 255, 'string'],
      ['addressCity', 'address_city', 120, 'string'],
      ['addressState', 'address_state', 120, 'string'],
      ['addressZip', 'address_zip', 40, 'string'],
      ['phone', 'phone', 40, 'string'],
      ['timezone', 'timezone', 80, 'string'],
    ];
    const snakeAliases = {
      addressStreet: 'address_street',
      addressCity: 'address_city',
      addressState: 'address_state',
      addressZip: 'address_zip',
    };
    const sets = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    for (const [camel, column, max] of fields) {
      const snake = snakeAliases[camel] || camel;
      if (Object.prototype.hasOwnProperty.call(req.body, camel) || Object.prototype.hasOwnProperty.call(req.body, snake)) {
        const value = normalizeString(req.body[camel] ?? req.body[snake], max);
        if (camel === 'name' && !value) {
          throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Location name is required' });
        }
        if (camel === 'timezone' && !value) {
          throw new AppError('Validation failed', 400, 'validation_failed', { timezone: 'Timezone cannot be blank' });
        }
        add(column, value);
      }
    }
    const simpleFields = [
      ['status', 'status', normalized.status],
      ['latitude', 'latitude', normalized.latitude],
      ['longitude', 'longitude', normalized.longitude],
    ];
    for (const [key, column, value] of simpleFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) add(column, value);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'addressCountry')
      || Object.prototype.hasOwnProperty.call(req.body, 'address_country')) {
      const country = normalizeCountry(req.body.addressCountry ?? req.body.address_country);
      if (!country || !/^[A-Z]{2}$/.test(country)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { addressCountry: 'Must be a two-letter country code' });
      }
      add('address_country', country);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'operatingHours')
      || Object.prototype.hasOwnProperty.call(req.body, 'operating_hours')) {
      const hours = safeJson(req.body.operatingHours ?? req.body.operating_hours, null);
      if (!hours) throw new AppError('Validation failed', 400, 'validation_failed', { operatingHours: 'Must be an object' });
      add('operating_hours', JSON.stringify(hours));
    }
    const hasPrimary = Object.prototype.hasOwnProperty.call(req.body, 'isPrimary')
      || Object.prototype.hasOwnProperty.call(req.body, 'is_primary');
    const isPrimary = hasPrimary
      ? parseOptionalBoolean(req.body.isPrimary ?? req.body.is_primary, 'isPrimary')
      : null;
    if (hasPrimary) add('is_primary', isPrimary);
    if (!sets.length) {
      throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT * FROM restaurant_locations WHERE restaurant_id = $1 AND id = $2 FOR UPDATE`,
        [restaurantId, locationId]
      );
      if (!existing) throw new AppError('Location not found', 404, 'location_not_found');
      if (existing.is_primary && hasPrimary && isPrimary === false) {
        throw new AppError('Promote another location before demoting the primary location', 409, 'primary_location_required');
      }
      if (isPrimary === true) {
        await client.query(
          `UPDATE restaurant_locations SET is_primary = FALSE, updated_at = NOW()
            WHERE restaurant_id = $1 AND id <> $2`,
          [restaurantId, locationId]
        );
      }
      values.push(restaurantId, locationId);
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_locations
            SET ${sets.join(', ')}, updated_at = NOW()
          WHERE restaurant_id = $${values.length - 1} AND id = $${values.length}
          RETURNING *`,
        values
      );
      const { rows: locations } = await client.query(
        `SELECT * FROM restaurant_locations WHERE restaurant_id = $1 ORDER BY is_primary DESC, name ASC`,
        [restaurantId]
      );
      return { location: updated, locations };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

function createPairingCode() {
  return crypto.randomBytes(6).toString('hex').toUpperCase();
}

function publicDevice(device) {
  if (!device) return device;
  const { device_token_hash: _tokenHash, pairing_code: _pairingCode, ...safe } = device;
  return {
    ...safe,
    deviceId: safe.id,
    restaurantId: safe.restaurant_id,
    appKey: safe.app_key,
    deviceName: safe.device_name,
    locationId: safe.location_id,
    lastSeenAt: safe.last_seen_at,
    lastKitchenEventId: safe.last_kitchen_event_id,
    lastSyncAt: safe.last_sync_at,
    syncStatus: safe.sync_status,
    syncError: safe.sync_error,
    configVersion: safe.config_version,
    pairingCodeExpiresAt: safe.pairing_code_expires_at,
    pairedAt: safe.paired_at,
    appVersion: safe.app_version,
  };
}

function deviceRouteContract(device, options = {}) {
  if (!device) return null;
  const restaurantId = Number(device.restaurant_id || device.restaurant?.id || options.restaurantId);
  const deviceId = Number(device.id);
  const appKey = device.app_key;
  const base = `/api/restaurants/${restaurantId}`;
  const contract = {
    version: 1,
    workspace: {
      type: 'restaurant',
      restaurantId,
      locationId: device.location_id || null,
      appKey,
    },
    device: {
      id: deviceId,
      appKey,
      status: device.status,
      configVersion: Number(device.config_version || 1),
    },
    auth: {
      header: 'X-Device-Token',
      tokenType: 'paired_device_token',
    },
    routes: {
      heartbeat: `${base}/devices/${deviceId}/heartbeat`,
      runtimeConfig: `${base}/devices/${deviceId}/runtime-config`,
    },
    polling: {
      heartbeatAfterMs: 30000,
      configPollAfterMs: 300000,
    },
  };
  if (appKey === 'kitchen') {
    contract.routes.kitchenFeed = `${base}/devices/${deviceId}/kitchen-feed`;
    contract.routes.kitchenFeedAck = `${base}/devices/${deviceId}/kitchen-feed/ack`;
    contract.polling.kitchenFeedAfterMs = 2000;
  }
  if (appKey === 'display') {
    contract.routes.queueBoard = `${base}/devices/${deviceId}/queue-board`;
    contract.routes.publicQueueBoard = `/api/food/restaurants/${restaurantId}/queue-board`;
    contract.polling.queueBoardAfterMs = 2000;
  }
  return contract;
}

function deviceTokenFromRequest(req) {
  return normalizeString(req.get('X-Device-Token') || req.body?.deviceToken || req.body?.device_token, 200);
}

async function requireDeviceCredential(req, restaurantId, deviceId) {
  const token = deviceTokenFromRequest(req);
  if (!token) throw new AppError('Device credential is required', 401, 'device_credential_required');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows: [device] } = await pool.query(
    `SELECT *
       FROM restaurant_app_devices
      WHERE id = $1
        AND restaurant_id = $2
        AND status = 'paired'
        AND device_token_hash = $3`,
    [deviceId, restaurantId, tokenHash]
  );
  if (!device) throw new AppError('Device credential is invalid', 401, 'invalid_device_credential');
  return device;
}

function assertDeviceApp(device, appKey) {
  if (!device || device.app_key !== appKey) {
    throw new AppError(`${appKey} device credential is required`, 403, `${appKey}_device_required`);
  }
}

function queueGuestLabel(row) {
  if (row.table_label) return row.table_label;
  if (row.fulfillment_type === 'dine_in') return 'Dine-in';
  if (row.fulfillment_type === 'delivery') return 'Delivery';
  return 'Pickup';
}

async function buildQueueBoardPayload(restaurantId, device = null) {
  const { rows: restaurants } = await pool.query(
    `SELECT id, display_name, logo_url, timezone, kitchen_display_enabled
       FROM food_restaurants
      WHERE id = $1 AND status IN ('active','paused')`,
    [restaurantId]
  );
  const restaurant = restaurants[0];
  if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const timezone = normalizeString(restaurant.timezone, 80) || 'UTC';
  const { rows } = await pool.query(
    `SELECT queue_number, status, table_label, fulfillment_type, promised_at, updated_at
       FROM food_orders
      WHERE restaurant_id = $1
        AND (created_at AT TIME ZONE $2)::date = (NOW() AT TIME ZONE $2)::date
        AND status IN ('received','accepted','preparing','ready')
      ORDER BY queue_number ASC`,
    [restaurantId, timezone]
  );
  const preparingRows = rows.filter((row) => row.status !== 'ready');
  const readyRows = rows.filter((row) => row.status === 'ready');
  const toEntry = (row) => ({
    queueNumber: row.queue_number,
    queue_number: row.queue_number,
    status: row.status,
    guestLabel: queueGuestLabel(row),
    fulfillmentType: row.fulfillment_type,
    fulfillment_type: row.fulfillment_type,
    promisedAt: row.promised_at,
    promised_at: row.promised_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  });
  return {
    restaurant,
    preparing: preparingRows.map((row) => row.queue_number),
    ready: readyRows.map((row) => row.queue_number),
    preparingEntries: preparingRows.map(toEntry),
    readyEntries: readyRows.map(toEntry),
    serverTime: new Date().toISOString(),
    nextPollAfterMs: rows.length ? 2000 : 5000,
    contract: device ? deviceRouteContract(device, { restaurantId }) : null,
    device: device ? publicDevice(device) : null,
  };
}

exports.createDevicePairingCode = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const appKey = normalizeString(req.body.appKey || req.body.app_key, 32);
    if (!APP_KEYS.has(appKey)) throw new AppError('Validation failed', 400, 'validation_failed', { appKey: 'Unsupported app key' });
    const deviceName = normalizeString(req.body.deviceName || req.body.device_name, 160) || `${appKey} device`;
    const locationId = parsePositiveInt(req.body.locationId || req.body.location_id);
    if (locationId) {
      const { rows: [location] } = await pool.query(
        `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND id = $2`,
        [restaurantId, locationId]
      );
      if (!location) throw new AppError('Location not found', 404, 'location_not_found');
    }
    const code = createPairingCode();
    const { rows: [device] } = await pool.query(
      `INSERT INTO restaurant_app_devices
         (restaurant_id, app_key, device_name, mode, location_id, pairing_code,
          pairing_code_expires_at, config)
       VALUES ($1,$2,$3,$4,$5,$6,NOW() + INTERVAL '15 minutes',$7)
       RETURNING *`,
      [
        restaurantId,
        appKey,
        deviceName,
        normalizeString(req.body.mode, 64),
        locationId,
        code,
        JSON.stringify(safeJson(req.body.config)),
      ]
    );
    res.status(201).json({
      device: publicDevice(device),
      contract: deviceRouteContract(device, { restaurantId }),
      pairingCode: code,
      pairing_code: code,
      pairingCodeExpiresAt: device.pairing_code_expires_at,
      pairing_code_expires_at: device.pairing_code_expires_at,
    });
  } catch (err) {
    next(err);
  }
};

exports.pairDevice = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const code = normalizeString(req.body.pairingCode || req.body.pairing_code, 24);
    if (!code) throw new AppError('Validation failed', 400, 'validation_failed', { pairingCode: 'Pairing code is required' });
    const deviceToken = crypto.randomBytes(32).toString('base64url');
    const deviceTokenHash = crypto.createHash('sha256').update(deviceToken).digest('hex');
    const { rows: [device] } = await pool.query(
      `UPDATE restaurant_app_devices
          SET status = 'paired',
              paired_at = NOW(),
              last_seen_at = NOW(),
              pairing_code = NULL,
              pairing_code_expires_at = NULL,
              device_token_hash = $3,
              app_version = COALESCE($4, app_version),
              platform = COALESCE($5, platform),
              updated_at = NOW()
        WHERE restaurant_id = $1
          AND pairing_code = $2
          AND status = 'pending'
          AND (pairing_code_expires_at IS NULL OR pairing_code_expires_at > NOW())
        RETURNING *`,
      [
        restaurantId,
        code.toUpperCase(),
        deviceTokenHash,
        normalizeString(req.body.appVersion || req.body.app_version, 80),
        normalizeString(req.body.platform, 80),
      ]
    );
    if (!device) throw new AppError('Pairing code not found', 404, 'pairing_code_not_found');
    res.json({
      device: publicDevice(device),
      contract: deviceRouteContract(device, { restaurantId }),
      deviceToken,
      device_token: deviceToken,
    });
  } catch (err) {
    next(err);
  }
};

exports.deviceHeartbeat = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const deviceId = parsePositiveInt(req.params.deviceId || req.body.deviceId || req.body.device_id);
    await requireDeviceCredential(req, restaurantId, deviceId);
    const clientConfigVersion = parsePositiveInt(req.body.configVersion || req.body.config_version, 0) || 0;
    const kitchenCursor = parsePositiveInt(
      req.body.kitchenCursor || req.body.kitchen_cursor || req.body.lastKitchenEventId || req.body.last_kitchen_event_id,
      null
    );
    const syncStatus = normalizeString(req.body.syncStatus || req.body.sync_status, 24);
    if (syncStatus && !DEVICE_SYNC_STATUSES.has(syncStatus)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { syncStatus: 'Unsupported sync status' });
    }
    const { rows: [device] } = await pool.query(
      `UPDATE restaurant_app_devices
          SET last_seen_at = NOW(),
              telemetry = CASE WHEN $1::jsonb IS NULL THEN telemetry ELSE telemetry || $1::jsonb END,
              last_kitchen_event_id = CASE
                WHEN $2::bigint IS NULL OR app_key <> 'kitchen' THEN last_kitchen_event_id
                ELSE GREATEST(
                  last_kitchen_event_id,
                  LEAST($2, COALESCE((
                    SELECT MAX(e.id)
                      FROM restaurant_kitchen_events e
                     WHERE e.restaurant_id = $8
                  ), 0))
                )
              END,
              last_sync_at = CASE WHEN $2::bigint IS NOT NULL THEN NOW() ELSE last_sync_at END,
              sync_status = COALESCE($3, sync_status),
              sync_error = CASE
                WHEN $3 = 'healthy' THEN NULL
                WHEN $4 IS NOT NULL THEN $4
                ELSE sync_error
              END,
              app_version = COALESCE($5, app_version),
              platform = COALESCE($6, platform),
              updated_at = NOW()
        WHERE id = $7 AND restaurant_id = $8 AND status = 'paired'
        RETURNING *`,
      [
        req.body.telemetry ? JSON.stringify(safeJson(req.body.telemetry)) : null,
        kitchenCursor,
        syncStatus,
        normalizeString(req.body.syncError || req.body.sync_error, 1000),
        normalizeString(req.body.appVersion || req.body.app_version, 80),
        normalizeString(req.body.platform, 80),
        deviceId,
        restaurantId,
      ]
    );
    if (!device) throw new AppError('Device credential is missing or invalid', 401, 'invalid_device_credential');
    res.json({
      device: publicDevice(device),
      contract: deviceRouteContract(device, { restaurantId }),
      configChanged: Number(device.config_version || 1) > clientConfigVersion,
      config_changed: Number(device.config_version || 1) > clientConfigVersion,
      nextHeartbeatAfterMs: 30000,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

exports.getDeviceRuntimeConfig = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const deviceId = parsePositiveInt(req.params.deviceId);
    await requireDeviceCredential(req, restaurantId, deviceId);
    const { rows: [device] } = await pool.query(
      `SELECT d.*,
              row_to_json(l.*) AS location,
              jsonb_build_object(
                'id', fr.id,
                'display_name', fr.display_name,
                'status', fr.status,
                'fulfillment_modes', fr.fulfillment_modes,
                'accepts_online_orders', fr.accepts_online_orders,
                'accepts_in_store_orders', fr.accepts_in_store_orders,
                'kitchen_display_enabled', fr.kitchen_display_enabled,
                'prep_time_min', fr.prep_time_min,
                'currency_code', fr.currency_code,
                'timezone', fr.timezone
              ) AS restaurant
         FROM restaurant_app_devices d
         JOIN food_restaurants fr ON fr.id = d.restaurant_id
         LEFT JOIN restaurant_locations l
           ON l.id = d.location_id AND l.restaurant_id = d.restaurant_id
        WHERE d.restaurant_id = $1 AND d.id = $2 AND d.status = 'paired'`,
      [restaurantId, deviceId]
    );
    if (!device) throw new AppError('Device not found', 404, 'device_not_found');
    res.json({
      device: publicDevice(device),
      contract: deviceRouteContract(device, { restaurantId }),
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
};

exports.updateDeviceConfig = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const deviceId = parsePositiveInt(req.params.deviceId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const locationId = parsePositiveInt(req.body.locationId || req.body.location_id);
    if (locationId) {
      const { rows: [location] } = await pool.query(
        `SELECT id FROM restaurant_locations WHERE restaurant_id = $1 AND id = $2`,
        [restaurantId, locationId]
      );
      if (!location) throw new AppError('Location not found', 404, 'location_not_found');
    }
    const status = normalizeString(req.body.status, 24);
    if (status && !DEVICE_STATUSES.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported device status' });
    }
    const hasConfig = req.body.config && typeof req.body.config === 'object' && !Array.isArray(req.body.config);
    const replaceConfig = asBool(req.body.replaceConfig || req.body.replace_config, false);
    const { rows: [device] } = await pool.query(
      `UPDATE restaurant_app_devices
          SET device_name = COALESCE($1, device_name),
              mode = COALESCE($2, mode),
              location_id = COALESCE($3, location_id),
              status = COALESCE($4, status),
              config = CASE
                WHEN $5::jsonb IS NULL THEN config
                WHEN $6 = TRUE THEN $5::jsonb
                ELSE config || $5::jsonb
              END,
              config_version = config_version + 1,
              updated_at = NOW()
        WHERE restaurant_id = $7 AND id = $8
        RETURNING *`,
      [
        normalizeString(req.body.deviceName || req.body.device_name, 160),
        normalizeString(req.body.mode, 64),
        locationId,
        status,
        hasConfig ? JSON.stringify(safeJson(req.body.config)) : null,
        replaceConfig,
        restaurantId,
        deviceId,
      ]
    );
    if (!device) throw new AppError('Device not found', 404, 'device_not_found');
    res.json({ device: publicDevice(device), contract: deviceRouteContract(device, { restaurantId }) });
  } catch (err) {
    next(err);
  }
};

exports.getDeviceConfig = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const deviceId = parsePositiveInt(req.params.deviceId);
    const { rows: [device] } = await pool.query(
      `SELECT d.*,
              row_to_json(l.*) AS location,
              jsonb_build_object(
                'id', fr.id,
                'display_name', fr.display_name,
                'status', fr.status,
                'fulfillment_modes', fr.fulfillment_modes,
                'accepts_online_orders', fr.accepts_online_orders,
                'accepts_in_store_orders', fr.accepts_in_store_orders,
                'kitchen_display_enabled', fr.kitchen_display_enabled,
                'prep_time_min', fr.prep_time_min,
                'currency_code', fr.currency_code,
                'timezone', fr.timezone
              ) AS restaurant
         FROM restaurant_app_devices d
         JOIN food_restaurants fr ON fr.id = d.restaurant_id
         LEFT JOIN restaurant_locations l
           ON l.id = d.location_id AND l.restaurant_id = d.restaurant_id
        WHERE d.restaurant_id = $1 AND d.id = $2`,
      [restaurantId, deviceId]
    );
    if (!device) throw new AppError('Device not found', 404, 'device_not_found');
    res.json({ device: publicDevice(device), contract: deviceRouteContract(device, { restaurantId }) });
  } catch (err) {
    next(err);
  }
};

exports.getDeviceQueueBoard = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const deviceId = parsePositiveInt(req.params.deviceId);
    const device = await requireDeviceCredential(req, restaurantId, deviceId);
    assertDeviceApp(device, 'display');
    const payload = await buildQueueBoardPayload(restaurantId, device);
    res.json(payload);
  } catch (err) {
    next(err);
  }
};

async function requireOpenPosShift(client, restaurantId, shiftId, userId, canManage) {
  if (!shiftId) throw new AppError('An open POS shift is required', 409, 'open_pos_shift_required');
  const { rows: [shift] } = await client.query(
    `SELECT * FROM restaurant_pos_shifts
      WHERE id = $1 AND restaurant_id = $2 AND status = 'open'`,
    [shiftId, restaurantId]
  );
  if (!shift) throw new AppError('Open POS shift not found', 409, 'open_pos_shift_required');
  if (!canManage && String(shift.staff_user_id) !== String(userId)) {
    throw new AppError('This POS shift belongs to another staff member', 403, 'pos_shift_not_owned');
  }
  return shift;
}

exports.openShift = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const staffUserId = req.body.staffUserId || req.body.staff_user_id || req.user.id;
    if (!MANAGE_ROLES.has(restaurant.effective_role) && String(staffUserId) !== String(req.user.id)) {
      throw new AppError('Only a manager can open a shift for another staff member', 403, 'forbidden');
    }
    try {
      await requireRestaurantAccess(staffUserId, restaurantId);
    } catch (err) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        staffUserId: 'Staff member must be active at this restaurant',
      });
    }
    const { rows: [shift] } = await pool.query(
      `INSERT INTO restaurant_pos_shifts
         (restaurant_id, staff_user_id, staff_label, drawer_name, opening_cash_cents, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (restaurant_id, staff_user_id)
         WHERE status = 'open' AND staff_user_id IS NOT NULL
       DO NOTHING
       RETURNING *`,
      [
        restaurantId,
        staffUserId,
        normalizeString(req.body.staffLabel || req.body.staff_label, 160),
        normalizeString(req.body.drawerName || req.body.drawer_name, 120),
        parseCents(req.body.openingCashCents ?? req.body.opening_cash_cents, 'openingCashCents'),
        safeJson(req.body.metadata),
      ]
    );
    if (!shift) throw new AppError('Staff member already has an open POS shift', 409, 'pos_shift_already_open');
    res.status(201).json({ shift });
  } catch (err) {
    next(err);
  }
};

exports.closeShift = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const shiftId = parsePositiveInt(req.params.shiftId);
    const closingCashCents = parseCents(req.body.closingCashCents ?? req.body.closing_cash_cents, 'closingCashCents');
    const result = await withTransaction(pool, async (client) => {
      const { rows: [currentShift] } = await client.query(
        `SELECT * FROM restaurant_pos_shifts
          WHERE id = $1 AND restaurant_id = $2 AND status = 'open'
            AND (staff_user_id = $3 OR $4 = TRUE)
          FOR UPDATE`,
        [shiftId, restaurantId, req.user.id, MANAGE_ROLES.has(restaurant.effective_role)]
      );
      if (!currentShift) throw new AppError('Open shift not found', 404, 'shift_not_found');

      const { rows: [summary] } = await client.query(
        `SELECT COALESCE(SUM(p.amount_cents) FILTER (
                        WHERE p.payment_type = 'cash' AND p.status IN ('recorded','captured')
                      ), 0)::int AS cash_payments_cents,
                COALESCE(SUM(p.amount_cents) FILTER (
                        WHERE p.payment_type <> 'refund' AND p.status IN ('recorded','captured')
                      ), 0)::int AS settled_payments_cents,
                COALESCE(SUM(p.amount_cents) FILTER (
                        WHERE p.payment_type = 'refund' AND p.status IN ('recorded','captured','refunded')
                      ), 0)::int AS refunds_cents,
                COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending_payments,
                COUNT(DISTINCT p.food_order_id) FILTER (
                  WHERE p.payment_type <> 'refund' AND p.status IN ('recorded','captured')
                )::int AS paid_order_count,
                COALESCE((
                  SELECT SUM(de.amount_cents)
                    FROM restaurant_pos_drawer_events de
                   WHERE de.shift_id = $1
                     AND de.event_type = 'cash_in'
                ), 0)::int AS drawer_cash_in_cents,
                COALESCE((
                  SELECT SUM(de.amount_cents)
                    FROM restaurant_pos_drawer_events de
                   WHERE de.shift_id = $1
                     AND de.event_type IN ('cash_out','cash_drop','payout')
                ), 0)::int AS drawer_cash_out_cents
           FROM restaurant_pos_payments p
          WHERE p.shift_id = $1`,
        [shiftId]
      );
      if (Number(summary.pending_payments || 0) > 0) {
        throw new AppError('Resolve pending POS payments before closing this shift', 409, 'shift_has_pending_payments', {
          pendingPayments: Number(summary.pending_payments),
        });
      }

      const expectedCashCents = Number(currentShift.opening_cash_cents || 0)
        + Number(summary.cash_payments_cents || 0)
        + Number(summary.drawer_cash_in_cents || 0)
        - Number(summary.drawer_cash_out_cents || 0);
      const cashOverShortCents = closingCashCents - expectedCashCents;
      const closeSummary = {
        ...safeJson(req.body.metadata),
        expectedCashCents,
        closingCashCents,
        cashOverShortCents,
        settledPaymentsCents: Number(summary.settled_payments_cents || 0),
        refundsCents: Number(summary.refunds_cents || 0),
        paidOrderCount: Number(summary.paid_order_count || 0),
        closedBy: req.user.id,
      };
      const { rows: [shift] } = await client.query(
        `UPDATE restaurant_pos_shifts
            SET status = 'closed',
                closing_cash_cents = $1,
                closed_at = NOW(),
                metadata = metadata || $2::jsonb
          WHERE id = $3 AND restaurant_id = $4
          RETURNING *`,
        [closingCashCents, JSON.stringify(closeSummary), shiftId, restaurantId]
      );
      return { shift, summary: closeSummary };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.listShifts = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const limit = Math.min(parsePositiveInt(req.query.limit, 50), 100);
    const { rows: shifts } = await pool.query(
      `SELECT s.*,
              COALESCE((
                SELECT SUM(p.amount_cents)
                  FROM restaurant_pos_payments p
                 WHERE p.shift_id = s.id
                   AND p.payment_type <> 'refund'
                   AND p.status IN ('recorded','captured')
              ), 0)::int AS payments_cents,
              COALESCE((
                SELECT SUM(p.amount_cents)
                  FROM restaurant_pos_payments p
                 WHERE p.shift_id = s.id
                   AND p.payment_type = 'refund'
                   AND p.status IN ('recorded','captured','refunded')
              ), 0)::int AS refunds_cents,
              COALESCE((
                SELECT SUM(de.amount_cents)
                  FROM restaurant_pos_drawer_events de
                 WHERE de.shift_id = s.id
                   AND de.event_type = 'cash_in'
              ), 0)::int AS drawer_cash_in_cents,
              COALESCE((
                SELECT SUM(de.amount_cents)
                  FROM restaurant_pos_drawer_events de
                 WHERE de.shift_id = s.id
                   AND de.event_type IN ('cash_out','cash_drop','payout')
              ), 0)::int AS drawer_cash_out_cents,
              (
                SELECT de.amount_cents
                  FROM restaurant_pos_drawer_events de
                 WHERE de.shift_id = s.id
                   AND de.event_type = 'drawer_count'
                 ORDER BY de.created_at DESC, de.id DESC
                 LIMIT 1
              ) AS latest_drawer_count_cents
         FROM restaurant_pos_shifts s
        WHERE s.restaurant_id = $1
        ORDER BY s.opened_at DESC
        LIMIT $2`,
      [restaurantId, limit]
    );
    res.json({ shifts });
  } catch (err) {
    next(err);
  }
};

exports.listDrawerEvents = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const shiftId = parsePositiveInt(req.params.shiftId);
    const limit = Math.min(parsePositiveInt(req.query.limit, 100), 200);
    const { rows: events } = await pool.query(
      `SELECT de.*
         FROM restaurant_pos_drawer_events de
         JOIN restaurant_pos_shifts s ON s.id = de.shift_id
        WHERE de.restaurant_id = $1
          AND de.shift_id = $2
          AND s.restaurant_id = $1
        ORDER BY de.created_at DESC, de.id DESC
        LIMIT $3`,
      [restaurantId, shiftId, limit]
    );
    res.json({ events });
  } catch (err) {
    next(err);
  }
};

exports.recordDrawerEvent = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const shiftId = parsePositiveInt(req.params.shiftId);
    const eventType = normalizeString(req.body.eventType || req.body.event_type, 32);
    if (!POS_DRAWER_EVENT_TYPES.has(eventType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { eventType: 'Unsupported drawer event type' });
    }
    const amountCents = parseCents(req.body.amountCents ?? req.body.amount_cents, 'amountCents');
    const { rows: [event] } = await pool.query(
       `WITH checked_shift AS (
         SELECT id
           FROM restaurant_pos_shifts
          WHERE id = $1
            AND restaurant_id = $2
            AND status = 'open'
            AND (staff_user_id = $9 OR $10 = TRUE)
       )
       INSERT INTO restaurant_pos_drawer_events
         (restaurant_id, shift_id, event_type, amount_cents, reason, note, metadata, created_by)
       SELECT $2, id, $3, $4, $5, $6, $7::jsonb, $8
         FROM checked_shift
       RETURNING *`,
      [
        shiftId,
        restaurantId,
        eventType,
        amountCents,
        normalizeString(req.body.reason, 160),
        normalizeString(req.body.note, 1000),
        JSON.stringify(safeJson(req.body.metadata)),
        req.user.id,
        req.user.id,
        MANAGE_ROLES.has(restaurant.effective_role),
      ]
    );
    if (!event) throw new AppError('Shift not found', 404, 'shift_not_found');
    broadcastRestaurant(restaurant, 'food:pos:drawer:event', { event });
    res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
};

exports.createPosOrder = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length) throw new AppError('Validation failed', 400, 'validation_failed', { items: 'At least one item is required' });
    const source = normalizeString(req.body.orderSource || req.body.order_source, 24) || 'counter';
    if (!ORDER_SOURCES.has(source)) throw new AppError('Validation failed', 400, 'validation_failed', { orderSource: 'Unsupported POS order source' });
    const fulfillment = normalizeString(req.body.fulfillmentType || req.body.fulfillment_type, 24) || 'pickup';
    if (!FULFILLMENT.has(fulfillment)) throw new AppError('Validation failed', 400, 'validation_failed', { fulfillmentType: 'Unsupported fulfillment type' });
    const shiftId = parsePositiveInt(req.body.shiftId || req.body.shift_id);
    if (source !== 'kiosk' && !shiftId) {
      throw new AppError('Counter and tablet orders require an open POS shift', 409, 'open_pos_shift_required');
    }
    const paymentContract = normalizeRestaurantPaymentMode(
      req.body.paymentMode || req.body.payment_mode,
      'pay_at_restaurant'
    );

    const result = await withTransaction(pool, async (client) => {
      if (shiftId) {
        await requireOpenPosShift(client, restaurantId, shiftId, req.user.id, MANAGE_ROLES.has(restaurant.effective_role));
      }
      const { rows: [lockedRestaurant] } = await client.query(
        `SELECT * FROM food_restaurants WHERE id = $1 FOR UPDATE`,
        [restaurantId]
      );
      if (!lockedRestaurant || lockedRestaurant.status !== 'active' || !lockedRestaurant.accepts_in_store_orders) {
        throw new AppError('Restaurant is not accepting in-store orders', 409, 'restaurant_not_accepting_orders');
      }
      if (!Array.isArray(lockedRestaurant.fulfillment_modes)
        || !lockedRestaurant.fulfillment_modes.includes(fulfillment)) {
        throw new AppError('This fulfillment mode is not available', 409, 'fulfillment_mode_unavailable');
      }
      const ids = items.map((item) => parsePositiveInt(item.menuItemId || item.menu_item_id)).filter(Boolean);
      const { rows: menuRows } = await client.query(
        `SELECT id, name, price_cents, currency_code, is_available
           FROM food_menu_items
          WHERE restaurant_id = $1 AND id = ANY($2::bigint[])`,
        [restaurantId, ids]
      );
      const menu = new Map(menuRows.map((row) => [Number(row.id), row]));
      const normalized = items.map((line, index) => {
        const item = menu.get(parsePositiveInt(line.menuItemId || line.menu_item_id));
        if (!item || item.is_available === false) {
          throw new AppError('Validation failed', 400, 'validation_failed', { [`items.${index}.menuItemId`]: 'Menu item is unavailable' });
        }
        const quantity = Math.min(parsePositiveInt(line.quantity, 1), 99);
        const requestedUnitPrice = line.unitPriceCents ?? line.unit_price_cents;
        const unitPrice = parseCents(requestedUnitPrice, 'unitPriceCents', Number(item.price_cents));
        if (requestedUnitPrice !== undefined
          && unitPrice !== Number(item.price_cents)
          && !MANAGE_ROLES.has(restaurant.effective_role)) {
          throw new AppError('Only a manager can override menu prices', 403, 'price_override_forbidden');
        }
        return {
          item,
          quantity,
          unitPrice,
          lineTotal: unitPrice * quantity,
          stationLabel: normalizeString(line.stationLabel || line.station_label, 80),
          specialInstructions: normalizeString(line.specialInstructions || line.special_instructions, 500),
        };
      });
      const subtotal = normalized.reduce((sum, line) => sum + line.lineTotal, 0);
      const tip = parseCents(req.body.tipCents ?? req.body.tip_cents, 'tipCents');
      const discount = parseCents(req.body.discountCents ?? req.body.discount_cents, 'discountCents');
      if (discount > subtotal) {
        throw new AppError('Validation failed', 400, 'validation_failed', { discountCents: 'Cannot exceed subtotal' });
      }
      const taxableSubtotal = Math.max(0, subtotal - discount);
      const taxRateBps = Math.max(0, Math.min(10000, Number(lockedRestaurant.tax_rate_bps || 0)));
      const serviceFeeBps = Math.max(0, Math.min(10000, Number(lockedRestaurant.service_fee_bps || 0)));
      const tax = Math.round(taxableSubtotal * taxRateBps / 10000);
      const serviceFeeCents = Math.round(taxableSubtotal * serviceFeeBps / 10000);
      let deliveryAddress = null;
      let deliveryFeeCents = 0;
      if (fulfillment === 'delivery') {
        const rawAddress = safeJson(req.body.deliveryAddress || req.body.delivery_address, null);
        const line1 = normalizeString(rawAddress?.line1 || rawAddress?.addressLine1 || rawAddress?.street, 255);
        const city = normalizeString(rawAddress?.city, 120);
        if (!line1 || !city) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            deliveryAddress: 'Delivery street and city are required',
          });
        }
        const lat = rawAddress.lat === undefined && rawAddress.latitude === undefined
          ? null
          : parseFiniteNumber(rawAddress.lat ?? rawAddress.latitude, 'deliveryLatitude');
        const lng = rawAddress.lng === undefined && rawAddress.longitude === undefined
          ? null
          : parseFiniteNumber(rawAddress.lng ?? rawAddress.longitude, 'deliveryLongitude');
        if (lat !== null && (lat < -90 || lat > 90)) {
          throw new AppError('Validation failed', 400, 'validation_failed', { deliveryLatitude: 'Must be between -90 and 90' });
        }
        if (lng !== null && (lng < -180 || lng > 180)) {
          throw new AppError('Validation failed', 400, 'validation_failed', { deliveryLongitude: 'Must be between -180 and 180' });
        }
        deliveryAddress = {
          line1,
          line2: normalizeString(rawAddress.line2 || rawAddress.addressLine2, 255),
          city,
          state: normalizeString(rawAddress.state, 120),
          zip: normalizeString(rawAddress.zip || rawAddress.postalCode, 40),
          instructions: normalizeString(rawAddress.instructions, 1000),
          lat,
          lng,
        };
        if (Number(lockedRestaurant.delivery_radius_meters || 0) > 0) {
          if (![lockedRestaurant.latitude, lockedRestaurant.longitude, lat, lng]
            .every((coordinate) => Number.isFinite(Number(coordinate)))) {
            throw new AppError('Delivery coordinates are required to verify the delivery area', 400, 'delivery_coordinates_required');
          }
          const deliveryDistanceMeters = geoDistanceMeters(
            Number(lockedRestaurant.latitude),
            Number(lockedRestaurant.longitude),
            Number(lat),
            Number(lng)
          );
          if (deliveryDistanceMeters > Number(lockedRestaurant.delivery_radius_meters)) {
            throw new AppError('Delivery address is outside this restaurant\'s delivery area', 409, 'outside_delivery_area', {
              deliveryDistanceMeters: Math.round(deliveryDistanceMeters),
              deliveryRadiusMeters: Number(lockedRestaurant.delivery_radius_meters),
            });
          }
          deliveryAddress.distanceMeters = Math.round(deliveryDistanceMeters);
        }
        const publishedSettings = safeJson(lockedRestaurant.settings);
        deliveryFeeCents = parseCents(
          publishedSettings.deliveryFeeCents ?? publishedSettings.delivery_fee_cents,
          'deliveryFeeCents'
        );
      }
      const total = taxableSubtotal + tax + serviceFeeCents + deliveryFeeCents + tip;
      const { rows: queueRows } = await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at::date = CURRENT_DATE`,
        [restaurantId]
      );
      const requestedPaymentStatus = normalizeString(req.body.paymentStatus || req.body.payment_status, 24);
      if (requestedPaymentStatus && requestedPaymentStatus !== 'unpaid') {
        throw new AppError(
          'POS orders become paid only after a payment transaction is recorded',
          409,
          'payment_transaction_required'
        );
      }
      const paymentStatus = 'unpaid';
      const metadata = {
        ...safeJson(req.body.metadata),
        pos: true,
        shiftId,
        clientOrderId: normalizeString(req.body.clientOrderId || req.body.client_order_id, 120),
        paymentMode: paymentContract.legacy,
        payment_mode: paymentContract.legacy,
        restaurantPaymentMode: paymentContract.canonical,
        paymentContract: paymentContractMetadata(paymentContract, {
          source: 'pos_order_create',
          initialPaymentStatus: paymentStatus,
        }),
        ...(deliveryAddress ? { deliveryAddress, deliveryFeeCents } : {}),
        pricing: { taxRateBps, serviceFeeBps, taxCents: tax, serviceFeeCents, deliveryFeeCents },
      };
      const { rows: [order] } = await client.query(
        `INSERT INTO food_orders
           (restaurant_id, business_id, customer_id, guest_name, guest_phone, guest_email,
            order_source, fulfillment_type, payment_status, subtotal_cents, tax_cents,
            service_fee_cents, delivery_fee_cents, tax_rate_bps, service_fee_bps,
            tip_cents, discount_cents, total_cents, currency_code, table_label,
            queue_number, promised_at, notes, metadata)
         VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW() + ($21 || ' minutes')::interval,$22,$23)
         RETURNING *`,
        [
          restaurantId,
          lockedRestaurant.business_id,
          normalizeString(req.body.guestName || req.body.guest_name, 140),
          normalizeString(req.body.guestPhone || req.body.guest_phone, 40),
          normalizeString(req.body.guestEmail || req.body.guest_email, 255),
          source,
          fulfillment,
          paymentStatus,
          subtotal,
          tax,
          serviceFeeCents,
          deliveryFeeCents,
          taxRateBps,
          serviceFeeBps,
          tip,
          discount,
          total,
          lockedRestaurant.currency_code || 'USD',
          normalizeString(req.body.tableLabel || req.body.table_label, 80),
          Number(queueRows[0]?.next_queue || 1),
          lockedRestaurant.prep_time_min || 15,
          normalizeString(req.body.notes, 1000),
          metadata,
        ]
      );
      for (const line of normalized) {
        await client.query(
          `INSERT INTO food_order_items
             (order_id, menu_item_id, item_name, quantity, unit_price_cents, modifier_total_cents, line_total_cents, special_instructions, station_label)
           VALUES ($1,$2,$3,$4,$5,0,$6,$7,$8)`,
          [order.id, line.item.id, line.item.name, line.quantity, line.unitPrice, line.lineTotal, line.specialInstructions, normalizeString(line.stationLabel, 80)]
        );
      }
      const printerJobs = await enqueueKitchenPrinterJobs(client, {
        restaurantId,
        orderId: order.id,
        createdBy: req.user.id,
      });
      const runnerTask = await createPosDeliveryRunnerTask(client, order, deliveryAddress, req.user.id);
      if (shiftId) {
        await insertPosReceiptAudit(client, {
          restaurantId,
          order,
          eventType: 'order_created',
          channel: 'Counter',
          createdBy: req.user.id,
          metadata: {
            shiftId,
            orderSource: source,
            fulfillmentType: fulfillment,
            paymentContract: paymentContractMetadata(paymentContract),
          },
          idempotencyKey: normalizeString(req.body.clientOrderId || req.body.client_order_id, 120)
            ? `pos-order-created:${restaurantId}:${normalizeString(req.body.clientOrderId || req.body.client_order_id, 120)}`
            : null,
        });
      }
      return { order, printerJobs, runnerTask };
    });
    broadcastRestaurant(restaurant, 'food:order:created', result);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.updatePosTicket = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const ticketState = normalizeString(req.body.ticketState || req.body.ticket_state, 24);
    if (!POS_TICKET_STATES.has(ticketState)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { ticketState: 'Unsupported ticket state' });
    }
    if (ticketState === 'refunded') {
      throw new AppError(
        'Refund the original payment through the POS payment endpoint',
        409,
        'refund_requires_payment_transaction'
      );
    }
    if (ticketState === 'closed') {
      throw new AppError('Tickets close automatically after payment', 409, 'payment_transaction_required');
    }
    const allowedCurrentStates = ticketState === 'held'
      ? ['open']
      : ticketState === 'open'
        ? ['open', 'held']
        : ['open', 'held'];
    if (ticketState === 'voided') {
      const { rows: [paymentTotals] } = await pool.query(
        `SELECT COALESCE(SUM(amount_cents) FILTER (
                        WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
                      ), 0)::int
                  - COALESCE(SUM(amount_cents) FILTER (
                        WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')
                      ), 0)::int AS net_paid_cents
           FROM restaurant_pos_payments
          WHERE restaurant_id = $1 AND food_order_id = $2`,
        [restaurantId, orderId]
      );
      if (Number(paymentTotals.net_paid_cents || 0) > 0) {
        throw new AppError(
          'Paid tickets must be refunded before they can be voided',
          409,
          'paid_ticket_requires_refund'
        );
      }
    }
    const status = ticketState === 'voided' ? 'cancelled' : ticketState === 'refunded' ? 'refunded' : null;
    const paymentStatus = ticketState === 'refunded' ? 'refunded' : null;
    const { rows: [order] } = await pool.query(
      `UPDATE food_orders
          SET pos_ticket_state = $1,
              pos_hold_reason = CASE WHEN $1 = 'held' THEN $2 ELSE NULL END,
              status = COALESCE($3, status),
              payment_status = COALESCE($4, payment_status),
              voided_at = CASE WHEN $1 = 'voided' THEN NOW() ELSE voided_at END,
              refunded_at = CASE WHEN $1 = 'refunded' THEN NOW() ELSE refunded_at END,
              updated_at = NOW()
        WHERE id = $5 AND restaurant_id = $6
          AND pos_ticket_state = ANY($7::varchar[])
          AND ($1 <> 'voided' OR NOT EXISTS (
            SELECT 1 FROM restaurant_pos_payments p
             WHERE p.food_order_id = food_orders.id
               AND p.payment_type <> 'refund'
               AND p.status IN ('pending','recorded','captured')
          ))
        RETURNING *`,
      [
        ticketState,
        normalizeString(req.body.reason || req.body.holdReason || req.body.hold_reason, 1000),
        status,
        paymentStatus,
        orderId,
        restaurantId,
        allowedCurrentStates,
      ]
    );
    if (!order) throw new AppError('Ticket transition is no longer allowed', 409, 'illegal_ticket_transition');
    await insertPosReceiptAudit(pool, {
      restaurantId,
      order,
      eventType: ticketState === 'voided'
        ? 'ticket_voided'
        : ticketState === 'held'
          ? 'ticket_held'
          : 'ticket_reopened',
      channel: 'Payment update',
      createdBy: req.user.id,
      reason: normalizeString(req.body.reason || req.body.holdReason || req.body.hold_reason, 1000),
      metadata: {
        ticketState,
        previousAllowedStates: allowedCurrentStates,
      },
      idempotencyKey: normalizeString(
        req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
        200
      ),
    });
    broadcastRestaurant(restaurant, 'food:pos:ticket:updated', { order });
    res.json({ order });
  } catch (err) {
    next(err);
  }
};

exports.splitPosOrder = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const sourceOrderId = parsePositiveInt(req.params.orderId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const itemIds = Array.isArray(req.body.orderItemIds || req.body.order_item_ids)
      ? (req.body.orderItemIds || req.body.order_item_ids).map((id) => parsePositiveInt(id)).filter(Boolean)
      : [];
    if (!itemIds.length) throw new AppError('Validation failed', 400, 'validation_failed', { orderItemIds: 'At least one order item is required' });

    const result = await withTransaction(pool, async (client) => {
      const { rows: [source] } = await client.query(
        `SELECT * FROM food_orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [sourceOrderId, restaurantId]
      );
      if (!source) throw new AppError('Order not found', 404, 'order_not_found');
      await assertMutablePosOrders(client, restaurantId, [source]);
      if (source.fulfillment_type === 'delivery') {
        throw new AppError('Delivery tickets cannot be split', 409, 'delivery_ticket_split_not_supported');
      }
      const { rows: items } = await client.query(
        `SELECT *, (
           SELECT COUNT(*)::int
             FROM food_order_items all_items
            WHERE all_items.order_id = $1
         ) AS order_item_count
           FROM food_order_items
          WHERE order_id = $1 AND id = ANY($2::bigint[])`,
        [sourceOrderId, itemIds]
      );
      if (items.length !== itemIds.length) {
        throw new AppError('Validation failed', 400, 'validation_failed', { orderItemIds: 'Some order items do not belong to this order' });
      }
      if (items.length >= Number(items[0]?.order_item_count || 0)) {
        throw new AppError('A split must leave at least one item on the original ticket', 409, 'split_would_empty_ticket');
      }
      const splitSubtotal = items.reduce((sum, item) => sum + Number(item.line_total_cents || 0), 0);
      const splitRatio = Number(source.subtotal_cents || 0) > 0 ? splitSubtotal / Number(source.subtotal_cents) : 0;
      const childDiscount = Math.round(Number(source.discount_cents || 0) * splitRatio);
      const childTip = Math.round(Number(source.tip_cents || 0) * splitRatio);
      const { rows: queueRows } = await client.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_queue
           FROM food_orders
          WHERE restaurant_id = $1 AND created_at::date = CURRENT_DATE`,
        [restaurantId]
      );
      const { rows: [child] } = await client.query(
        `INSERT INTO food_orders
         (restaurant_id, business_id, customer_id, guest_name, guest_phone, guest_email,
            order_source, fulfillment_type, status, payment_status, subtotal_cents, tax_cents,
            service_fee_cents, delivery_fee_cents, tax_rate_bps, service_fee_bps,
            tip_cents, discount_cents, total_cents, currency_code, table_label, queue_number,
            promised_at, notes, metadata, pos_ticket_state, pos_parent_order_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'unpaid',$10,0,0,0,$11,$12,$13,$14,0,$15,$16,$17,$18,$19,$20,'open',$21)
         RETURNING *`,
        [
          restaurantId,
          source.business_id,
          source.customer_id,
          source.guest_name,
          source.guest_phone,
          source.guest_email,
          source.order_source,
          source.fulfillment_type,
          source.status,
          splitSubtotal,
          source.tax_rate_bps || 0,
          source.service_fee_bps || 0,
          childTip,
          childDiscount,
          source.currency_code,
          source.table_label,
          Number(queueRows[0]?.next_queue || 1),
          source.promised_at,
          normalizeString(req.body.notes, 1000) || source.notes,
          JSON.stringify({ ...(source.metadata || {}), splitFromOrderId: source.id }),
          source.id,
        ]
      );
      await client.query(
        `UPDATE food_orders
            SET tip_cents = GREATEST(0, tip_cents - $1),
                discount_cents = GREATEST(0, discount_cents - $2),
                updated_at = NOW()
          WHERE id = $3`,
        [childTip, childDiscount, sourceOrderId]
      );
      await client.query(
        `UPDATE food_order_items SET order_id = $1 WHERE order_id = $2 AND id = ANY($3::bigint[])`,
        [child.id, sourceOrderId, itemIds]
      );
      const updatedSource = await recalcOrderTotals(client, sourceOrderId);
      const updatedChild = await recalcOrderTotals(client, child.id);
      return { sourceOrder: updatedSource, splitOrder: updatedChild };
    });
    broadcastRestaurant(restaurant, 'food:pos:ticket:split', result);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.mergePosOrders = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const targetOrderId = parsePositiveInt(req.params.orderId);
    const sourceOrderId = parsePositiveInt(req.body.sourceOrderId || req.body.source_order_id);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    if (!sourceOrderId || sourceOrderId === targetOrderId) {
      throw new AppError('Validation failed', 400, 'validation_failed', { sourceOrderId: 'A different source order is required' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: orders } = await client.query(
        `SELECT * FROM food_orders
          WHERE restaurant_id = $1 AND id = ANY($2::bigint[])
          FOR UPDATE`,
        [restaurantId, [targetOrderId, sourceOrderId]]
      );
      if (orders.length !== 2) throw new AppError('Order not found', 404, 'order_not_found');
      await assertMutablePosOrders(client, restaurantId, orders);
      const target = orders.find((order) => Number(order.id) === targetOrderId);
      const source = orders.find((order) => Number(order.id) === sourceOrderId);
      if (!target || !source) throw new AppError('Order not found', 404, 'order_not_found');
      if (target.currency_code !== source.currency_code
        || target.fulfillment_type !== source.fulfillment_type
        || Number(target.tax_rate_bps || 0) !== Number(source.tax_rate_bps || 0)
        || Number(target.service_fee_bps || 0) !== Number(source.service_fee_bps || 0)) {
        throw new AppError('Tickets must share currency, fulfillment, and pricing rules to merge', 409, 'incompatible_pos_tickets');
      }
      await client.query(
        `UPDATE food_orders
            SET tip_cents = tip_cents + $1,
                discount_cents = discount_cents + $2,
                delivery_fee_cents = delivery_fee_cents + $3,
                updated_at = NOW()
          WHERE id = $4`,
        [source.tip_cents, source.discount_cents, source.delivery_fee_cents, targetOrderId]
      );
      await client.query(
        `UPDATE food_order_items SET order_id = $1 WHERE order_id = $2`,
        [targetOrderId, sourceOrderId]
      );
      await client.query(
        `UPDATE food_orders
            SET pos_ticket_state = 'voided',
                status = 'cancelled',
                tip_cents = 0,
                discount_cents = 0,
                delivery_fee_cents = 0,
                voided_at = NOW(),
                updated_at = NOW(),
                metadata = metadata || $1::jsonb
          WHERE id = $2`,
        [JSON.stringify({ mergedIntoOrderId: targetOrderId }), sourceOrderId]
      );
      const targetOrder = await recalcOrderTotals(client, targetOrderId);
      const sourceOrder = await recalcOrderTotals(client, sourceOrderId);
      return { targetOrder, sourceOrder };
    });
    broadcastRestaurant(restaurant, 'food:pos:ticket:merged', result);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.recordPosPayment = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const paymentType = normalizeString(req.body.paymentType || req.body.payment_type, 24);
    const status = normalizeString(req.body.status, 24) || 'recorded';
    if (!POS_PAYMENT_TYPES.has(paymentType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { paymentType: 'Unsupported payment type' });
    }
    if (paymentType === 'card') {
      throw new AppError(
        'Card payments must use the processor-backed card intent endpoint',
        409,
        'card_payment_requires_processor'
      );
    }
    if (paymentType === 'refund') assertManage(restaurant);
    if (!POS_PAYMENT_STATUSES.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported payment status' });
    }
    if (!['recorded', 'captured'].includes(status)) {
      throw new AppError('Manual payments can only be recorded as settled', 409, 'invalid_manual_payment_status');
    }
    const amountCents = parseCents(req.body.amountCents ?? req.body.amount_cents, 'amountCents');
    if (amountCents < 1) {
      throw new AppError('Validation failed', 400, 'validation_failed', { amountCents: 'Must be greater than zero' });
    }
    const shiftId = parsePositiveInt(req.body.shiftId || req.body.shift_id);
    const idempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      200
    );
    const paymentContract = normalizeRestaurantPaymentMode(
      req.body.paymentMode || req.body.payment_mode,
      paymentType === 'external'
        ? 'direct_payment'
        : paymentType === 'wallet_credit'
          ? 'restaurant_credit'
          : 'pay_at_restaurant'
    );
    const result = await withTransaction(pool, async (client) => {
      const { rows: [order] } = await client.query(
        `SELECT * FROM food_orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [orderId, restaurantId]
      );
      if (!order) throw new AppError('Order not found', 404, 'order_not_found');
      if (idempotencyKey) {
        const { rows: [existing] } = await client.query(
          `SELECT * FROM restaurant_pos_payments
            WHERE restaurant_id = $1 AND idempotency_key = $2`,
          [restaurantId, idempotencyKey]
        );
        if (existing) {
          if (Number(existing.food_order_id) !== orderId
            || existing.payment_type !== paymentType
            || Number(existing.amount_cents) !== amountCents) {
            throw new AppError(
              'Idempotency-Key was already used for a different payment request',
              409,
              'idempotency_key_conflict'
            );
          }
          const reconciliation = await reconcilePosOrderPayment(client, orderId);
          return { payment: existing, ...reconciliation, replayed: true };
        }
      }
      if (['voided', 'refunded'].includes(order.pos_ticket_state) || order.status === 'cancelled') {
        throw new AppError('This ticket cannot accept payments', 409, 'ticket_not_payable');
      }
      if (shiftId || !MANAGE_ROLES.has(restaurant.effective_role)) {
        await requireOpenPosShift(client, restaurantId, shiftId, req.user.id, MANAGE_ROLES.has(restaurant.effective_role));
      }
      const { rows: [ledger] } = await client.query(
        `SELECT COALESCE(SUM(amount_cents) FILTER (
                        WHERE payment_type <> 'refund' AND status IN ('recorded','captured')
                      ), 0)::int AS paid_cents,
                COALESCE(SUM(amount_cents) FILTER (
                        WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')
                      ), 0)::int AS refunded_cents
           FROM restaurant_pos_payments
          WHERE food_order_id = $1`,
        [orderId]
      );
      const netPaidCents = Math.max(0, Number(ledger.paid_cents || 0) - Number(ledger.refunded_cents || 0));
      const availableCents = paymentType === 'refund'
        ? netPaidCents
        : Math.max(0, Number(order.total_cents || 0) - netPaidCents);
      if (amountCents > availableCents) {
        throw new AppError(
          paymentType === 'refund' ? 'Refund exceeds the paid balance' : 'Payment exceeds the remaining ticket balance',
          409,
          paymentType === 'refund' ? 'refund_exceeds_payment' : 'payment_exceeds_balance',
          { availableCents }
        );
      }
      const { rows: [payment] } = await client.query(
        `INSERT INTO restaurant_pos_payments
           (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
            reference, note, metadata, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          restaurantId,
          orderId,
          shiftId,
          paymentType,
          amountCents,
          status,
          normalizeString(req.body.reference, 160),
          normalizeString(req.body.note, 1000),
          {
            ...safeJson(req.body.metadata),
            paymentContract: paymentContractMetadata(paymentContract, { source: 'manual_pos_payment' }),
          },
          idempotencyKey,
          req.user.id,
        ]
      );
      const reconciliation = await reconcilePosOrderPayment(client, orderId);
      if (reconciliation?.order) {
        await insertPosReceiptAudit(client, {
          restaurantId,
          order: reconciliation.order,
          eventType: paymentType === 'refund' ? 'payment_refunded' : 'payment_recorded',
          channel: 'Payment update',
          createdBy: req.user.id,
          reason: normalizeString(req.body.reason || req.body.note, 1000),
          metadata: {
            paymentId: payment.id,
            paymentType,
            amountCents,
            status,
            shiftId,
            paymentContract: paymentContractMetadata(paymentContract),
          },
          idempotencyKey: idempotencyKey ? `receipt:${restaurantId}:${idempotencyKey}` : null,
        });
      }
      return { payment, ...reconciliation };
    });
    broadcastRestaurant(restaurant, 'food:pos:payment:recorded', result);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.createPosTerminalConnectionToken = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const settings = safeJson(restaurant.settings);
    const location = normalizeString(
      settings.stripeTerminalLocationId || settings.stripe_terminal_location_id,
      255
    );
    const token = await posTerminal.createConnectionToken(location);
    res.json({ secret: token.secret, location: location || null });
  } catch (err) {
    if (err.code === 'stripe_not_configured') {
      return next(new AppError('Stripe Terminal is not configured', 503, 'stripe_not_configured'));
    }
    next(err);
  }
};

exports.createPosCardIntent = async (req, res, next) => {
  let reservedPayment = null;
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const amountCents = parseCents(req.body.amountCents ?? req.body.amount_cents, 'amountCents');
    if (amountCents < 1) {
      throw new AppError('Validation failed', 400, 'validation_failed', { amountCents: 'Amount must be greater than zero' });
    }
    const idempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      200
    );
    if (!idempotencyKey) {
      throw new AppError('Idempotency-Key is required', 400, 'idempotency_key_required');
    }
    const shiftId = parsePositiveInt(req.body.shiftId || req.body.shift_id);
    const paymentContract = normalizeRestaurantPaymentMode(
      req.body.paymentMode || req.body.payment_mode,
      'pay_at_restaurant'
    );
    reservedPayment = await withTransaction(pool, async (client) => {
      const { rows: [order] } = await client.query(
        `SELECT * FROM food_orders WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [orderId, restaurantId]
      );
      if (!order) throw new AppError('Order not found', 404, 'order_not_found');
      const { rows: [existing] } = await client.query(
        `SELECT * FROM restaurant_pos_payments
          WHERE restaurant_id = $1 AND idempotency_key = $2`,
        [restaurantId, idempotencyKey]
      );
      if (existing) {
        if (Number(existing.food_order_id) !== orderId
          || existing.payment_type !== 'card'
          || Number(existing.amount_cents) !== amountCents) {
          throw new AppError(
            'Idempotency-Key was already used for a different payment request',
            409,
            'idempotency_key_conflict'
          );
        }
        return { payment: existing, order, replayed: true };
      }
      if (['voided', 'refunded'].includes(order.pos_ticket_state) || order.status === 'cancelled') {
        throw new AppError('This ticket cannot accept payments', 409, 'ticket_not_payable');
      }
      await requireOpenPosShift(client, restaurantId, shiftId, req.user.id, MANAGE_ROLES.has(restaurant.effective_role));
      const { rows: [ledger] } = await client.query(
        `SELECT COALESCE(SUM(amount_cents) FILTER (
                        WHERE payment_type <> 'refund' AND status IN ('pending','recorded','captured')
                      ), 0)::int
                  - COALESCE(SUM(amount_cents) FILTER (
                        WHERE payment_type = 'refund' AND status IN ('recorded','captured','refunded')
                      ), 0)::int AS committed_cents
           FROM restaurant_pos_payments
          WHERE food_order_id = $1`,
        [orderId]
      );
      const remainingCents = Math.max(0, Number(order.total_cents || 0) - Number(ledger.committed_cents || 0));
      if (amountCents > remainingCents) {
        throw new AppError('Payment exceeds the remaining ticket balance', 409, 'payment_exceeds_balance', { remainingCents });
      }
      const { rows: [payment] } = await client.query(
        `INSERT INTO restaurant_pos_payments
           (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
            provider, idempotency_key, metadata, created_by)
         VALUES ($1,$2,$3,'card',$4,'pending','stripe_terminal',$5,$6,$7)
         RETURNING *`,
        [
          restaurantId,
          orderId,
          shiftId,
          amountCents,
          idempotencyKey,
          {
            ...safeJson(req.body.metadata),
            paymentContract: paymentContractMetadata(paymentContract, { source: 'pos_card_intent' }),
          },
          req.user.id,
        ]
      );
      await reconcilePosOrderPayment(client, orderId);
      return { payment, order, replayed: false };
    });
    if (reservedPayment.replayed && reservedPayment.payment.provider_payment_intent_id) {
      return res.json({ payment: reservedPayment.payment, replayed: true });
    }
    const intent = await posTerminal.createPaymentIntent({
      amountCents,
      currency: reservedPayment.order.currency_code,
      idempotencyKey: `pos-intent:${restaurantId}:${idempotencyKey}`,
      metadata: {
        food_order_id: String(orderId),
        restaurant_id: String(restaurantId),
        business_id: String(restaurant.business_id),
        pos_payment_id: String(reservedPayment.payment.id),
        payment_mode: paymentContract.canonical,
      },
    });
    const { rows: [payment] } = await pool.query(
      `UPDATE restaurant_pos_payments
          SET status = 'pending',
              provider_payment_intent_id = $1,
              reference = $1,
              metadata = metadata || $2::jsonb,
              updated_at = NOW()
        WHERE id = $3 AND restaurant_id = $4
        RETURNING *`,
      [intent.id, JSON.stringify({ stripeStatus: intent.status }), reservedPayment.payment.id, restaurantId]
    );
    broadcastRestaurant(restaurant, 'food:pos:card:intent:created', { payment });
    res.status(201).json({ payment, clientSecret: intent.client_secret, replayed: false });
  } catch (err) {
    if (reservedPayment?.payment?.id && !reservedPayment.replayed) {
      await pool.query(
        `UPDATE restaurant_pos_payments SET status = 'failed', note = $1, updated_at = NOW() WHERE id = $2`,
        [normalizeString(err.message, 1000), reservedPayment.payment.id]
      ).catch(() => {});
      await withTransaction(pool, (client) => reconcilePosOrderPayment(client, reservedPayment.payment.food_order_id)).catch(() => {});
    }
    if (err.code === 'stripe_not_configured') {
      return next(new AppError('Stripe Terminal is not configured', 503, 'stripe_not_configured'));
    }
    next(err);
  }
};

exports.capturePosCardPayment = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const paymentId = parsePositiveInt(req.params.paymentId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [payment] } = await pool.query(
      `SELECT * FROM restaurant_pos_payments
        WHERE id = $1 AND restaurant_id = $2 AND payment_type = 'card'`,
      [paymentId, restaurantId]
    );
    if (!payment) throw new AppError('POS payment not found', 404, 'pos_payment_not_found');
    if (!payment.provider_payment_intent_id) {
      throw new AppError('Card payment is missing its processor reference', 409, 'payment_processor_reference_missing');
    }
    const intent = await posTerminal.capturePaymentIntent(
      payment.provider_payment_intent_id,
      `pos-capture:${restaurantId}:${payment.id}`
    );
    const result = await withTransaction(pool, async (client) => {
      const { rows: [capturedPayment] } = await client.query(
        `UPDATE restaurant_pos_payments
            SET status = 'captured',
                provider_charge_id = COALESCE($1, provider_charge_id),
                metadata = metadata || $2::jsonb,
                updated_at = NOW()
          WHERE id = $3 AND restaurant_id = $4
          RETURNING *`,
        [typeof intent.latest_charge === 'string' ? intent.latest_charge : null, JSON.stringify({ stripeStatus: intent.status }), payment.id, restaurantId]
      );
      const reconciliation = await reconcilePosOrderPayment(client, payment.food_order_id);
      if (reconciliation?.order) {
        await insertPosReceiptAudit(client, {
          restaurantId,
          order: reconciliation.order,
          eventType: 'payment_recorded',
          channel: 'Payment update',
          createdBy: req.user.id,
          metadata: {
            paymentId: capturedPayment.id,
            paymentType: capturedPayment.payment_type,
            amountCents: capturedPayment.amount_cents,
            provider: capturedPayment.provider,
            providerPaymentIntentId: capturedPayment.provider_payment_intent_id,
          },
          idempotencyKey: `receipt:pos-capture:${restaurantId}:${payment.id}`,
        });
      }
      return { payment: capturedPayment, ...reconciliation };
    });
    broadcastRestaurant(restaurant, 'food:pos:card:captured', result);
    res.json(result);
  } catch (err) {
    if (err.code === 'stripe_not_configured') {
      return next(new AppError('Stripe Terminal is not configured', 503, 'stripe_not_configured'));
    }
    if (err.code === 'payment_not_authorized') {
      return next(new AppError(err.message, 409, 'payment_not_authorized'));
    }
    next(err);
  }
};

exports.refundPosCardPayment = async (req, res, next) => {
  let reservation = null;
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const paymentId = parsePositiveInt(req.params.paymentId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const amountCents = parseCents(req.body.amountCents ?? req.body.amount_cents, 'amountCents');
    if (amountCents < 1) {
      throw new AppError('Validation failed', 400, 'validation_failed', { amountCents: 'Amount must be greater than zero' });
    }
    const idempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      200
    );
    if (!idempotencyKey) throw new AppError('Idempotency-Key is required', 400, 'idempotency_key_required');
    reservation = await withTransaction(pool, async (client) => {
      const { rows: [original] } = await client.query(
        `SELECT * FROM restaurant_pos_payments
          WHERE id = $1 AND restaurant_id = $2 AND payment_type = 'card'
          FOR UPDATE`,
        [paymentId, restaurantId]
      );
      if (!original) throw new AppError('POS payment not found', 404, 'pos_payment_not_found');
      if (original.status !== 'captured' || !original.provider_payment_intent_id) {
        throw new AppError('Only captured processor payments can be refunded', 409, 'payment_not_refundable');
      }
      const { rows: [existing] } = await client.query(
        `SELECT * FROM restaurant_pos_payments
          WHERE restaurant_id = $1 AND idempotency_key = $2`,
        [restaurantId, idempotencyKey]
      );
      if (existing) {
        if (Number(existing.food_order_id) !== Number(original.food_order_id)
          || existing.payment_type !== 'refund'
          || Number(existing.amount_cents) !== amountCents
          || Number(existing.metadata?.originalPaymentId) !== Number(original.id)) {
          throw new AppError(
            'Idempotency-Key was already used for a different refund request',
            409,
            'idempotency_key_conflict'
          );
        }
        return { original, refundPayment: existing, replayed: true };
      }
      const { rows: [refundTotals] } = await client.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS reserved_refund_cents
           FROM restaurant_pos_payments
          WHERE restaurant_id = $1
            AND food_order_id = $2
            AND payment_type = 'refund'
            AND status IN ('pending','recorded','captured','refunded')
            AND metadata->>'originalPaymentId' = $3::text`,
        [restaurantId, original.food_order_id, original.id]
      );
      const refundableCents = Number(original.amount_cents) - Number(refundTotals.reserved_refund_cents || 0);
      if (amountCents > refundableCents) {
        throw new AppError('Refund exceeds the remaining captured amount', 409, 'refund_exceeds_payment', { refundableCents });
      }
      const { rows: [refundPayment] } = await client.query(
        `INSERT INTO restaurant_pos_payments
           (restaurant_id, food_order_id, shift_id, payment_type, amount_cents, status,
            provider, provider_payment_intent_id, idempotency_key, note, metadata, created_by)
         VALUES ($1,$2,$3,'refund',$4,'pending','stripe_terminal',$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          restaurantId,
          original.food_order_id,
          original.shift_id,
          amountCents,
          original.provider_payment_intent_id,
          idempotencyKey,
          normalizeString(req.body.reason || req.body.note, 1000),
          JSON.stringify({ originalPaymentId: original.id }),
          req.user.id,
        ]
      );
      return { original, refundPayment, replayed: false };
    });
    if (reservation.replayed && reservation.refundPayment.provider_refund_id) {
      return res.json({ payment: reservation.refundPayment, replayed: true });
    }
    const refund = await posTerminal.createRefund({
      paymentIntentId: reservation.original.provider_payment_intent_id,
      amountCents,
      idempotencyKey: `pos-refund:${restaurantId}:${idempotencyKey}`,
      metadata: {
        food_order_id: String(reservation.original.food_order_id),
        restaurant_id: String(restaurantId),
        pos_payment_id: String(reservation.original.id),
        pos_refund_payment_id: String(reservation.refundPayment.id),
      },
    });
    const result = await withTransaction(pool, async (client) => {
      const refundStatus = refund.status === 'succeeded' ? 'refunded' : refund.status === 'failed' ? 'failed' : 'pending';
      const { rows: [refundPayment] } = await client.query(
        `UPDATE restaurant_pos_payments
            SET status = $1,
                provider_refund_id = $2,
                reference = $2,
                metadata = metadata || $3::jsonb,
                updated_at = NOW()
          WHERE id = $4
          RETURNING *`,
        [refundStatus, refund.id, JSON.stringify({ stripeStatus: refund.status }), reservation.refundPayment.id]
      );
      if (refundStatus === 'refunded') {
        await client.query(
          `UPDATE restaurant_pos_payments
              SET refunded_amount_cents = refunded_amount_cents + $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [amountCents, reservation.original.id]
        );
      }
      const reconciliation = await reconcilePosOrderPayment(client, reservation.original.food_order_id);
      if (reconciliation?.order) {
        await insertPosReceiptAudit(client, {
          restaurantId,
          order: reconciliation.order,
          eventType: 'payment_refunded',
          channel: 'Payment update',
          createdBy: req.user.id,
          reason: normalizeString(req.body.reason || req.body.note, 1000),
          metadata: {
            paymentId: refundPayment.id,
            originalPaymentId: reservation.original.id,
            amountCents,
            providerRefundId: refund.id,
            refundStatus,
          },
          idempotencyKey: `receipt:pos-refund:${restaurantId}:${idempotencyKey}`,
        });
      }
      return { payment: refundPayment, ...reconciliation };
    });
    broadcastRestaurant(restaurant, 'food:pos:card:refunded', result);
    res.status(201).json(result);
  } catch (err) {
    if (reservation?.refundPayment?.id && !reservation.replayed) {
      await pool.query(
        `UPDATE restaurant_pos_payments SET status = 'failed', note = COALESCE(note, $1), updated_at = NOW() WHERE id = $2`,
        [normalizeString(err.message, 1000), reservation.refundPayment.id]
      ).catch(() => {});
    }
    if (err.code === 'stripe_not_configured') {
      return next(new AppError('Stripe Terminal is not configured', 503, 'stripe_not_configured'));
    }
    next(err);
  }
};

exports.getPosPaymentStatus = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const paymentId = parsePositiveInt(req.params.paymentId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const result = await withTransaction(pool, async (client) => {
      const { rows: [payment] } = await client.query(
        `SELECT * FROM restaurant_pos_payments WHERE id = $1 AND restaurant_id = $2`,
        [paymentId, restaurantId]
      );
      if (!payment) throw new AppError('POS payment not found', 404, 'pos_payment_not_found');
      const reconciliation = await reconcilePosOrderPayment(client, payment.food_order_id);
      return { payment, ...reconciliation };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.reprintReceipt = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderId = parsePositiveInt(req.params.orderId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [order] } = await pool.query(
      `SELECT id, queue_number, guest_name, guest_phone, guest_email, table_label,
              order_source, fulfillment_type, status, payment_status,
              subtotal_cents, discount_cents, tax_cents, service_fee_cents,
              delivery_fee_cents, tip_cents, total_cents, currency_code,
              notes, created_at, updated_at
         FROM food_orders
        WHERE id = $1 AND restaurant_id = $2`,
      [orderId, restaurantId]
    );
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    const [{ rows: items }, { rows: modifiers }, { rows: payments }] = await Promise.all([
      pool.query(
        `SELECT id, menu_item_id, item_name, quantity, unit_price_cents,
                modifier_total_cents, line_total_cents, special_instructions
           FROM food_order_items
          WHERE order_id = $1
          ORDER BY id ASC`,
        [orderId]
      ),
      pool.query(
        `SELECT foim.order_item_id, foim.modifier_id, foim.modifier_name, foim.price_delta_cents
           FROM food_order_item_modifiers foim
           JOIN food_order_items foi ON foi.id = foim.order_item_id
          WHERE foi.order_id = $1
          ORDER BY foim.order_item_id ASC, foim.id ASC`,
        [orderId]
      ),
      pool.query(
        `SELECT id, payment_type, amount_cents, status, reference, created_at
           FROM restaurant_pos_payments
          WHERE restaurant_id = $1 AND food_order_id = $2
            AND status IN ('recorded','captured','refunded')
          ORDER BY created_at ASC, id ASC`,
        [restaurantId, orderId]
      ),
    ]);
    const receiptIdempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      200
    );
    let receiptEvent = await insertPosReceiptAudit(pool, {
      restaurantId,
      order,
      eventType: 'receipt_reprinted',
      channel: 'Printed',
      createdBy: req.user.id,
      reason: normalizeString(req.body.reason || req.body.note, 1000),
      metadata: {
        paymentCount: payments.length,
        itemCount: items.length,
      },
      idempotencyKey: receiptIdempotencyKey,
    });
    if (!receiptEvent && receiptIdempotencyKey) {
      const { rows: [existingEvent] } = await pool.query(
        `SELECT * FROM restaurant_pos_receipt_events
          WHERE restaurant_id = $1 AND idempotency_key = $2`,
        [restaurantId, receiptIdempotencyKey]
      );
      receiptEvent = existingEvent;
    }
    const modifiersByItem = new Map();
    for (const modifier of modifiers) {
      const key = String(modifier.order_item_id);
      if (!modifiersByItem.has(key)) modifiersByItem.set(key, []);
      modifiersByItem.get(key).push(modifier);
    }
    res.status(201).json({
      receiptEvent,
      receipt: {
        receiptNumber: String(receiptEvent.id),
        reprintedAt: receiptEvent.created_at,
        restaurant: {
          id: restaurant.id,
          name: restaurant.display_name,
          phone: restaurant.phone,
          addressStreet: restaurant.address_street,
          addressCity: restaurant.address_city,
          addressState: restaurant.address_state,
          addressZip: restaurant.address_zip,
        },
        order,
        items: items.map((item) => ({ ...item, modifiers: modifiersByItem.get(String(item.id)) || [] })),
        payments,
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.setStaffPin = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const pin = normalizeString(req.body.pin, 12);
    if (!pin || !/^\d{4,12}$/.test(pin)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { pin: 'PIN must be 4-12 digits' });
    }
    const staffUserId = req.body.staffUserId || req.body.staff_user_id || null;
    if (!staffUserId && !normalizeString(req.body.staffLabel || req.body.staff_label, 160)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { staffLabel: 'Staff label is required when staffUserId is missing' });
    }
    if (staffUserId) {
      try {
        await requireRestaurantAccess(staffUserId, restaurantId);
      } catch (err) {
        throw new AppError('Validation failed', 400, 'validation_failed', {
          staffUserId: 'Staff member must be active at this restaurant',
        });
      }
    }
    const pinHash = await bcrypt.hash(pin, 10);
    const { rows: [staffPin] } = await pool.query(
      `INSERT INTO restaurant_staff_pins
         (restaurant_id, staff_user_id, staff_label, pin_hash, role_label, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,TRUE,$6)
       ON CONFLICT (restaurant_id, staff_user_id)
       DO UPDATE SET pin_hash = EXCLUDED.pin_hash,
                     staff_label = COALESCE(EXCLUDED.staff_label, restaurant_staff_pins.staff_label),
                     role_label = COALESCE(EXCLUDED.role_label, restaurant_staff_pins.role_label),
                     is_active = TRUE,
                     updated_at = NOW()
       RETURNING id, restaurant_id, staff_user_id, staff_label, role_label, is_active, updated_at`,
      [
        restaurantId,
        staffUserId,
        normalizeString(req.body.staffLabel || req.body.staff_label, 160),
        pinHash,
        normalizeString(req.body.roleLabel || req.body.role_label, 120),
        req.user.id,
      ]
    );
    res.status(201).json({ staffPin });
  } catch (err) {
    next(err);
  }
};

exports.validateStaffPin = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const pin = normalizeString(req.body.pin, 12);
    if (!pin) throw new AppError('Validation failed', 400, 'validation_failed', { pin: 'PIN is required' });
    const { rows } = await pool.query(
      `SELECT id, staff_user_id, staff_label, pin_hash, role_label
         FROM restaurant_staff_pins
        WHERE restaurant_id = $1 AND is_active = TRUE
        ORDER BY updated_at DESC`,
      [restaurantId]
    );
    for (const row of rows) {
      // Constant-time enough for a short local staff unlock flow; bcrypt does
      // the actual hash comparison.
      if (await bcrypt.compare(pin, row.pin_hash)) {
        return res.json({
          valid: true,
          staff: {
            id: row.id,
            userId: row.staff_user_id,
            label: row.staff_label,
            roleLabel: row.role_label,
          },
        });
      }
    }
    return res.status(401).json({ valid: false, error: { code: 'invalid_pin', message: 'Invalid staff PIN' } });
  } catch (err) {
    next(err);
  }
};

exports.recordKitchenEvent = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const orderId = parsePositiveInt(req.body.orderId || req.body.order_id);
    const orderItemId = parsePositiveInt(req.body.orderItemId || req.body.order_item_id);
    const eventType = normalizeString(req.body.eventType || req.body.event_type, 48) || 'status';
    const toStatus = normalizeString(req.body.toStatus || req.body.to_status, 48);
    if (orderItemId && toStatus && !KITCHEN_ITEM_STATUS.has(toStatus)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { toStatus: 'Unsupported kitchen item status' });
    }
    if (orderItemId && toStatus) {
      throw new AppError(
        'Item status changes must use the kitchen item action endpoint',
        409,
        'kitchen_action_required'
      );
    }
    let order = null;
    if (orderId) {
      const { rows: [loadedOrder] } = await pool.query(
        `SELECT * FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
        [orderId, restaurantId]
      );
      if (!loadedOrder) throw new AppError('Order not found', 404, 'order_not_found');
      order = loadedOrder;
    } else if (orderItemId) {
      throw new AppError('Validation failed', 400, 'validation_failed', { orderId: 'Order is required for an item event' });
    }
    let fromStatus = normalizeString(req.body.fromStatus || req.body.from_status, 48);
    const { rows: [event] } = await pool.query(
      `INSERT INTO restaurant_kitchen_events
         (restaurant_id, food_order_id, food_order_item_id, event_type, from_status, to_status,
          station_label, reason, metadata, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        restaurantId,
        orderId,
        orderItemId,
        eventType,
        fromStatus,
        toStatus,
        normalizeString(req.body.stationLabel || req.body.station_label, 80),
        normalizeString(req.body.reason, 1000),
        JSON.stringify(safeJson(req.body.metadata)),
        req.user.id,
      ]
    );
    broadcastRestaurant(restaurant, 'food:kitchen:event', {
      order,
      event,
      restaurantId,
      cursor: Number(event.id),
    });
    res.status(201).json({ event });
  } catch (err) {
    next(err);
  }
};

exports.getKitchenFeed = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const station = normalizeString(req.query.station, 80);
    const deviceId = parsePositiveInt(req.params.deviceId || req.query.deviceId || req.query.device_id);
    const requestedCursor = req.query.sinceEventId ?? req.query.since_event_id ?? req.query.cursor;
    let sinceEventId = parsePositiveInt(requestedCursor, 0) || 0;
    let device = null;
    if (req.user?.id) {
      await requireRestaurantAccess(req.user.id, restaurantId);
    } else if (!deviceId) {
      throw new AppError('Device credential is required', 401, 'device_credential_required');
    }
    if (deviceId) {
      const credentialDevice = await requireDeviceCredential(req, restaurantId, deviceId);
      assertDeviceApp(credentialDevice, 'kitchen');
      const { rows: [pairedDevice] } = await pool.query(
        `SELECT id, restaurant_id, app_key, device_name, mode, location_id, status, config,
                last_kitchen_event_id, last_sync_at, sync_status, sync_error, config_version,
                app_version, platform, last_seen_at, paired_at
           FROM restaurant_app_devices
          WHERE id = $1 AND restaurant_id = $2 AND app_key = 'kitchen' AND status = 'paired'`,
        [deviceId, restaurantId]
      );
      if (!pairedDevice) throw new AppError('Kitchen device not found', 404, 'kitchen_device_not_found');
      device = pairedDevice;
      if (requestedCursor === undefined) sinceEventId = Number(device.last_kitchen_event_id || 0);
    }
    const params = [restaurantId];
    let itemFilter = '';
    let itemHaving = '';
    if (station) {
      params.push(station);
      itemFilter = `AND (foi.station_label = $${params.length} OR foi.station_label IS NULL)`;
      itemHaving = 'HAVING COUNT(foi.id) > 0';
    }
    const { rows: orders } = await pool.query(
      `SELECT fo.*,
              COALESCE(json_agg(json_build_object(
                'id', foi.id,
                'menuItemId', foi.menu_item_id,
                'itemName', foi.item_name,
                'quantity', foi.quantity,
                'kitchenStatus', foi.kitchen_status,
                'stationLabel', foi.station_label,
                'bumpedAt', foi.bumped_at,
                'kitchenStartedAt', foi.kitchen_started_at,
                'delayedAt', foi.delayed_at,
                'delayReason', foi.delay_reason,
                'targetPrepSeconds', foi.target_prep_seconds,
                'elapsedPrepSeconds', GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(foi.kitchen_started_at, fo.created_at))))::int),
                'specialInstructions', foi.special_instructions
              ) ORDER BY foi.id) FILTER (WHERE foi.id IS NOT NULL), '[]') AS items
         FROM food_orders fo
         LEFT JOIN food_order_items foi
           ON foi.order_id = fo.id
          ${itemFilter}
        WHERE fo.restaurant_id = $1
          AND fo.status IN ('received','accepted','preparing','ready')
          AND fo.created_at >= NOW() - INTERVAL '1 day'
        GROUP BY fo.id
        ${itemHaving}
        ORDER BY
          CASE fo.status
            WHEN 'received' THEN 1
            WHEN 'accepted' THEN 2
            WHEN 'preparing' THEN 3
            WHEN 'ready' THEN 4
            ELSE 5
          END,
          fo.promised_at ASC NULLS LAST,
          fo.created_at ASC
        LIMIT 100`,
      params
    );
    const { rows: events } = await pool.query(
      `SELECT *
         FROM restaurant_kitchen_events
        WHERE restaurant_id = $1
          AND id > $2
        ORDER BY id ASC
        LIMIT 100`,
      [restaurantId, sinceEventId]
    );
    const cursor = events.length ? Number(events[events.length - 1].id) : sinceEventId;
    res.json({
      orders,
      events,
      cursor,
      hasMore: events.length === 100,
      device: publicDevice(device),
      contract: device ? deviceRouteContract(device, { restaurantId }) : null,
      serverTime: new Date().toISOString(),
      nextPollAfterMs: events.length ? 250 : 2000,
    });
  } catch (err) {
    next(err);
  }
};

exports.ackKitchenFeed = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const deviceId = parsePositiveInt(req.params.deviceId || req.body.deviceId || req.body.device_id);
    const cursor = parsePositiveInt(req.body.cursor || req.body.lastKitchenEventId || req.body.last_kitchen_event_id, 0) || 0;
    if (req.user?.id) {
      await requireRestaurantAccess(req.user.id, restaurantId);
    } else if (!deviceId) {
      throw new AppError('Device credential is required', 401, 'device_credential_required');
    }
    const credentialDevice = await requireDeviceCredential(req, restaurantId, deviceId);
    assertDeviceApp(credentialDevice, 'kitchen');
    const { rows: [device] } = await pool.query(
      `UPDATE restaurant_app_devices d
          SET last_kitchen_event_id = GREATEST(
                d.last_kitchen_event_id,
                LEAST($1, COALESCE((
                  SELECT MAX(e.id) FROM restaurant_kitchen_events e WHERE e.restaurant_id = $2
                ), 0))
              ),
              last_sync_at = NOW(),
              last_seen_at = NOW(),
              sync_status = 'healthy',
              sync_error = NULL,
              updated_at = NOW()
        WHERE d.id = $3
          AND d.restaurant_id = $2
          AND d.app_key = 'kitchen'
          AND d.status = 'paired'
        RETURNING id, restaurant_id, device_name, last_kitchen_event_id, last_sync_at, sync_status`,
      [cursor, restaurantId, deviceId]
    );
    if (!device) throw new AppError('Kitchen device not found', 404, 'kitchen_device_not_found');
    res.json({
      device: publicDevice(device),
      contract: deviceRouteContract(device, { restaurantId }),
      cursor: Number(device.last_kitchen_event_id),
      lastKitchenEventId: Number(device.last_kitchen_event_id),
      last_kitchen_event_id: Number(device.last_kitchen_event_id),
    });
  } catch (err) {
    next(err);
  }
};

exports.performKitchenItemAction = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const orderItemId = parsePositiveInt(req.params.orderItemId || req.body.orderItemId || req.body.order_item_id);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const action = normalizeString(req.body.action, 32);
    if (!KITCHEN_ACTIONS.has(action)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { action: 'Unsupported kitchen action' });
    }
    const actionToStatus = {
      start: 'preparing',
      prepare: 'preparing',
      ready: 'ready',
      bump: 'bumped',
      recall: 'preparing',
      hold: 'held',
      delay: 'delayed',
      problem: 'problem',
      cancel: 'cancelled',
    };
    const toStatus = actionToStatus[action];
    const stationLabel = normalizeString(req.body.stationLabel || req.body.station_label, 80);
    const reason = normalizeString(req.body.reason, 1000);
    const targetPrepSeconds = parsePositiveInt(req.body.targetPrepSeconds || req.body.target_prep_seconds);

    const result = await withTransaction(pool, async (client) => {
      const { rows: [existing] } = await client.query(
        `SELECT foi.*, fo.restaurant_id, fo.business_id, fo.status AS order_status, fo.queue_number
           FROM food_order_items foi
           JOIN food_orders fo ON fo.id = foi.order_id
          WHERE foi.id = $1 AND fo.restaurant_id = $2
          FOR UPDATE`,
        [orderItemId, restaurantId]
      );
      if (!existing) throw new AppError('Order item not found', 404, 'order_item_not_found');
      if (['completed', 'cancelled', 'refunded'].includes(existing.order_status)) {
        throw new AppError('Kitchen item belongs to a terminal order', 409, 'kitchen_order_terminal');
      }
      if (!KITCHEN_ACTION_FROM[action].has(existing.kitchen_status)) {
        throw new AppError(
          `Kitchen action ${action} is not allowed from ${existing.kitchen_status}`,
          409,
          'illegal_kitchen_transition',
          { action, fromStatus: existing.kitchen_status, toStatus }
        );
      }
      const { rows: [item] } = await client.query(
        `UPDATE food_order_items
            SET kitchen_status = $1,
                station_label = COALESCE($2, station_label),
                kitchen_started_at = CASE
                  WHEN $1 = 'preparing' THEN COALESCE(kitchen_started_at, NOW())
                  WHEN $1 = 'cancelled' THEN kitchen_started_at
                  ELSE kitchen_started_at
                END,
                bumped_at = CASE WHEN $1 = 'bumped' THEN NOW() ELSE bumped_at END,
                delayed_at = CASE WHEN $1 IN ('delayed','problem') THEN NOW() ELSE delayed_at END,
                delay_reason = CASE WHEN $1 IN ('delayed','problem') THEN $3 ELSE delay_reason END,
                target_prep_seconds = COALESCE($4, target_prep_seconds),
                updated_at = NOW()
          WHERE id = $5
          RETURNING *`,
        [toStatus, stationLabel, reason, targetPrepSeconds, orderItemId]
      );
      const order = await syncKitchenOrderStatus(client, existing.order_id, toStatus === 'ready' || toStatus === 'bumped' ? null : 'preparing');
      const { rows: [event] } = await client.query(
        `INSERT INTO restaurant_kitchen_events
           (restaurant_id, food_order_id, food_order_item_id, event_type, from_status, to_status,
            station_label, reason, metadata, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          restaurantId,
          existing.order_id,
          orderItemId,
          `item_${action}`,
          existing.kitchen_status,
          toStatus,
          stationLabel || item.station_label,
          reason,
          JSON.stringify({
            action,
            targetPrepSeconds: targetPrepSeconds || item.target_prep_seconds || null,
          }),
          req.user.id,
        ]
      );
      return { item, order, event };
    });
    broadcastRestaurant(restaurant, 'food:kitchen:item:action', {
      ...result,
      restaurantId,
      cursor: Number(result.event.id),
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.listKitchenEvents = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const orderId = parsePositiveInt(req.query.orderId || req.query.order_id);
    const params = [restaurantId];
    let filter = '';
    if (orderId) {
      params.push(orderId);
      filter = `AND food_order_id = $${params.length}`;
    }
    params.push(Math.min(parsePositiveInt(req.query.limit, 50), 100));
    const { rows: events } = await pool.query(
      `SELECT *
         FROM restaurant_kitchen_events
        WHERE restaurant_id = $1 ${filter}
        ORDER BY created_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ events });
  } catch (err) {
    next(err);
  }
};

exports.listKitchenStations = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: stations } = await pool.query(
      `SELECT ks.*,
              d.device_name,
              d.status AS device_status
         FROM restaurant_kitchen_stations ks
         LEFT JOIN restaurant_app_devices d ON d.id = ks.device_id
        WHERE ks.restaurant_id = $1
        ORDER BY ks.is_active DESC, ks.name ASC`,
      [restaurantId]
    );
    res.json({ stations });
  } catch (err) {
    next(err);
  }
};

exports.upsertKitchenStation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const name = normalizeString(req.body.name, 120);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Station name is required' });
    const deviceId = parsePositiveInt(req.body.deviceId || req.body.device_id);
    if (deviceId) {
      const { rows: [device] } = await pool.query(
        `SELECT id FROM restaurant_app_devices
          WHERE id = $1 AND restaurant_id = $2 AND app_key = 'kitchen'`,
        [deviceId, restaurantId]
      );
      if (!device) throw new AppError('Kitchen device not found', 404, 'kitchen_device_not_found');
    }
    const { rows: [station] } = await pool.query(
      `INSERT INTO restaurant_kitchen_stations
         (restaurant_id, name, device_id, printer_config, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (restaurant_id, name)
       DO UPDATE SET device_id = COALESCE(EXCLUDED.device_id, restaurant_kitchen_stations.device_id),
                     printer_config = EXCLUDED.printer_config,
                     is_active = EXCLUDED.is_active,
                     updated_at = NOW()
       RETURNING *`,
      [
        restaurantId,
        name,
        deviceId,
        safeJson(req.body.printerConfig || req.body.printer_config),
        req.body.isActive !== false && req.body.is_active !== false,
        req.user.id,
      ]
    );
    res.status(201).json({ station });
  } catch (err) {
    next(err);
  }
};

exports.routeMenuItemToStation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const menuItemId = parsePositiveInt(req.body.menuItemId || req.body.menu_item_id);
    const stationId = parsePositiveInt(req.body.stationId || req.body.station_id);
    if (!menuItemId || !stationId) {
      throw new AppError('Validation failed', 400, 'validation_failed', { route: 'menuItemId and stationId are required' });
    }
    const { rows: [route] } = await pool.query(
      `INSERT INTO restaurant_menu_item_station_routes
         (restaurant_id, menu_item_id, station_id, created_by)
       SELECT $1, fmi.id, ks.id, $4
         FROM food_menu_items fmi
         JOIN restaurant_kitchen_stations ks ON ks.id = $3 AND ks.restaurant_id = $1
        WHERE fmi.id = $2 AND fmi.restaurant_id = $1
       ON CONFLICT (restaurant_id, menu_item_id)
       DO UPDATE SET station_id = EXCLUDED.station_id
       RETURNING *`,
      [restaurantId, menuItemId, stationId, req.user.id]
    );
    if (!route) throw new AppError('Menu item or station not found', 404, 'route_target_not_found');
    res.json({ route });
  } catch (err) {
    next(err);
  }
};

exports.createPrinterJob = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const jobType = normalizeString(req.body.jobType || req.body.job_type, 40) || 'kitchen_ticket';
    if (!PRINTER_JOB_TYPES.has(jobType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { jobType: 'Unsupported printer job type' });
    }
    const stationId = parsePositiveInt(req.body.stationId || req.body.station_id);
    const orderId = parsePositiveInt(req.body.orderId || req.body.order_id);
    if (stationId) {
      const { rows: [station] } = await pool.query(
        `SELECT id FROM restaurant_kitchen_stations WHERE id = $1 AND restaurant_id = $2`,
        [stationId, restaurantId]
      );
      if (!station) throw new AppError('Kitchen station not found', 404, 'kitchen_station_not_found');
    }
    if (orderId) {
      const { rows: [order] } = await pool.query(
        `SELECT id FROM food_orders WHERE id = $1 AND restaurant_id = $2`,
        [orderId, restaurantId]
      );
      if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    }
    const { rows: [job] } = await pool.query(
      `INSERT INTO restaurant_printer_jobs
         (restaurant_id, station_id, food_order_id, job_type, payload, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        restaurantId,
        stationId,
        orderId,
        jobType,
        safeJson(req.body.payload),
        req.user.id,
      ]
    );
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
};

exports.listPrinterJobs = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const deviceId = parsePositiveInt(req.query.deviceId || req.query.device_id);
    const stationId = parsePositiveInt(req.query.stationId || req.query.station_id);
    const status = normalizeString(req.query.status, 24);
    if (status && !PRINTER_JOB_STATUSES.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported printer job status' });
    }
    const { rows: jobs } = await pool.query(
      `SELECT pj.*, ks.name AS station_name, ks.device_id AS assigned_device_id,
              d.device_name, d.status AS device_status
         FROM restaurant_printer_jobs pj
         LEFT JOIN restaurant_kitchen_stations ks ON ks.id = pj.station_id
         LEFT JOIN restaurant_app_devices d ON d.id = ks.device_id
        WHERE pj.restaurant_id = $1
          AND ($2::bigint IS NULL OR ks.device_id = $2 OR pj.claimed_by_device_id = $2)
          AND ($3::bigint IS NULL OR pj.station_id = $3)
          AND ($4::text IS NULL OR pj.status = $4)
        ORDER BY CASE pj.status WHEN 'queued' THEN 0 WHEN 'failed' THEN 1 ELSE 2 END,
                 pj.created_at ASC
        LIMIT 200`,
      [restaurantId, deviceId, stationId, status]
    );
    res.json({ jobs });
  } catch (err) {
    next(err);
  }
};

exports.claimPrinterJob = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const jobId = parsePositiveInt(req.params.jobId);
    const deviceId = parsePositiveInt(req.body.deviceId || req.body.device_id);
    await requireRestaurantAccess(req.user.id, restaurantId);
    if (!deviceId) throw new AppError('Validation failed', 400, 'validation_failed', { deviceId: 'Kitchen device is required' });
    await requireDeviceCredential(req, restaurantId, deviceId);
    const { rows: [job] } = await pool.query(
      `UPDATE restaurant_printer_jobs pj
          SET status = 'sent',
              claimed_by_device_id = $1,
              claimed_at = NOW(),
              attempt_count = attempt_count + 1,
              error_message = NULL,
              updated_at = NOW()
         FROM restaurant_kitchen_stations ks
         JOIN restaurant_app_devices d ON d.id = ks.device_id
        WHERE pj.id = $2
          AND pj.restaurant_id = $3
          AND pj.station_id = ks.id
          AND ks.restaurant_id = $3
          AND d.id = $1
          AND d.restaurant_id = $3
          AND d.app_key = 'kitchen'
          AND d.status = 'paired'
          AND pj.status IN ('queued','failed')
        RETURNING pj.*`,
      [deviceId, jobId, restaurantId]
    );
    if (!job) throw new AppError('Printer job is no longer claimable by this device', 409, 'printer_job_unavailable');
    res.json({ job });
  } catch (err) {
    next(err);
  }
};

exports.updatePrinterJob = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const jobId = parsePositiveInt(req.params.jobId);
    const status = normalizeString(req.body.status, 24);
    if (!PRINTER_JOB_STATUSES.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported printer job status' });
    }
    const deviceId = parsePositiveInt(req.body.deviceId || req.body.device_id);
    const managerCancel = status === 'cancelled' && MANAGE_ROLES.has(restaurant.effective_role);
    if (!managerCancel && !['printed', 'failed'].includes(status)) {
      throw new AppError('Printer job transition is not allowed', 409, 'invalid_printer_job_transition');
    }
    if (!managerCancel) {
      if (!deviceId) throw new AppError('Validation failed', 400, 'validation_failed', { deviceId: 'Claiming device is required' });
      await requireDeviceCredential(req, restaurantId, deviceId);
    }
    const { rows: [job] } = await pool.query(
      `UPDATE restaurant_printer_jobs
          SET status = $1,
              error_message = $2,
              printed_at = CASE WHEN $1 = 'printed' THEN NOW() ELSE printed_at END,
              updated_at = NOW()
        WHERE id = $3 AND restaurant_id = $4
          AND (
            ($5 = TRUE AND status IN ('queued','sent','failed'))
            OR ($5 = FALSE AND status = 'sent' AND claimed_by_device_id = $6)
          )
        RETURNING *`,
      [status, normalizeString(req.body.errorMessage || req.body.error_message, 1000), jobId, restaurantId, managerCancel, deviceId]
    );
    if (!job) throw new AppError('Printer job transition is no longer allowed', 409, 'invalid_printer_job_transition');
    res.json({ job });
  } catch (err) {
    next(err);
  }
};

const CREW_SHIFT_STATUSES = new Set(['scheduled', 'open', 'closed', 'cancelled']);

async function loadCrewShift(restaurantId, shiftId) {
  if (!shiftId) return null;
  const { rows: [shift] } = await pool.query(
    `SELECT * FROM restaurant_crew_shifts WHERE restaurant_id = $1 AND id = $2`,
    [restaurantId, shiftId]
  );
  if (!shift) throw new AppError('Crew shift not found', 404, 'crew_shift_not_found');
  return shift;
}

async function validateCrewAssignee(restaurantId, assignedTo) {
  if (!assignedTo) return null;
  try {
    await requireRestaurantAccess(assignedTo, restaurantId);
  } catch (err) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      assignedTo: 'Assignee must be an active member of this restaurant',
    });
  }
  return assignedTo;
}

exports.listCrewShifts = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const params = [restaurantId];
    const filters = ['s.restaurant_id = $1'];
    const status = normalizeString(req.query.status, 24);
    if (status) {
      if (!CREW_SHIFT_STATUSES.has(status)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported shift status' });
      }
      params.push(status);
      filters.push(`s.status = $${params.length}`);
    }
    if (req.query.from) {
      params.push(req.query.from);
      filters.push(`s.ends_at >= $${params.length}`);
    }
    if (req.query.to) {
      params.push(req.query.to);
      filters.push(`s.starts_at <= $${params.length}`);
    }
    const { rows: shifts } = await pool.query(
      `SELECT s.*,
              COUNT(t.id)::int AS task_count,
              COUNT(t.id) FILTER (WHERE t.status = 'completed')::int AS completed_task_count,
              COUNT(t.id) FILTER (WHERE t.status = 'needs_approval')::int AS pending_approval_count
         FROM restaurant_crew_shifts s
         LEFT JOIN restaurant_crew_tasks t ON t.shift_id = s.id
        WHERE ${filters.join(' AND ')}
        GROUP BY s.id
        ORDER BY s.starts_at DESC
        LIMIT 100`,
      params
    );
    res.json({ shifts });
  } catch (err) {
    next(err);
  }
};

exports.createCrewShift = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const label = normalizeString(req.body.label, 160);
    const startsAt = req.body.startsAt || req.body.starts_at;
    const endsAt = req.body.endsAt || req.body.ends_at;
    if (!label || !startsAt || !endsAt || Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        shift: 'Label, startsAt, and endsAt are required',
      });
    }
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { endsAt: 'Shift must end after it starts' });
    }
    const { rows: [shift] } = await pool.query(
      `INSERT INTO restaurant_crew_shifts
         (restaurant_id, label, starts_at, ends_at, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [restaurantId, label, startsAt, endsAt, normalizeString(req.body.notes, 2000), req.user.id]
    );
    res.status(201).json({ shift });
  } catch (err) {
    next(err);
  }
};

exports.updateCrewShift = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const shiftId = parsePositiveInt(req.params.shiftId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const existing = await loadCrewShift(restaurantId, shiftId);
    const status = normalizeString(req.body.status, 24);
    if (status && !CREW_SHIFT_STATUSES.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported shift status' });
    }
    const allowedTransitions = {
      scheduled: new Set(['scheduled', 'open', 'cancelled']),
      open: new Set(['open', 'closed', 'cancelled']),
      closed: new Set(['closed']),
      cancelled: new Set(['cancelled']),
    };
    if (status && !allowedTransitions[existing.status].has(status)) {
      throw new AppError('Shift status transition is not allowed', 409, 'invalid_shift_transition');
    }
    const startsAt = req.body.startsAt || req.body.starts_at || existing.starts_at;
    const endsAt = req.body.endsAt || req.body.ends_at || existing.ends_at;
    if (Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { endsAt: 'Shift must end after it starts' });
    }
    const { rows: [shift] } = await pool.query(
      `UPDATE restaurant_crew_shifts
          SET label = COALESCE($1, label),
              starts_at = $2,
              ends_at = $3,
              notes = COALESCE($4, notes),
              status = COALESCE($5, status),
              opened_by = CASE WHEN $5 = 'open' AND opened_at IS NULL THEN $6 ELSE opened_by END,
              opened_at = CASE WHEN $5 = 'open' AND opened_at IS NULL THEN NOW() ELSE opened_at END,
              closed_by = CASE WHEN $5 = 'closed' AND closed_at IS NULL THEN $6 ELSE closed_by END,
              closed_at = CASE WHEN $5 = 'closed' AND closed_at IS NULL THEN NOW() ELSE closed_at END,
              updated_at = NOW()
        WHERE restaurant_id = $7 AND id = $8
        RETURNING *`,
      [normalizeString(req.body.label, 160), startsAt, endsAt,
        normalizeString(req.body.notes, 2000), status, req.user.id, restaurantId, shiftId]
    );
    res.json({ shift });
  } catch (err) {
    next(err);
  }
};

exports.getCrewShiftHistory = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const shiftId = parsePositiveInt(req.params.shiftId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const shift = await loadCrewShift(restaurantId, shiftId);
    const [{ rows: tasks }, { rows: proofs }, { rows: comments }, { rows: events }] = await Promise.all([
      pool.query(
        `SELECT * FROM restaurant_crew_tasks
          WHERE restaurant_id = $1 AND shift_id = $2
          ORDER BY due_at NULLS LAST, created_at ASC`,
        [restaurantId, shiftId]
      ),
      pool.query(
        `SELECT p.* FROM restaurant_crew_task_proofs p
          JOIN restaurant_crew_tasks t ON t.id = p.task_id
         WHERE t.restaurant_id = $1 AND t.shift_id = $2
         ORDER BY p.created_at ASC`,
        [restaurantId, shiftId]
      ),
      pool.query(
        `SELECT c.* FROM restaurant_crew_task_comments c
          JOIN restaurant_crew_tasks t ON t.id = c.task_id
         WHERE t.restaurant_id = $1 AND t.shift_id = $2
         ORDER BY c.created_at ASC`,
        [restaurantId, shiftId]
      ),
      pool.query(
        `SELECT e.* FROM restaurant_crew_task_events e
          JOIN restaurant_crew_tasks t ON t.id = e.task_id
         WHERE t.restaurant_id = $1 AND t.shift_id = $2
         ORDER BY e.created_at ASC`,
        [restaurantId, shiftId]
      ),
    ]);
    const presentedProofs = await Promise.all(proofs.map(presentCrewProof));
    res.json({ shift, tasks, proofs: presentedProofs, comments, events });
  } catch (err) {
    next(err);
  }
};

exports.listCrewTasks = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const mine = req.query.mine === '1' || req.query.mine === 'true';
    const params = [restaurantId];
    let where = 'restaurant_id = $1';
    if (mine) {
      params.push(req.user.id);
      where += ` AND assigned_to = $${params.length}`;
    }
    const shiftId = parsePositiveInt(req.query.shiftId || req.query.shift_id);
    if (shiftId) {
      await loadCrewShift(restaurantId, shiftId);
      params.push(shiftId);
      where += ` AND shift_id = $${params.length}`;
    }
    const status = normalizeString(req.query.status, 32);
    if (status) {
      if (!CREW_STATUS.has(status)) {
        throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported task status' });
      }
      params.push(status);
      where += ` AND status = $${params.length}`;
    }
    const { rows: tasks } = await pool.query(
      `SELECT *
         FROM restaurant_crew_tasks
        WHERE ${where}
        ORDER BY due_at NULLS LAST, created_at DESC
        LIMIT 100`,
      params
    );
    res.json({ tasks });
  } catch (err) {
    next(err);
  }
};

exports.createCrewTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const title = normalizeString(req.body.title, 200);
    if (!title) throw new AppError('Validation failed', 400, 'validation_failed', { title: 'Title is required' });
    const assignedTo = req.body.assignedTo || req.body.assigned_to || null;
    const shiftId = parsePositiveInt(req.body.shiftId || req.body.shift_id);
    await validateCrewAssignee(restaurantId, assignedTo);
    await loadCrewShift(restaurantId, shiftId);
    const task = await withTransaction(pool, async (client) => {
      const { rows: [created] } = await client.query(
        `INSERT INTO restaurant_crew_tasks
           (restaurant_id, assigned_to, shift_id, title, detail, role_label, priority, due_at,
            requires_photo, requires_approval, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          restaurantId,
          assignedTo,
          shiftId,
          title,
          normalizeString(req.body.detail, 2000),
          normalizeString(req.body.roleLabel || req.body.role_label, 120),
          ['low', 'normal', 'high', 'urgent'].includes(req.body.priority) ? req.body.priority : 'normal',
          req.body.dueAt || req.body.due_at || null,
          asBool(req.body.requiresPhoto || req.body.requires_photo),
          asBool(req.body.requiresApproval || req.body.requires_approval),
          req.user.id,
        ]
      );
      await client.query(
        `INSERT INTO restaurant_crew_task_events
           (restaurant_id, task_id, actor_user_id, event_type, new_status, metadata)
         VALUES ($1,$2,$3,'created',$4,$5)`,
        [restaurantId, created.id, req.user.id, created.status, JSON.stringify({ title: created.title })]
      );
      return created;
    }, 'restaurant_crew_task_create');
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
};

exports.updateCrewTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const status = normalizeString(req.body.status, 32);
    if (status && !CREW_STATUS.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported task status' });
    }
    const canManage = MANAGE_ROLES.has(restaurant.effective_role);
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM restaurant_crew_tasks WHERE restaurant_id = $1 AND id = $2`,
      [restaurantId, taskId]
    );
    if (!existing) throw new AppError('Crew task not found', 404, 'crew_task_not_found');
    if (!canManage && String(existing.assigned_to || '') !== String(req.user.id)) {
      throw new AppError('You do not have permission to update this task', 403, 'forbidden');
    }
    if (status && status !== existing.status && !CREW_TRANSITIONS[existing.status]?.has(status)) {
      throw new AppError('Crew task status transition is not allowed', 409, 'invalid_crew_transition');
    }
    if (!canManage && status === 'cancelled') {
      throw new AppError('Only a manager can cancel a crew task', 403, 'forbidden');
    }
    if (!canManage && ['completed', 'cancelled'].includes(existing.status)) {
      throw new AppError('A manager must reopen this task', 409, 'crew_task_terminal');
    }
    if (asBool(req.body.approve, false)) {
      throw new AppError('Use the task review endpoint for approval', 409, 'crew_review_required');
    }
    if (status === 'completed' && existing.requires_approval) {
      throw new AppError('Use the task review endpoint to complete an approval-required task', 409, 'crew_review_required');
    }
    if (['needs_approval', 'completed'].includes(status) && existing.requires_photo) {
      const { rows: [photoProof] } = await pool.query(
        `SELECT 1 FROM restaurant_crew_task_proofs
          WHERE restaurant_id = $1 AND task_id = $2 AND proof_type = 'photo'
          LIMIT 1`,
        [restaurantId, taskId]
      );
      if (!photoProof) throw new AppError('Photo proof is required before submission', 409, 'crew_photo_required');
    }
    const hasAssignee = Object.prototype.hasOwnProperty.call(req.body, 'assignedTo')
      || Object.prototype.hasOwnProperty.call(req.body, 'assigned_to');
    const hasShift = Object.prototype.hasOwnProperty.call(req.body, 'shiftId')
      || Object.prototype.hasOwnProperty.call(req.body, 'shift_id');
    if (!canManage && (hasAssignee || hasShift)) {
      throw new AppError('Only a manager can reassign a task or change its shift', 403, 'forbidden');
    }
    const assignedTo = hasAssignee ? (req.body.assignedTo || req.body.assigned_to || null) : existing.assigned_to;
    const shiftId = hasShift ? parsePositiveInt(req.body.shiftId || req.body.shift_id) : existing.shift_id;
    if (hasAssignee) await validateCrewAssignee(restaurantId, assignedTo);
    if (hasShift) await loadCrewShift(restaurantId, shiftId);
    const approve = false;
    const task = await withTransaction(pool, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_crew_tasks
          SET status = COALESCE($1, status),
              proof_url = COALESCE($2, proof_url),
              completion_note = COALESCE($3, completion_note),
              completed_at = CASE
                WHEN COALESCE($1, status) = 'completed' AND completed_at IS NULL THEN NOW()
                WHEN $1 IN ('not_started','in_progress') THEN NULL
                ELSE completed_at
              END,
              approved_by = CASE WHEN $1 IN ('not_started','in_progress') THEN NULL WHEN $4 = TRUE THEN $5 ELSE approved_by END,
              approved_at = CASE WHEN $1 IN ('not_started','in_progress') THEN NULL WHEN $4 = TRUE THEN NOW() ELSE approved_at END,
              assigned_to = $6,
              shift_id = $7,
              updated_at = NOW()
        WHERE restaurant_id = $8 AND id = $9 AND status = $10
        RETURNING *`,
      [
        status,
        normalizeString(req.body.proofUrl || req.body.proof_url, 1000),
        normalizeString(req.body.completionNote || req.body.completion_note, 2000),
        approve,
        req.user.id,
        assignedTo,
        shiftId,
        restaurantId,
        taskId,
          existing.status,
        ]
      );
      if (!updated) throw new AppError('Crew task changed before this update was applied', 409, 'crew_task_conflict');
      await client.query(
        `INSERT INTO restaurant_crew_task_events
         (restaurant_id, task_id, actor_user_id, event_type, old_status, new_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          restaurantId,
          taskId,
          req.user.id,
          approve ? 'approved' : 'updated',
          existing.status,
          updated.status,
          JSON.stringify({
            proofUrl: updated.proof_url || null,
            hasCompletionNote: Boolean(updated.completion_note),
            previousAssignedTo: existing.assigned_to || null,
            assignedTo: updated.assigned_to || null,
            previousShiftId: existing.shift_id || null,
            shiftId: updated.shift_id || null,
          }),
        ]
      );
      return updated;
    }, 'restaurant_crew_task_update');
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

exports.reviewCrewTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    const approved = req.body.approved === true || req.body.approve === true || req.body.status === 'approved';
    const rejected = req.body.rejected === true || req.body.reject === true || req.body.status === 'rejected';
    if (approved === rejected) {
      throw new AppError('Validation failed', 400, 'validation_failed', { review: 'Send either approved=true or rejected=true' });
    }
    const note = normalizeString(req.body.note || req.body.reviewNote || req.body.review_note, 2000);
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM restaurant_crew_tasks WHERE restaurant_id = $1 AND id = $2`,
      [restaurantId, taskId]
    );
    if (!existing) throw new AppError('Crew task not found', 404, 'crew_task_not_found');
    if (existing.status !== 'needs_approval') {
      throw new AppError('Only a task awaiting approval can be reviewed', 409, 'crew_task_not_awaiting_approval');
    }
    if (existing.requires_photo) {
      const { rows: [photoProof] } = await pool.query(
        `SELECT 1 FROM restaurant_crew_task_proofs
          WHERE restaurant_id = $1 AND task_id = $2 AND proof_type = 'photo'
          LIMIT 1`,
        [restaurantId, taskId]
      );
      if (!photoProof) throw new AppError('Photo proof is required before approval', 409, 'crew_photo_required');
    }

    const nextStatus = approved ? 'completed' : 'in_progress';
    const task = await withTransaction(pool, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_crew_tasks
          SET status = $1,
              approved_by = CASE WHEN $2 = TRUE THEN $3 ELSE NULL END,
              approved_at = CASE WHEN $2 = TRUE THEN NOW() ELSE NULL END,
              completion_note = COALESCE($4, completion_note),
              updated_at = NOW()
        WHERE restaurant_id = $5 AND id = $6 AND status = 'needs_approval'
        RETURNING *`,
        [nextStatus, approved, req.user.id, note, restaurantId, taskId]
      );
      if (!updated) throw new AppError('Crew task changed before review was applied', 409, 'crew_task_conflict');
      await client.query(
        `INSERT INTO restaurant_crew_task_events
         (restaurant_id, task_id, actor_user_id, event_type, old_status, new_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          restaurantId,
          taskId,
          req.user.id,
          approved ? 'approved' : 'rejected',
          existing.status,
          updated.status,
          JSON.stringify({ note }),
        ]
      );
      return updated;
    }, 'restaurant_crew_task_review');
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

exports.listCrewTaskEvents = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: events } = await pool.query(
      `SELECT *
         FROM restaurant_crew_task_events
        WHERE restaurant_id = $1 AND task_id = $2
        ORDER BY created_at ASC`,
      [restaurantId, taskId]
    );
    res.json({ events });
  } catch (err) {
    next(err);
  }
};

async function loadCrewProofTask(userId, restaurantId, taskId) {
  const restaurant = await requireRestaurantAccess(userId, restaurantId);
  const { rows: [task] } = await pool.query(
    `SELECT * FROM restaurant_crew_tasks WHERE restaurant_id = $1 AND id = $2`,
    [restaurantId, taskId]
  );
  if (!task) throw new AppError('Crew task not found', 404, 'crew_task_not_found');
  if (!MANAGE_ROLES.has(restaurant.effective_role)
    && task.assigned_to
    && String(task.assigned_to) !== String(userId)) {
    throw new AppError('You do not have permission to update this task', 403, 'forbidden');
  }
  return task;
}

async function presentCrewProof(proof) {
  if (!proof?.storage_key) return proof;
  const signedUrl = await getSignedDownloadUrl(proof.storage_key, 3600);
  return {
    ...proof,
    file_url: signedUrl,
    download_url: signedUrl,
    download_expires_in_seconds: 3600,
  };
}

async function persistCrewProof({
  restaurantId,
  task,
  userId,
  proofType,
  storageKey,
  fileUrl,
  fileName,
  fileSize,
  contentType,
  checksumSha256,
  note,
  metadata,
}) {
  const privateReference = storageKey ? `private://${storageKey}` : fileUrl;
  return withTransaction(pool, async (client) => {
    const { rows: [proof] } = await client.query(
      `INSERT INTO restaurant_crew_task_proofs
         (restaurant_id, task_id, submitted_by, proof_type, file_url, storage_key,
          file_name, file_size, content_type, checksum_sha256, note, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        restaurantId,
        task.id,
        userId,
        proofType,
        privateReference,
        storageKey || null,
        fileName,
        fileSize,
        contentType,
        checksumSha256,
        note,
        JSON.stringify(metadata),
      ]
    );
    const proofSatisfiesRequirement = !task.requires_photo || proofType === 'photo';
    const nextStatus = proofSatisfiesRequirement
      ? (task.requires_approval ? 'needs_approval' : 'completed')
      : task.status;
    const { rows: [updatedTask] } = await client.query(
      `UPDATE restaurant_crew_tasks
          SET proof_url = COALESCE(proof_url, $1),
              completion_note = COALESCE($2, completion_note),
              status = CASE
                WHEN $6 = TRUE AND status IN ('not_started','in_progress') THEN $3
                ELSE status
              END,
              completed_at = CASE
                WHEN $6 = TRUE AND $3 = 'completed' AND status IN ('not_started','in_progress')
                  THEN COALESCE(completed_at, NOW())
                ELSE completed_at
              END,
              updated_at = NOW()
        WHERE restaurant_id = $4 AND id = $5
        RETURNING *`,
      [privateReference, note, nextStatus, restaurantId, task.id, proofSatisfiesRequirement]
    );
    await client.query(
      `INSERT INTO restaurant_crew_task_events
         (restaurant_id, task_id, actor_user_id, event_type, old_status, new_status, metadata)
       VALUES ($1,$2,$3,'proof_submitted',$4,$5,$6)`,
      [
        restaurantId,
        task.id,
        userId,
        task.status,
        updatedTask.status,
        JSON.stringify({ proofId: proof.id, proofType, storageKey, checksumSha256, proofSatisfiesRequirement }),
      ]
    );
    return { proof, task: updatedTask };
  });
}

exports.listCrewTaskProofs = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: proofs } = await pool.query(
      `SELECT p.*, u.first_name, u.last_name
         FROM restaurant_crew_task_proofs p
         LEFT JOIN users u ON u.id = p.submitted_by
        WHERE p.restaurant_id = $1 AND p.task_id = $2
        ORDER BY p.created_at ASC`,
      [restaurantId, taskId]
    );
    res.json({ proofs: await Promise.all(proofs.map(presentCrewProof)) });
  } catch (err) {
    next(err);
  }
};

exports.addCrewTaskProof = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const task = await loadCrewProofTask(req.user.id, restaurantId, taskId);
    const storageKey = normalizeString(req.body.storageKey || req.body.storage_key, 1000);
    const fileUrl = normalizeString(req.body.fileUrl || req.body.file_url, 1000);
    const allowedPrefix = `user-uploads/${req.user.id}/`;
    const hasDirectUrl = fileUrl && /^https?:\/\//i.test(fileUrl);
    if (!hasDirectUrl && (!storageKey || !storageKey.startsWith(allowedPrefix))) {
      throw new AppError(
        'Upload the proof first and provide its authenticated storage key',
        400,
        'crew_proof_storage_key_required'
      );
    }
    const proofType = normalizeString(req.body.proofType || req.body.proof_type, 32) || 'photo';
    if (!CREW_PROOF_TYPES.has(proofType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { proofType: 'Unsupported proof type' });
    }
    const note = normalizeString(req.body.note, 1000);
    const result = await persistCrewProof({
      restaurantId,
      task,
      userId: req.user.id,
      proofType,
      storageKey,
      fileUrl: hasDirectUrl ? fileUrl : null,
      fileName: normalizeString(req.body.fileName || req.body.file_name, 255),
      fileSize: parsePositiveInt(req.body.fileSize || req.body.file_size),
      contentType: normalizeString(req.body.contentType || req.body.content_type, 160),
      checksumSha256: normalizeString(req.body.checksumSha256 || req.body.checksum_sha256, 64),
      note,
      metadata: safeJson(req.body.metadata),
    });
    res.status(201).json({ ...result, proof: await presentCrewProof(result.proof) });
  } catch (err) {
    next(err);
  }
};

exports.uploadCrewTaskProof = async (req, res, next) => {
  let storageKey = null;
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const task = await loadCrewProofTask(req.user.id, restaurantId, taskId);
    if (!req.file) throw new AppError('Proof file is required', 400, 'proof_file_required');
    const proofType = normalizeString(req.body.proofType || req.body.proof_type, 32)
      || (req.file.mimetype.startsWith('image/') ? 'photo'
        : req.file.mimetype === 'application/pdf' ? 'document' : 'other');
    if (!CREW_PROOF_TYPES.has(proofType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { proofType: 'Unsupported proof type' });
    }
    storageKey = await uploadFile(
      req.file.buffer,
      `restaurant-crew-proofs/${restaurantId}/${taskId}`,
      req.file.originalname,
      req.file.mimetype
    );
    if (!storageKey) throw new AppError('Private file storage is not configured', 503, 'file_storage_not_configured');
    const checksumSha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const result = await persistCrewProof({
      restaurantId,
      task,
      userId: req.user.id,
      proofType,
      storageKey,
      fileName: normalizeString(req.file.originalname, 255),
      fileSize: req.file.size,
      contentType: normalizeString(req.file.mimetype, 160),
      checksumSha256,
      note: normalizeString(req.body.note, 1000),
      metadata: safeJson(req.body.metadata),
    });
    res.status(201).json({ ...result, proof: await presentCrewProof(result.proof) });
  } catch (err) {
    if (storageKey) await deleteFile(storageKey).catch(() => {});
    next(err);
  }
};

exports.listCrewTaskComments = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: comments } = await pool.query(
      `SELECT c.*, u.first_name, u.last_name
         FROM restaurant_crew_task_comments c
         LEFT JOIN users u ON u.id = c.author_user_id
        WHERE c.restaurant_id = $1 AND c.task_id = $2
        ORDER BY c.created_at ASC`,
      [restaurantId, taskId]
    );
    res.json({ comments });
  } catch (err) {
    next(err);
  }
};

exports.addCrewTaskComment = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const comment = normalizeString(req.body.comment, 2000);
    if (!comment) throw new AppError('Validation failed', 400, 'validation_failed', { comment: 'Comment is required' });
    const { rows: [task] } = await pool.query(
      `SELECT id FROM restaurant_crew_tasks WHERE id = $1 AND restaurant_id = $2`,
      [taskId, restaurantId]
    );
    if (!task) throw new AppError('Crew task not found', 404, 'crew_task_not_found');
    const { rows: [created] } = await pool.query(
      `INSERT INTO restaurant_crew_task_comments
         (restaurant_id, task_id, author_user_id, comment, attachment_url)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [restaurantId, taskId, req.user.id, comment, normalizeString(req.body.attachmentUrl || req.body.attachment_url, 1000)]
    );
    res.status(201).json({ comment: created });
  } catch (err) {
    next(err);
  }
};

exports.updateRunnerDispatch = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const canManage = MANAGE_ROLES.has(restaurant.effective_role);
    const hasAssignedTo = Object.prototype.hasOwnProperty.call(req.body, 'assignedTo')
      || Object.prototype.hasOwnProperty.call(req.body, 'assigned_to');
    const assignedTo = req.body.assignedTo ?? req.body.assigned_to ?? null;
    const release = asBool(req.body.release, false);
    const markHandoff = asBool(req.body.markHandoff || req.body.mark_handoff, false);
    if (markHandoff) {
      throw new AppError('Customer handoff is recorded by task completion or proof submission', 409, 'runner_proof_required');
    }
    if (assignedTo && !canManage) {
      throw new AppError('You do not have permission to reassign runner tasks', 403, 'forbidden');
    }
    if ((release || (hasAssignedTo && !assignedTo)) && !canManage) {
      throw new AppError('You do not have permission to release runner tasks', 403, 'forbidden');
    }
    const { rows: [currentTask] } = await pool.query(
      `SELECT * FROM restaurant_runner_tasks WHERE restaurant_id = $1 AND id = $2`,
      [restaurantId, taskId]
    );
    if (!currentTask) throw new AppError('Runner task not found', 404, 'runner_task_not_found');
    if (!canManage && String(currentTask.assigned_to || '') !== String(req.user.id)) {
      throw new AppError('This runner task is assigned to another user', 403, 'runner_task_not_assigned');
    }
    if (assignedTo) {
      const { rows: [eligible] } = await pool.query(
        `SELECT 1
           FROM businesses b
          WHERE b.id = $1
            AND (b.user_id = $2 OR EXISTS (
              SELECT 1 FROM business_members bm
               WHERE bm.business_id = b.id AND bm.member_id = $2 AND bm.status = 'active'
            ))`,
        [restaurant.business_id, assignedTo]
      );
      if (!eligible) throw new AppError('Assigned runner is not an active restaurant member', 400, 'runner_not_eligible');
    }
    const { rows: [task] } = await pool.query(
      `UPDATE restaurant_runner_tasks
          SET assigned_to = CASE
                WHEN $1 = TRUE THEN NULL
                WHEN $2 = TRUE THEN $3::uuid
                ELSE assigned_to
              END,
              status = CASE
                WHEN $1 = TRUE AND status = 'Assigned' THEN 'Queued'
                WHEN $3::uuid IS NOT NULL AND status = 'Queued' THEN 'Assigned'
                ELSE status
              END,
              assignment_source = CASE
                WHEN $1 = TRUE THEN NULL
                WHEN $3::uuid IS NOT NULL THEN 'manager'
                ELSE assignment_source
              END,
              accepted_at = CASE
                WHEN $1 = TRUE THEN NULL
                WHEN $3::uuid IS NOT NULL THEN COALESCE(accepted_at, NOW())
                ELSE accepted_at
              END,
              offered_at = CASE WHEN $1 = TRUE THEN NOW() ELSE offered_at END,
              route_window = COALESCE($4, route_window),
              pickup_eta_at = COALESCE($5::timestamptz, pickup_eta_at),
              delivery_eta_at = COALESCE($6::timestamptz, delivery_eta_at),
              handoff_at = CASE WHEN $7 = TRUE THEN NOW() ELSE handoff_at END,
              updated_at = NOW()
        WHERE restaurant_id = $8 AND id = $9
        RETURNING *`,
      [
        release,
        hasAssignedTo,
        assignedTo,
        normalizeString(req.body.routeWindow || req.body.route_window, 80),
        req.body.pickupEtaAt || req.body.pickup_eta_at || null,
        req.body.deliveryEtaAt || req.body.delivery_eta_at || null,
        markHandoff,
        restaurantId,
        taskId,
      ]
    );
    if (!task) throw new AppError('Runner task not found', 404, 'runner_task_not_found');
    broadcastRestaurant(restaurant, 'food:runner:dispatch:updated', { task });
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

exports.listRunnerOffers = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: offers } = await pool.query(
      `SELECT t.*,
              o.guest_name AS customer_name,
              o.fulfillment_type,
              o.total_cents,
              o.tip_cents,
              o.metadata AS order_metadata
         FROM restaurant_runner_tasks t
         LEFT JOIN food_orders o ON o.id = t.food_order_id
        WHERE t.restaurant_id = $1
          AND t.assigned_to IS NULL
          AND t.status IN ('Queued','Ready')
          AND (t.offer_expires_at IS NULL OR t.offer_expires_at > NOW())
          AND NOT EXISTS (
            SELECT 1
              FROM restaurant_runner_task_declines d
             WHERE d.task_id = t.id AND d.runner_user_id = $2
          )
        ORDER BY CASE WHEN t.status = 'Ready' THEN 0 ELSE 1 END,
                 COALESCE(t.delivery_eta_at, t.created_at) ASC
        LIMIT 100`,
      [restaurantId, req.user.id]
    );
    res.json({ offers });
  } catch (err) {
    next(err);
  }
};

exports.claimRunnerTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const task = await withTransaction(pool, async (client) => {
      const { rows: [claimed] } = await client.query(
        `UPDATE restaurant_runner_tasks
            SET assigned_to = $1,
                status = CASE WHEN status = 'Queued' THEN 'Assigned' ELSE status END,
                assignment_source = 'self_claim',
                accepted_at = NOW(),
                updated_at = NOW()
          WHERE restaurant_id = $2
            AND id = $3
            AND assigned_to IS NULL
            AND status IN ('Queued','Ready')
            AND (offer_expires_at IS NULL OR offer_expires_at > NOW())
            AND NOT EXISTS (
              SELECT 1
                FROM restaurant_runner_task_declines d
               WHERE d.task_id = restaurant_runner_tasks.id
                 AND d.runner_user_id = $1
            )
          RETURNING *`,
        [req.user.id, restaurantId, taskId]
      );
      if (!claimed) {
        const { rows: [existing] } = await client.query(
          `SELECT assigned_to, status, offer_expires_at
             FROM restaurant_runner_tasks
            WHERE restaurant_id = $1 AND id = $2`,
          [restaurantId, taskId]
        );
        if (!existing) throw new AppError('Runner task not found', 404, 'runner_task_not_found');
        throw new AppError('This delivery offer is no longer available', 409, 'runner_offer_unavailable');
      }
      return claimed;
    });
    broadcastRestaurant(restaurant, 'food:runner:task:claimed', { task });
    res.json({ task });
  } catch (err) {
    next(err);
  }
};

exports.declineRunnerTask = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows: [decline] } = await pool.query(
      `INSERT INTO restaurant_runner_task_declines
         (restaurant_id, task_id, runner_user_id, reason)
       SELECT $1, t.id, $3, $4
         FROM restaurant_runner_tasks t
        WHERE t.restaurant_id = $1
          AND t.id = $2
          AND t.assigned_to IS NULL
          AND t.status IN ('Queued','Ready')
       ON CONFLICT (task_id, runner_user_id)
       DO UPDATE SET reason = EXCLUDED.reason, created_at = NOW()
       RETURNING *`,
      [restaurantId, taskId, req.user.id, normalizeString(req.body.reason, 1000)]
    );
    if (!decline) throw new AppError('This delivery offer is no longer available', 409, 'runner_offer_unavailable');
    broadcastRestaurant(restaurant, 'food:runner:task:declined', { taskId, runnerUserId: req.user.id });
    res.status(201).json({ decline });
  } catch (err) {
    next(err);
  }
};

exports.logRunnerLocation = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId || req.body.taskId || req.body.task_id);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const latitude = parseFiniteNumber(req.body.latitude ?? req.body.lat, 'latitude');
    const longitude = parseFiniteNumber(req.body.longitude ?? req.body.lng, 'longitude');
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new AppError('Validation failed', 400, 'validation_failed', { location: 'Invalid latitude/longitude' });
    }
    if (taskId) {
      const { rows: [task] } = await pool.query(
        `SELECT id, assigned_to, status FROM restaurant_runner_tasks WHERE id = $1 AND restaurant_id = $2`,
        [taskId, restaurantId]
      );
      if (!task) throw new AppError('Runner task not found', 404, 'runner_task_not_found');
      if (!MANAGE_ROLES.has(restaurant.effective_role)
        && String(task.assigned_to || '') !== String(req.user.id)) {
        throw new AppError('This runner task is assigned to another user', 403, 'runner_task_not_assigned');
      }
    }
    const canManage = MANAGE_ROLES.has(restaurant.effective_role);
    const runnerUserId = canManage
      ? (req.body.runnerUserId || req.body.runner_user_id || req.user.id)
      : req.user.id;
    const capturedAt = req.body.capturedAt || req.body.captured_at || null;
    const { rows: [ping] } = await pool.query(
      `INSERT INTO restaurant_runner_location_pings
         (restaurant_id, task_id, runner_user_id, latitude, longitude, accuracy_meters, captured_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, NOW()))
       RETURNING *`,
      [
        restaurantId,
        taskId,
        runnerUserId,
        latitude,
        longitude,
        req.body.accuracyMeters ?? req.body.accuracy_meters ?? null,
        capturedAt,
      ]
    );
    if (taskId) {
      await pool.query(
        `UPDATE restaurant_runner_tasks
            SET last_latitude = $1,
                last_longitude = $2,
                last_location_at = $3,
                updated_at = NOW()
          WHERE id = $4 AND restaurant_id = $5`,
        [latitude, longitude, ping.captured_at, taskId, restaurantId]
      );
    }
    broadcastRestaurant(restaurant, 'food:runner:location', { ping });
    res.status(201).json({ ping });
  } catch (err) {
    next(err);
  }
};

exports.listRunnerSettlements = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const status = normalizeString(req.query.status, 24);
    const params = [restaurantId];
    let filter = '';
    if (status && RUNNER_SETTLEMENT_STATUSES.has(status)) {
      params.push(status);
      filter = `AND status = $${params.length}`;
    }
    if (!MANAGE_ROLES.has(restaurant.effective_role)) {
      params.push(req.user.id);
      filter += ` AND runner_user_id = $${params.length}`;
    }
    const { rows: settlements } = await pool.query(
      `SELECT *
         FROM restaurant_runner_settlements
        WHERE restaurant_id = $1 ${filter}
        ORDER BY created_at DESC
        LIMIT 100`,
      params
    );
    res.json({ settlements });
  } catch (err) {
    next(err);
  }
};

exports.upsertRunnerSettlement = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const taskId = parsePositiveInt(req.params.taskId || req.body.taskId || req.body.task_id);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const canManage = MANAGE_ROLES.has(restaurant.effective_role);
    const status = normalizeString(req.body.status, 24) || 'pending';
    if (!RUNNER_SETTLEMENT_STATUSES.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { status: 'Unsupported settlement status' });
    }
    if (!taskId) {
      throw new AppError('Validation failed', 400, 'validation_failed', { taskId: 'Runner task is required' });
    }
    if (['approved', 'paid', 'voided'].includes(status) && !canManage) {
      throw new AppError('You do not have permission to approve settlements', 403, 'forbidden');
    }
    const cashCollectedCents = parseCents(
      req.body.cashCollectedCents ?? req.body.cash_collected_cents,
      'cashCollectedCents'
    );
    const settlementTransitions = {
      pending: new Set(['pending', 'approved', 'disputed', 'voided']),
      disputed: new Set(['pending', 'approved', 'disputed', 'voided']),
      approved: new Set(['approved', 'paid', 'disputed', 'voided']),
      paid: new Set(['paid']),
      voided: new Set(['voided']),
    };
    const settlement = await withTransaction(pool, async (client) => {
      const { rows: [task] } = await client.query(
        `SELECT t.id, t.food_order_id, t.assigned_to, t.status AS task_status,
                t.handoff_at, t.cash_collection_required,
                fo.delivery_fee_cents, fo.tip_cents, fo.total_cents,
                fo.payment_status, fo.fulfillment_type
           FROM restaurant_runner_tasks t
           LEFT JOIN food_orders fo ON fo.id = t.food_order_id
          WHERE t.id = $1 AND t.restaurant_id = $2
          FOR UPDATE OF t`,
        [taskId, restaurantId]
      );
      if (!task) throw new AppError('Runner task not found', 404, 'runner_task_not_found');
      if (!canManage && String(task.assigned_to || '') !== String(req.user.id)) {
        throw new AppError('This runner task is assigned to another user', 403, 'runner_task_not_assigned');
      }
      if (!task.assigned_to) throw new AppError('Runner task must be assigned before settlement', 409, 'runner_task_unassigned');
      if (status !== 'voided' && (task.task_status !== 'Completed' || !task.handoff_at)) {
        throw new AppError('Settlement requires a completed customer handoff', 409, 'runner_handoff_incomplete');
      }
      if (cashCollectedCents > 0 && !task.cash_collection_required) {
        throw new AppError('This delivery does not require cash collection', 409, 'cash_collection_not_required');
      }
      if (cashCollectedCents > Number(task.total_cents || 0)) {
        throw new AppError('Cash collected exceeds the order total', 409, 'cash_collection_exceeds_order');
      }
      const { rows: [existingSettlement] } = await client.query(
        `SELECT * FROM restaurant_runner_settlements
          WHERE restaurant_id = $1 AND task_id = $2
          FOR UPDATE`,
        [restaurantId, taskId]
      );
      if (!existingSettlement && status !== 'pending') {
        throw new AppError('A new settlement must start as pending', 409, 'invalid_settlement_transition');
      }
      if (existingSettlement && !settlementTransitions[existingSettlement.status]?.has(status)) {
        throw new AppError('Settlement status transition is not allowed', 409, 'invalid_settlement_transition');
      }
      const { rows: [updated] } = await client.query(
        `INSERT INTO restaurant_runner_settlements
         (restaurant_id, task_id, food_order_id, runner_user_id, delivery_fee_cents, tip_cents,
          cash_collected_cents, status, note, approved_by, approved_at, paid_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
               CASE WHEN $8 = 'approved' THEN NOW() ELSE NULL END,
               CASE WHEN $8 = 'paid' THEN NOW() ELSE NULL END,
               $11)
       ON CONFLICT (restaurant_id, task_id) WHERE task_id IS NOT NULL
       DO UPDATE SET food_order_id = EXCLUDED.food_order_id,
                     runner_user_id = EXCLUDED.runner_user_id,
                     delivery_fee_cents = EXCLUDED.delivery_fee_cents,
                     tip_cents = EXCLUDED.tip_cents,
                     cash_collected_cents = EXCLUDED.cash_collected_cents,
                     status = EXCLUDED.status,
                     note = EXCLUDED.note,
                     approved_by = COALESCE(EXCLUDED.approved_by, restaurant_runner_settlements.approved_by),
                     approved_at = CASE WHEN EXCLUDED.status = 'approved' THEN NOW() ELSE restaurant_runner_settlements.approved_at END,
                     paid_at = CASE WHEN EXCLUDED.status = 'paid' THEN NOW() ELSE restaurant_runner_settlements.paid_at END,
                     metadata = restaurant_runner_settlements.metadata || EXCLUDED.metadata
       RETURNING *`,
        [
          restaurantId,
          taskId,
          task.food_order_id,
          task.assigned_to,
          Number(task.delivery_fee_cents || 0),
          Number(task.tip_cents || 0),
          cashCollectedCents,
          status,
          normalizeString(req.body.note, 1000),
          ['approved', 'paid'].includes(status) ? req.user.id : null,
          safeJson(req.body.metadata),
        ]
      );
      return updated;
    }, 'restaurant_runner_settlement_upsert');
    res.status(201).json({ settlement });
  } catch (err) {
    next(err);
  }
};

exports.syncMenuAvailability = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const apply = req.body.apply === true || req.query.apply === 'true';
    const result = await withTransaction(pool, async (client) => {
      return syncMappedMenuAvailability(client, restaurantId, {
        apply,
        createdBy: req.user.id,
      });
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};
