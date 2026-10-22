'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { getLocationScope } = require('../services/restaurantLocationAccessService');
const permissionsService = require('../services/permissionsService');
const { logBusinessAction } = require('../services/businessAuditLog');

function parsePositiveInt(value) {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeString(value, max = 255) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

const RECEIPT_CHANNELS = new Set(['Counter', 'Payment update', 'Printed', 'SMS', 'Email']);
const RECEIPT_EVENT_TYPES = new Set([
  'receipt',
  'order_created',
  'payment_recorded',
  'payment_refunded',
  'ticket_voided',
  'ticket_held',
  'ticket_reopened',
  'receipt_reprinted',
]);

const DEFAULT_POS_DISCOUNTS = [
  { id: 'WELCOME10', code: 'WELCOME10', name: 'Welcome 10%', title: 'Welcome 10%', discount_type: 'percent', value: 10, percentOff: 0.10 },
  { id: 'LUNCH15', code: 'LUNCH15', name: 'Lunch 15%', title: 'Lunch 15%', discount_type: 'percent', value: 15, percentOff: 0.15 },
  { id: 'VIP20', code: 'VIP20', name: 'VIP 20%', title: 'VIP 20%', discount_type: 'percent', value: 20, percentOff: 0.20 },
];

// Canonical restaurant access gate (analytics scope model, Phase 1 Item 6).
// The fast-fail `!restaurantId` guard is preserved here (not inside the
// shared gate) so invalid ids keep this module's exact 404 behavior.
async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return resolveRestaurantAccess(userId, restaurantId);
}

async function assertPosPermission(restaurant, userId, permissions = ['pos.use', 'pos.manage']) {
  if (restaurant.effective_role === 'owner') return;
  if (!await permissionsService.hasRestaurantPermission(restaurant, userId, permissions)) {
    throw new AppError('You do not have permission to use the POS', 403, 'forbidden');
  }
}

exports.listDiscounts = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    // F-15: the restaurant's own active discount definitions ride along
    // with the legacy global codes so the POS picker shows both.
    const discountDefinitions = await fetchDiscountDefinitions(restaurantId, { activeOnly: true });
    res.json({ discounts: DEFAULT_POS_DISCOUNTS, discountDefinitions });
  } catch (err) {
    next(err);
  }
};

exports.listReceiptEvents = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    const locationScope = await getLocationScope(restaurant, req.user.id);
    const limit = Math.min(parsePositiveInt(req.query.limit) || 30, 100);
    const params = locationScope.mode === 'assigned'
      ? [restaurantId, locationScope.location_ids, limit]
      : [restaurantId, limit];
    const locationFilter = locationScope.mode === 'assigned' ? ' AND location_id = ANY($2::bigint[])' : '';
    const limitParam = locationScope.mode === 'assigned' ? '$3' : '$2';

    const { rows } = await pool.query(
      `SELECT *
         FROM restaurant_pos_receipt_events
        WHERE restaurant_id = $1${locationFilter}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limitParam}`,
      params
    );

    res.json({ receiptEvents: rows });
  } catch (err) {
    next(err);
  }
};

exports.createReceiptEvent = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    // Receipt events are part of the money-facing POS history. Membership
    // alone must not allow a caller to mint one.
    await assertPosPermission(restaurant, req.user.id);
    const locationScope = await getLocationScope(restaurant, req.user.id);

    const orderId = parsePositiveInt(req.body.orderId || req.body.order_id);
    const queueNumber = parsePositiveInt(req.body.queueNumber || req.body.queue_number);
    const totalCents = Number.parseInt(req.body.totalCents ?? req.body.total_cents, 10);
    const paymentStatus = normalizeString(req.body.paymentStatus || req.body.payment_status, 32);
    const channel = normalizeString(req.body.channel, 32);
    const guestName = normalizeString(req.body.guestName || req.body.guest_name, 140);
    const eventType = normalizeString(req.body.eventType || req.body.event_type, 64) || 'receipt';
    const idempotencyKey = normalizeString(
      req.get('Idempotency-Key') || req.body.idempotencyKey || req.body.idempotency_key,
      200
    );

    if (!orderId) throw new AppError('Validation failed', 400, 'validation_failed', { orderId: 'Order is required' });
    if (!queueNumber) throw new AppError('Validation failed', 400, 'validation_failed', { queueNumber: 'Queue number is required' });
    if (!Number.isInteger(totalCents) || totalCents < 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { totalCents: 'Total cents must be a non-negative integer' });
    }
    if (!paymentStatus) throw new AppError('Validation failed', 400, 'validation_failed', { paymentStatus: 'Payment status is required' });
    if (!channel || !RECEIPT_CHANNELS.has(channel)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { channel: 'Unsupported receipt channel' });
    }
    if (!RECEIPT_EVENT_TYPES.has(eventType)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { eventType: 'Unsupported receipt event type' });
    }

    const { rows: [order] } = await pool.query(
      `SELECT id
              , location_id, queue_number, total_cents, payment_status
         FROM food_orders
        WHERE id = $1
          AND restaurant_id = $2${locationScope.mode === 'assigned' ? ' AND location_id = ANY($3::bigint[])' : ''}`,
      locationScope.mode === 'assigned' ? [orderId, restaurantId, locationScope.location_ids] : [orderId, restaurantId]
    );
    if (!order) throw new AppError('Order not found', 404, 'order_not_found');
    if (Number(order.queue_number) !== queueNumber || Number(order.total_cents) !== totalCents) {
      throw new AppError('Receipt totals do not match the server order', 409, 'receipt_order_mismatch');
    }

    const { rows: [receiptEvent] } = await pool.query(
      `INSERT INTO restaurant_pos_receipt_events
         (restaurant_id, location_id, food_order_id, queue_number, guest_name, total_cents,
          payment_status, channel, event_type, reason, metadata, idempotency_key, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
       ON CONFLICT (restaurant_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL
       DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [
        restaurantId,
        order.location_id,
        orderId,
        queueNumber,
        guestName,
        totalCents,
        paymentStatus,
        channel,
        eventType,
        normalizeString(req.body.reason || req.body.note, 1000),
        JSON.stringify(req.body.metadata && typeof req.body.metadata === 'object' && !Array.isArray(req.body.metadata)
          ? req.body.metadata
          : {}),
        idempotencyKey,
        req.user.id,
      ]
    );

    res.status(idempotencyKey ? 200 : 201).json({ receiptEvent });
  } catch (err) {
    next(err);
  }
};

// ---------------------------------------------------------------------------
// F-15: per-restaurant POS discount definitions (migration 953).
// Merchant-managed (restaurant.manage) and audited through
// business_audit_log. The POS computes amounts server-side from these
// rows in createPosOrder; clients never supply a definition's value.
// ---------------------------------------------------------------------------

function serializeDiscountDefinition(row) {
  if (!row) return null;
  const value = Number(row.value);
  return {
    id: Number(row.id),
    restaurant_id: Number(row.restaurant_id),
    code: row.code,
    name: row.name,
    kind: row.kind,
    discount_type: row.kind,
    value,
    value_cents: row.kind === 'fixed' ? value : null,
    percentOff: row.kind === 'percent' ? value / 100 : 0,
    max_discount_cents: row.max_discount_cents === null || row.max_discount_cents === undefined
      ? null
      : Number(row.max_discount_cents),
    min_subtotal_cents: Number(row.min_subtotal_cents || 0),
    requires_approval: row.requires_approval === true,
    is_active: row.is_active !== false,
    created_by: row.created_by || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function fetchDiscountDefinitions(restaurantId, { activeOnly = false } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM restaurant_discount_definitions
      WHERE restaurant_id = $1 ${activeOnly ? 'AND is_active = TRUE' : ''}
      ORDER BY code ASC`,
    [restaurantId]
  );
  return rows.map(serializeDiscountDefinition);
}

exports.fetchDiscountDefinitions = fetchDiscountDefinitions;
exports.serializeDiscountDefinition = serializeDiscountDefinition;

// Same gate as restaurantAppFlowController.assertManage: the unified
// permission resolver decides restaurant.manage for this caller.
async function assertManage(restaurant, userId) {
  const allowed = await permissionsService.hasRestaurantPermission(restaurant, userId, ['restaurant.manage']);
  if (!allowed) {
    throw new AppError('You do not have permission to manage this restaurant', 403, 'forbidden');
  }
}

function parseNullableCents(value, field, fields) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    fields[field] = 'Must be a non-negative integer number of cents';
    return undefined;
  }
  return n;
}

function parseDiscountDefinitionFields(body, { partial = false } = {}) {
  const fields = {};
  const source = body && typeof body === 'object' ? body : {};
  const out = {};
  const has = (key) => source[key] !== undefined;

  if (!partial || has('code')) {
    const code = normalizeString(source.code, 80);
    if (!code) fields.code = 'Code is required';
    else if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(code)) fields.code = 'Code may only contain letters, numbers, dashes and underscores';
    else out.code = code.toUpperCase();
  }
  if (!partial || has('name')) {
    const name = normalizeString(source.name, 160);
    if (!name) fields.name = 'Name is required';
    else out.name = name;
  }
  if (!partial || has('kind') || has('value')) {
    const kind = normalizeString(source.kind, 16);
    if (kind && kind !== 'percent' && kind !== 'fixed') fields.kind = "Kind must be 'percent' or 'fixed'";
    else if (!partial && !kind) fields.kind = "Kind must be 'percent' or 'fixed'";
    else if (kind) out.kind = kind;
    const value = Number(source.value);
    if (!Number.isInteger(value)) fields.value = 'Value must be an integer';
    else if (out.kind === 'percent' && (value < 1 || value > 100)) fields.value = 'Percent value must be between 1 and 100';
    else if (out.kind === 'fixed' && value < 1) fields.value = 'Fixed value must be at least 1 cent';
    else if ((out.kind === undefined || out.kind === null) && value < 1) fields.value = 'Value must be at least 1';
    else out.value = value;
  }
  if (!partial || has('max_discount_cents') || has('maxDiscountCents')) {
    const parsed = parseNullableCents(source.max_discount_cents ?? source.maxDiscountCents, 'max_discount_cents', fields);
    if (parsed !== undefined) out.max_discount_cents = parsed;
  }
  if (!partial || has('min_subtotal_cents') || has('minSubtotalCents')) {
    const raw = source.min_subtotal_cents ?? source.minSubtotalCents;
    if (raw === undefined || raw === null || raw === '') out.min_subtotal_cents = 0;
    else {
      const parsed = parseNullableCents(raw, 'min_subtotal_cents', fields);
      if (parsed !== undefined && parsed !== null) out.min_subtotal_cents = parsed;
    }
  }
  if (!partial || has('requires_approval') || has('requiresApproval')) {
    const raw = source.requires_approval ?? source.requiresApproval;
    out.requires_approval = raw === true || raw === 'true';
  }
  if (has('is_active') || has('isActive')) {
    const raw = source.is_active ?? source.isActive;
    out.is_active = !(raw === false || raw === 'false');
  }
  if (Object.keys(fields).length) {
    throw new AppError('Validation failed', 400, 'validation_failed', fields);
  }
  return out;
}

async function loadDiscountDefinition(restaurantId, definitionId) {
  const { rows: [row] } = await pool.query(
    'SELECT * FROM restaurant_discount_definitions WHERE id = $1 AND restaurant_id = $2',
    [definitionId, restaurantId]
  );
  if (!row) throw new AppError('Discount definition not found', 404, 'discount_definition_not_found');
  return row;
}

exports.listDiscountDefinitions = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const discountDefinitions = await fetchDiscountDefinitions(restaurantId);
    res.json({ discountDefinitions });
  } catch (err) {
    next(err);
  }
};

exports.createDiscountDefinition = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const fields = parseDiscountDefinitionFields(req.body);
    let row;
    try {
      const { rows: [created] } = await pool.query(
        `INSERT INTO restaurant_discount_definitions
           (restaurant_id, code, name, kind, value, max_discount_cents,
            min_subtotal_cents, requires_approval, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING *`,
        [
          restaurantId,
          fields.code,
          fields.name,
          fields.kind,
          fields.value,
          fields.max_discount_cents ?? null,
          fields.min_subtotal_cents ?? 0,
          fields.requires_approval === true,
          fields.is_active !== false,
          req.user.id,
        ]
      );
      row = created;
    } catch (err) {
      if (err && err.code === '23505') {
        throw new AppError('A discount with this code already exists for this restaurant', 409, 'discount_definition_code_taken');
      }
      throw err;
    }
    const discountDefinition = serializeDiscountDefinition(row);
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.discount_definition.created',
      target_type: 'discount_definition',
      target_id: discountDefinition.id,
      after_state: discountDefinition,
    });
    res.status(201).json({ discountDefinition });
  } catch (err) {
    next(err);
  }
};

exports.updateDiscountDefinition = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const definitionId = parsePositiveInt(req.params.definitionId);
    if (!definitionId) throw new AppError('Discount definition not found', 404, 'discount_definition_not_found');
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const existing = await loadDiscountDefinition(restaurantId, definitionId);
    const fields = parseDiscountDefinitionFields(req.body, { partial: true });
    // Kind/value validate against the merged record: switching kind
    // re-checks the value range even when only one of them was sent.
    const merged = { ...serializeDiscountDefinition(existing), ...fields };
    if (merged.kind === 'percent' && (merged.value < 1 || merged.value > 100)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { value: 'Percent value must be between 1 and 100' });
    }
    if (merged.kind === 'fixed' && merged.value < 1) {
      throw new AppError('Validation failed', 400, 'validation_failed', { value: 'Fixed value must be at least 1 cent' });
    }
    let row;
    try {
      const { rows: [updated] } = await pool.query(
        `UPDATE restaurant_discount_definitions
            SET code = $3, name = $4, kind = $5, value = $6,
                max_discount_cents = $7, min_subtotal_cents = $8,
                requires_approval = $9, is_active = $10, updated_at = NOW()
          WHERE id = $1 AND restaurant_id = $2
          RETURNING *`,
        [
          definitionId,
          restaurantId,
          merged.code,
          merged.name,
          merged.kind,
          merged.value,
          merged.max_discount_cents ?? null,
          merged.min_subtotal_cents ?? 0,
          merged.requires_approval === true,
          merged.is_active !== false,
        ]
      );
      row = updated;
    } catch (err) {
      if (err && err.code === '23505') {
        throw new AppError('A discount with this code already exists for this restaurant', 409, 'discount_definition_code_taken');
      }
      throw err;
    }
    const discountDefinition = serializeDiscountDefinition(row);
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.discount_definition.updated',
      target_type: 'discount_definition',
      target_id: discountDefinition.id,
      before_state: serializeDiscountDefinition(existing),
      after_state: discountDefinition,
    });
    res.json({ discountDefinition });
  } catch (err) {
    next(err);
  }
};

exports.deactivateDiscountDefinition = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const definitionId = parsePositiveInt(req.params.definitionId);
    if (!definitionId) throw new AppError('Discount definition not found', 404, 'discount_definition_not_found');
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await assertManage(restaurant, req.user.id);
    const existing = await loadDiscountDefinition(restaurantId, definitionId);
    const { rows: [updated] } = await pool.query(
      `UPDATE restaurant_discount_definitions
          SET is_active = FALSE, updated_at = NOW()
        WHERE id = $1 AND restaurant_id = $2
        RETURNING *`,
      [definitionId, restaurantId]
    );
    const discountDefinition = serializeDiscountDefinition(updated);
    await logBusinessAction(req, {
      business_id: restaurant.business_id,
      actor_role: restaurant.effective_role || null,
      action: 'restaurant.discount_definition.deactivated',
      target_type: 'discount_definition',
      target_id: discountDefinition.id,
      before_state: serializeDiscountDefinition(existing),
      after_state: discountDefinition,
    });
    res.json({ discountDefinition });
  } catch (err) {
    next(err);
  }
};
