'use strict';

const pool = require('../db');
const { safeTimezone, zonedParts } = require('../utils/foodOperatingHours');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const { withTransaction } = require('../utils/transaction');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');
const { getEffectivePermissions, hasAny } = require('../services/permissionsService');
const { logInventoryAudit } = require('../services/restaurantInventoryAuditService');
const { getLocationScope, assertLocationAccess } = require('../services/restaurantLocationAccessService');

const AREA_TYPES = new Set(['dry_storage', 'walk_in_cooler', 'freezer', 'bar', 'packaging', 'receiving', 'prep', 'other']);
const SUPPLIER_STATUSES = new Set(['active', 'inactive', 'issue_reported']);
const TRANSFER_STATUSES = new Set(['pending', 'completed', 'cancelled']);
const INVOICE_MATCH_STATUSES = new Set(['unmatched', 'matched', 'exception']);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function positiveInt(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function text(value, max = 255) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function csvCell(value) {
  const normalized = value === undefined || value === null ? '' : String(value);
  return /[",\r\n]/.test(normalized)
    ? `"${normalized.replaceAll('"', '""')}"`
    : normalized;
}

function quantity(value, field = 'quantity') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be a non-negative number' });
  }
  return Math.round(number * 1000) / 1000;
}

function invoiceTotalCents(value, field = 'invoiceTotalCents') {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', {
      [field]: 'Invoice total must be non-negative cents',
    });
  }
  return number;
}

function operationId(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!UUID_RE.test(normalized)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { clientOperationId: 'Must be a UUID' });
  }
  return normalized;
}

// Canonical restaurant access gate (scope report Area 4). This was the last
// local copy of the ownership CASE; the shared gate returns a superset of the
// columns it selected (fr.*, effective_role, membership_id) with the same 404.
async function restaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  return resolveRestaurantAccess(userId, restaurantId);
}

function transferScopeClause(scope, parameterIndex) {
  return scope?.mode === 'assigned'
    ? { sql: ` AND (t.location_id IS NULL OR t.location_id = ANY($${parameterIndex}::bigint[]))`, values: [scope.location_ids] }
    : { sql: '', values: [] };
}

async function getTransferScope(restaurant, userId) {
  if (restaurant.effective_role === 'owner' || !restaurant.effective_membership_id) return null;
  return getLocationScope(restaurant, userId);
}

async function requireInventoryPermission(userId, restaurant, permissions) {
  if (restaurant.effective_role === 'owner') return;
  const result = await getEffectivePermissions({
    businessId: restaurant.business_id,
    userId,
    role: restaurant.effective_role,
    membershipId: restaurant.membership_id || null,
  });
  if (!hasAny(result.permissions, permissions)) {
    throw new AppError('You do not have permission to access restaurant inventory', 403, 'forbidden');
  }
}

const VIEW_INVENTORY = ['inventory.view', 'inventory.update', 'inventory.manage'];
const UPDATE_INVENTORY = ['inventory.update', 'inventory.manage'];
const MANAGE_INVENTORY = ['inventory.manage'];

function auditEntry(restaurant, eventType, entityType, entityId, req, metadata = {}, clientOperationId = null) {
  return {
    restaurantId: Number(restaurant.id),
    businessId: restaurant.business_id,
    eventType,
    entityType,
    entityId,
    actorUserId: req.user.id,
    clientOperationId,
    metadata,
  };
}

async function receiptWithLines(client, restaurantId, receiptId) {
  const { rows: [receipt] } = await client.query(
    `SELECT r.*, COALESCE(
       jsonb_agg(to_jsonb(l) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb
     ) AS lines
       FROM restaurant_inventory_receipts r
       LEFT JOIN restaurant_inventory_receipt_lines l
         ON l.receipt_id = r.id
        AND l.restaurant_id = r.restaurant_id
      WHERE r.restaurant_id = $1 AND r.id = $2
      GROUP BY r.id`,
    [restaurantId, receiptId]
  );
  return receipt || null;
}

async function requireReceiptLocation(client, restaurant, userId, { requestedLocationId, requestLocationId }) {
  const locationId = requestLocationId || requestedLocationId;
  if (locationId) {
    await assertLocationAccess(restaurant, userId, locationId, client);
    if (requestLocationId && requestedLocationId && Number(requestLocationId) !== Number(requestedLocationId)) {
      throw new AppError('Receipt store does not match the purchase request', 400, 'location_mismatch');
    }
    return locationId;
  }
  const resolved = await client.query(
    `SELECT id FROM restaurant_locations
      WHERE restaurant_id = $1 AND status <> 'inactive'
      ORDER BY is_primary DESC, id ASC LIMIT 1`,
    [restaurant.id]
  );
  const primary = resolved.rows[0]?.id || null;
  if (primary) await assertLocationAccess(restaurant, userId, primary, client);
  return primary;
}

// Every query uses the same typed timezone/store parameters. The clock is
// evaluated by PostgreSQL so local midnight and DST boundaries stay consistent.
async function inventoryReadContext(restaurant, userId) {
  const scope = await getTransferScope(restaurant, userId);
  const params = [restaurant.id, safeTimezone(restaurant.timezone)];
  if (scope?.mode === 'assigned') params.push(scope.location_ids);
  return {
    filter: (alias = '') => scope?.mode === 'assigned'
      ? ` AND ${alias ? `${alias}.` : ''}location_id = ANY($3::bigint[])` : '',
    stores: scope?.mode === 'assigned' ? ' AND id = ANY($3::bigint[])' : '',
    query: (sql) => pool.query(`WITH inventory_clock AS (
      SELECT (NOW() AT TIME ZONE $2::text)::date AS today
    ) ${sql}`, params),
  };
}

exports.getDashboard = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const context = await inventoryReadContext(restaurant, req.user.id);
    const [locationResult, riskResult, activityResult, prioritiesResult, impactsResult] = await Promise.all([
      context.query(
        `SELECT name, address_city, address_state
           FROM restaurant_locations
          WHERE restaurant_id = $1 AND status <> 'inactive'${context.stores}
          ORDER BY is_primary DESC, id ASC LIMIT 1`
      ),
      context.query(
        `SELECT COUNT(*) FILTER (WHERE quantity > 0 AND reorder_point > 0 AND quantity <= reorder_point)::int AS low_stock,
                COUNT(*) FILTER (WHERE quantity <= 0)::int AS out_of_stock,
                COUNT(*) FILTER (WHERE last_counted_at IS NULL OR last_counted_at < NOW() - INTERVAL '7 days')::int AS needs_count,
                (SELECT COUNT(*)::int FROM restaurant_inventory_supplier_issues
                  WHERE restaurant_id = $1${context.filter()} AND status IN ('open','monitoring','in_progress')) AS supplier_issues,
                (SELECT COUNT(*)::int FROM restaurant_inventory_purchase_requests
                  WHERE restaurant_id = $1${context.filter()} AND status IN ('pending','approved')) AS pending_requests
           FROM restaurant_inventory_items
          WHERE restaurant_id = $1${context.filter()} AND is_active = TRUE`
      ),
      context.query(
        `SELECT COUNT(*) FILTER (WHERE adjustment_type = 'count')::int AS counts_done,
                COUNT(DISTINCT source_id) FILTER (WHERE adjustment_type = 'receive' AND source_type = 'receipt')::int AS deliveries,
                COUNT(*) FILTER (WHERE adjustment_type = 'waste')::int AS waste_reports,
                (SELECT COUNT(*)::int FROM restaurant_inventory_purchase_requests
                  WHERE restaurant_id = $1${context.filter()} AND created_at >= ((SELECT today FROM inventory_clock)::timestamp AT TIME ZONE $2)) AS requests
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1${context.filter()} AND created_at >= ((SELECT today FROM inventory_clock)::timestamp AT TIME ZONE $2)`
      ),
      context.query(
        `SELECT i.id, i.name, i.quantity, i.unit, i.par_level, i.reorder_point,
                i.critical_level, a.name AS area_name,
                COUNT(m.id)::int AS affected_menu_count
           FROM restaurant_inventory_items i
           LEFT JOIN restaurant_inventory_storage_areas a
             ON a.id = i.storage_area_id
            AND a.restaurant_id = i.restaurant_id
           LEFT JOIN restaurant_inventory_item_mappings m
             ON m.inventory_item_id = i.id
            AND m.restaurant_id = i.restaurant_id
          WHERE i.restaurant_id = $1${context.filter('i')} AND i.is_active = TRUE
            AND (i.quantity <= 0 OR (i.reorder_point > 0 AND i.quantity <= i.reorder_point)
                 OR i.last_counted_at IS NULL OR i.last_counted_at < NOW() - INTERVAL '7 days')
          GROUP BY i.id, a.name
          ORDER BY CASE WHEN i.quantity <= 0 THEN 0
                        WHEN i.critical_level > 0 AND i.quantity <= i.critical_level THEN 1
                        ELSE 2 END, i.quantity ASC
          LIMIT 10`
      ),
      context.query(
        `SELECT fmi.id AS menu_item_id, fmi.name AS menu_item_name,
                i.id AS inventory_item_id, i.name AS inventory_item_name,
                i.quantity, i.reorder_point, i.critical_level
           FROM restaurant_inventory_item_mappings m
           JOIN restaurant_inventory_items i ON i.id = m.inventory_item_id AND i.restaurant_id = m.restaurant_id
           JOIN food_menu_items fmi ON fmi.id = m.menu_item_id AND fmi.restaurant_id = m.restaurant_id
          WHERE m.restaurant_id = $1${context.filter('i')} AND m.auto_manage = TRUE
            AND (i.quantity <= 0 OR (i.reorder_point > 0 AND i.quantity <= i.reorder_point))
          ORDER BY i.quantity ASC, fmi.name ASC
          LIMIT 20`
      ),
    ]);

    const location = locationResult.rows[0] || null;
    res.json({
      restaurant: {
        id: restaurant.id,
        business_id: restaurant.business_id,
        name: restaurant.display_name,
        city: location?.address_city || restaurant.address_city,
        state: location?.address_state || restaurant.address_state,
        area: location?.name || 'Main inventory',
        timezone: restaurant.timezone,
        currency_code: restaurant.currency_code,
      },
      user: {
        id: req.user.id,
        first_name: req.user.first_name || null,
        last_name: req.user.last_name || null,
        email: req.user.email || null,
        role: restaurant.effective_role,
      },
      risk: riskResult.rows[0] || {},
      activity: activityResult.rows[0] || {},
      priorities: prioritiesResult.rows,
      menu_impacts: impactsResult.rows,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

exports.getReports = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const context = await inventoryReadContext(restaurant, req.user.id);
    const [wasteDaily, wasteSummary, countSummary, varianceDaily, topWasted, deliverySummary, deliverySuppliers] = await Promise.all([
      context.query(
        `SELECT (created_at AT TIME ZONE $2)::date AS day,
                COUNT(*)::int AS reports,
                COALESCE(SUM(ABS(quantity_delta)), 0) AS quantity
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1${context.filter()} AND adjustment_type = 'waste'
            AND created_at >= (((SELECT today FROM inventory_clock) - 6)::timestamp AT TIME ZONE $2)
          GROUP BY (created_at AT TIME ZONE $2)::date ORDER BY day`
      ),
      context.query(
        `SELECT COUNT(*)::int AS reports,
                COALESCE(SUM(ABS(a.quantity_delta)), 0) AS quantity,
                COALESCE(SUM(ABS(a.quantity_delta) * i.unit_cost), 0) AS estimated_cost
           FROM restaurant_inventory_adjustments a
           LEFT JOIN restaurant_inventory_items i ON i.id = a.item_id AND i.restaurant_id = a.restaurant_id
          WHERE a.restaurant_id = $1${context.filter('a')} AND a.adjustment_type = 'waste'
            AND a.created_at >= (date_trunc('week', (SELECT today FROM inventory_clock)::timestamp) AT TIME ZONE $2)`
      ),
      context.query(
        `SELECT COUNT(*) FILTER (WHERE ABS(quantity_delta) = 0)::int AS exact,
                COUNT(*) FILTER (WHERE ABS(quantity_delta) > 0 AND ABS(quantity_delta) <= 1)::int AS minor,
                COUNT(*) FILTER (WHERE ABS(quantity_delta) > 1)::int AS major
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1${context.filter()} AND adjustment_type = 'count'
            AND created_at >= ((SELECT today FROM inventory_clock)::timestamp AT TIME ZONE $2)`
      ),
      context.query(
        `SELECT (created_at AT TIME ZONE $2)::date AS day, COALESCE(SUM(ABS(quantity_delta)), 0) AS variance
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1${context.filter()} AND adjustment_type = 'count'
            AND created_at >= (((SELECT today FROM inventory_clock) - 6)::timestamp AT TIME ZONE $2)
          GROUP BY (created_at AT TIME ZONE $2)::date ORDER BY day`
      ),
      context.query(
        `SELECT a.item_name, COALESCE(i.unit, 'unit') AS unit,
                COALESCE(SUM(ABS(a.quantity_delta)), 0) AS quantity,
                COALESCE(SUM(ABS(a.quantity_delta) * i.unit_cost), 0) AS estimated_cost
           FROM restaurant_inventory_adjustments a
           LEFT JOIN restaurant_inventory_items i ON i.id = a.item_id AND i.restaurant_id = a.restaurant_id
          WHERE a.restaurant_id = $1${context.filter('a')} AND a.adjustment_type = 'waste'
            AND a.created_at >= (date_trunc('week', (SELECT today FROM inventory_clock)::timestamp) AT TIME ZONE $2)
          GROUP BY a.item_name, i.unit ORDER BY quantity DESC LIMIT 5`
      ),
      context.query(
        `SELECT COUNT(DISTINCT r.id)::int AS total,
                COUNT(DISTINCT r.id) FILTER (WHERE l.received_quantity > l.accepted_quantity)::int AS with_issues,
                CASE WHEN COALESCE(SUM(l.expected_quantity), 0) > 0
                     THEN ROUND(100 * SUM(l.accepted_quantity) / SUM(l.expected_quantity))
                     ELSE 100 END AS fill_rate
           FROM restaurant_inventory_receipts r
           LEFT JOIN restaurant_inventory_receipt_lines l
             ON l.receipt_id = r.id
            AND l.restaurant_id = r.restaurant_id
          WHERE r.restaurant_id = $1${context.filter('r')}
            AND r.received_at >= (date_trunc('week', (SELECT today FROM inventory_clock)::timestamp) AT TIME ZONE $2)`
      ),
      context.query(
        `SELECT r.supplier_name, COUNT(l.id)::int AS lines,
                COUNT(l.id) FILTER (WHERE l.received_quantity > l.accepted_quantity)::int AS issue_lines
           FROM restaurant_inventory_receipts r
           LEFT JOIN restaurant_inventory_receipt_lines l
             ON l.receipt_id = r.id
            AND l.restaurant_id = r.restaurant_id
          WHERE r.restaurant_id = $1${context.filter('r')}
            AND r.received_at >= (date_trunc('week', (SELECT today FROM inventory_clock)::timestamp) AT TIME ZONE $2)
          GROUP BY r.supplier_name ORDER BY lines DESC, r.supplier_name LIMIT 8`
      ),
    ]);
    res.json({
      waste: {
        daily: wasteDaily.rows,
        ...(wasteSummary.rows[0] || { reports: 0, quantity: 0, estimated_cost: 0 }),
        top_items: topWasted.rows,
      },
      counts: {
        ...(countSummary.rows[0] || { exact: 0, minor: 0, major: 0 }),
        daily_variance: varianceDaily.rows,
      },
      deliveries: {
        ...(deliverySummary.rows[0] || { total: 0, with_issues: 0, fill_rate: 100 }),
        suppliers: deliverySuppliers.rows,
      },
    });
  } catch (error) { next(error); }
};

exports.foodCostSummary = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const timezone = safeTimezone(restaurant.timezone);
    const today = zonedParts(new Date(), timezone).dateKey;
    const fromDate = req.query.from || new Date(Date.parse(`${today}T12:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
    const toDate = req.query.to || today;
    if (!DATE_ONLY_RE.test(fromDate) || !DATE_ONLY_RE.test(toDate) || fromDate > toDate) {
      throw new AppError('A valid from/to date range is required', 400, 'invalid_range');
    }
    const scope = await getTransferScope(restaurant, req.user.id);
    const params = [restaurantId, fromDate, toDate, timezone];
    let locationFilter = '';
    let salesLocationFilter = '';
    if (scope?.mode === 'assigned') {
      params.push(scope.location_ids);
      locationFilter = ' AND i.location_id = ANY($5::bigint[])';
      salesLocationFilter = ' AND fo.location_id = ANY($5::bigint[])';
    }
    const { rows } = await pool.query(
      `WITH sales AS (
         SELECT COALESCE(SUM(fo.total_cents), 0) / 100.0 AS net_sales
           FROM food_orders fo
          WHERE fo.restaurant_id = $1
            AND fo.created_at >= (($2::date)::timestamp AT TIME ZONE $4)
            AND fo.created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
            AND fo.payment_status = 'paid'
            AND fo.status NOT IN ('cancelled', 'refunded')${salesLocationFilter}
       ), theoretical AS (
         SELECT rim.inventory_item_id,
                COALESCE(SUM(foi.quantity * rim.required_quantity * rim.conversion_factor
                  * (100.0 / NULLIF(rim.yield_percent, 0))), 0) AS quantity
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
          GROUP BY rim.inventory_item_id
       ), actual AS (
         SELECT item_id, COALESCE(SUM(ABS(quantity_delta)), 0) AS quantity
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND adjustment_type = 'usage'${scope?.mode === 'assigned' ? ' AND location_id = ANY($5::bigint[])' : ''}
            AND created_at >= (($2::date)::timestamp AT TIME ZONE $4)
            AND created_at < ((($3::date + 1))::timestamp AT TIME ZONE $4)
          GROUP BY item_id
       )
       SELECT i.id AS inventory_item_id, i.name, i.unit, i.unit_cost,
              sales.net_sales,
              COALESCE(t.quantity, 0) AS theoretical_quantity,
              COALESCE(a.quantity, 0) AS actual_quantity,
              COALESCE(a.quantity, 0) - COALESCE(t.quantity, 0) AS variance_quantity,
              COALESCE(t.quantity, 0) * i.unit_cost AS theoretical_cost,
              COALESCE(a.quantity, 0) * i.unit_cost AS actual_cost,
              (COALESCE(a.quantity, 0) - COALESCE(t.quantity, 0)) * i.unit_cost AS variance_cost
         FROM restaurant_inventory_items i
         LEFT JOIN theoretical t ON t.inventory_item_id = i.id
         LEFT JOIN actual a ON a.item_id = i.id
        CROSS JOIN sales
        WHERE i.restaurant_id = $1 AND i.is_active = TRUE${locationFilter}
        ORDER BY ABS((COALESCE(a.quantity, 0) - COALESCE(t.quantity, 0)) * i.unit_cost) DESC, i.name ASC`,
      params
    );
    const totals = rows.reduce((sum, row) => {
      sum.net_sales = Number(row.net_sales) || sum.net_sales;
      sum.theoretical_cost += Number(row.theoretical_cost) || 0;
      sum.actual_cost += Number(row.actual_cost) || 0;
      sum.variance_cost += Number(row.variance_cost) || 0;
      return sum;
    }, { net_sales: 0, theoretical_cost: 0, actual_cost: 0, variance_cost: 0 });
    totals.theoretical_cost_pct = totals.net_sales > 0
      ? Number(((totals.theoretical_cost / totals.net_sales) * 100).toFixed(2)) : null;
    totals.actual_cost_pct = totals.net_sales > 0
      ? Number(((totals.actual_cost / totals.net_sales) * 100).toFixed(2)) : null;
    totals.variance_cost_pct = totals.net_sales > 0
      ? Number(((totals.variance_cost / totals.net_sales) * 100).toFixed(2)) : null;
    res.json({ from_date: fromDate, to_date: toDate, rows, totals });
  } catch (error) { next(error); }
};

exports.listAuditEvents = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);

    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const entityType = text(req.query.entityType, 60);
    const entityId = positiveInt(req.query.entityId);
    const eventType = text(req.query.eventType, 80);
    const params = [restaurantId];
    const where = ['e.restaurant_id = $1'];

    if (entityType) {
      params.push(entityType);
      where.push(`e.entity_type = $${params.length}`);
    }
    if (entityId) {
      params.push(entityId);
      where.push(`e.entity_id = $${params.length}`);
    }
    if (eventType) {
      params.push(eventType);
      where.push(`e.event_type = $${params.length}`);
    }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT e.*,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS actor_name,
              u.email AS actor_email
         FROM restaurant_inventory_audit_events e
         LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY e.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ events: rows, limit, offset });
  } catch (error) { next(error); }
};

exports.listAreas = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const { rows } = await pool.query(
      `SELECT a.*, COUNT(i.id)::int AS item_count,
              COUNT(i.id) FILTER (WHERE i.quantity <= i.reorder_point AND i.reorder_point > 0)::int AS critical_count,
              MAX(i.last_counted_at) AS last_counted_at,
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS responsible_party
         FROM restaurant_inventory_storage_areas a
         LEFT JOIN restaurant_inventory_items i
           ON i.storage_area_id = a.id
          AND i.restaurant_id = a.restaurant_id
          AND i.is_active = TRUE
         LEFT JOIN users u ON u.id = a.responsible_user_id
        WHERE a.restaurant_id = $1 AND a.is_active = TRUE
        GROUP BY a.id, u.first_name, u.last_name
        ORDER BY a.name`,
      [restaurantId]
    );
    res.json({ areas: rows });
  } catch (error) { next(error); }
};

exports.createArea = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);
    const name = text(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
    const areaType = AREA_TYPES.has(req.body.areaType) ? req.body.areaType : 'other';
    const area = await withTransaction(pool, async (client) => {
      const { rows: [upserted] } = await client.query(
        `INSERT INTO restaurant_inventory_storage_areas
           (restaurant_id, name, area_type, temperature_range, responsible_user_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (restaurant_id, name) DO UPDATE
           SET area_type = EXCLUDED.area_type, temperature_range = EXCLUDED.temperature_range,
               responsible_user_id = EXCLUDED.responsible_user_id, is_active = TRUE, updated_at = NOW()
        RETURNING *`,
        [restaurantId, name, areaType, text(req.body.temperatureRange, 80), req.body.responsibleUserId || null, req.user.id]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'area_upserted', 'area', upserted.id, req, {
        name: upserted.name,
        areaType: upserted.area_type,
      }));
      return upserted;
    });
    res.status(201).json({ area });
  } catch (error) { next(error); }
};

exports.listSuppliers = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const { rows } = await pool.query(
      `SELECT s.*, COUNT(DISTINCT i.id)::int AS item_count,
              COUNT(DISTINCT si.id) FILTER (WHERE si.status IN ('open','monitoring','in_progress'))::int AS open_issue_count
         FROM restaurant_inventory_suppliers s
         LEFT JOIN restaurant_inventory_items i
           ON i.supplier_id = s.id
          AND i.restaurant_id = s.restaurant_id
          AND i.is_active = TRUE
         LEFT JOIN restaurant_inventory_supplier_issues si
           ON si.restaurant_id = s.restaurant_id AND LOWER(si.supplier_name) = LOWER(s.name)
        WHERE s.restaurant_id = $1 AND s.is_active = TRUE
        GROUP BY s.id ORDER BY s.name`,
      [restaurantId]
    );
    res.json({ suppliers: rows });
  } catch (error) { next(error); }
};

exports.createSupplier = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);
    const name = text(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
    const status = SUPPLIER_STATUSES.has(req.body.status) ? req.body.status : 'active';
    const leadTimeDays = Math.max(0, Number.parseInt(req.body.leadTimeDays, 10) || 0);
    const rating = req.body.rating == null ? null : Math.max(0, Math.min(5, Number(req.body.rating)));
    const supplier = await withTransaction(pool, async (client) => {
      const { rows: [upserted] } = await client.query(
        `INSERT INTO restaurant_inventory_suppliers
           (restaurant_id, name, category, contact_name, phone, email, lead_time_days, status, rating, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (restaurant_id, name) DO UPDATE
           SET category = EXCLUDED.category, contact_name = EXCLUDED.contact_name,
               phone = EXCLUDED.phone, email = EXCLUDED.email,
               lead_time_days = EXCLUDED.lead_time_days, status = EXCLUDED.status,
               rating = EXCLUDED.rating, is_active = TRUE, updated_at = NOW()
         RETURNING *`,
        [restaurantId, name, text(req.body.category, 160), text(req.body.contactName, 160),
          text(req.body.phone, 40), text(req.body.email, 320), leadTimeDays, status, rating, req.user.id]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'supplier_upserted', 'supplier', upserted.id, req, {
        name: upserted.name,
        status: upserted.status,
        category: upserted.category,
      }));
      return upserted;
    });
    res.status(201).json({ supplier });
  } catch (error) { next(error); }
};

exports.listSupplierCatalog = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const scope = await getTransferScope(restaurant, req.user.id);
    const params = [restaurantId];
    const where = ['c.restaurant_id = $1', 'c.is_active = TRUE'];
    if (positiveInt(req.query.supplierId)) {
      params.push(positiveInt(req.query.supplierId));
      where.push(`c.supplier_id = $${params.length}`);
    }
    if (positiveInt(req.query.inventoryItemId)) {
      params.push(positiveInt(req.query.inventoryItemId));
      where.push(`c.inventory_item_id = $${params.length}`);
    }
    if (scope?.mode === 'assigned') {
      params.push(scope.location_ids);
      where.push(`(i.location_id IS NULL OR i.location_id = ANY($${params.length}::bigint[]))`);
    }
    const { rows } = await pool.query(
      `SELECT c.*, s.name AS supplier_name, i.name AS inventory_item_name, i.unit AS inventory_unit
         FROM restaurant_inventory_supplier_catalog c
         JOIN restaurant_inventory_suppliers s ON s.id = c.supplier_id AND s.restaurant_id = c.restaurant_id
         JOIN restaurant_inventory_items i ON i.id = c.inventory_item_id AND i.restaurant_id = c.restaurant_id
        WHERE ${where.join(' AND ')}
        ORDER BY s.name ASC, i.name ASC`,
      params
    );
    res.json({ catalog: rows });
  } catch (error) { next(error); }
};

exports.upsertSupplierCatalog = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);
    const supplierId = positiveInt(req.body.supplierId || req.body.supplier_id);
    const inventoryItemId = positiveInt(req.body.inventoryItemId || req.body.inventory_item_id);
    const packQuantity = quantity(req.body.packQuantity ?? req.body.pack_quantity ?? 1, 'packQuantity');
    const packUnit = text(req.body.packUnit || req.body.pack_unit, 24);
    const unitCost = Number(req.body.unitCost ?? req.body.unit_cost ?? 0);
    const currencyCode = String(req.body.currencyCode || req.body.currency_code || 'USD').trim().toUpperCase();
    const leadTimeDays = req.body.leadTimeDays ?? req.body.lead_time_days;
    if (!supplierId || !inventoryItemId || !packUnit) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        supplierId: 'Supplier is required', inventoryItemId: 'Inventory item is required', packUnit: 'Pack unit is required',
      });
    }
    if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 100000000) {
      throw new AppError('Validation failed', 400, 'validation_failed', { unitCost: 'Unit cost must be non-negative' });
    }
    if (!/^[A-Z]{3}$/.test(currencyCode)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { currencyCode: 'Currency must be a 3-letter code' });
    }
    if (packQuantity <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { packQuantity: 'Pack quantity must be greater than zero' });
    }
    const lead = leadTimeDays === undefined || leadTimeDays === null || leadTimeDays === '' ? null : Number(leadTimeDays);
    if (lead !== null && (!Number.isInteger(lead) || lead < 0 || lead > 365)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { leadTimeDays: 'Lead time must be between 0 and 365 days' });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [refs] } = await client.query(
        `SELECT s.id AS supplier_id, i.id AS inventory_item_id, i.location_id
           FROM restaurant_inventory_suppliers s
           CROSS JOIN restaurant_inventory_items i
          WHERE s.id = $1 AND s.restaurant_id = $3 AND s.is_active = TRUE
            AND i.id = $2 AND i.restaurant_id = $3 AND i.is_active = TRUE`,
        [supplierId, inventoryItemId, restaurantId]
      );
      if (!refs) throw new AppError('Supplier or inventory item not found', 404, 'inventory_reference_not_found');
      if (restaurant.effective_role !== 'owner' && restaurant.effective_membership_id && refs.location_id != null) {
        await assertLocationAccess(restaurant, req.user.id, refs.location_id, client);
      }
      const { rows: [catalog] } = await client.query(
        `INSERT INTO restaurant_inventory_supplier_catalog
           (restaurant_id, supplier_id, inventory_item_id, supplier_sku, pack_quantity,
            pack_unit, unit_cost, currency_code, lead_time_days, is_preferred, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (restaurant_id, supplier_id, inventory_item_id)
         DO UPDATE SET supplier_sku = EXCLUDED.supplier_sku,
                       pack_quantity = EXCLUDED.pack_quantity,
                       pack_unit = EXCLUDED.pack_unit,
                       unit_cost = EXCLUDED.unit_cost,
                       currency_code = EXCLUDED.currency_code,
                       lead_time_days = EXCLUDED.lead_time_days,
                       is_preferred = EXCLUDED.is_preferred,
                       is_active = TRUE,
                       updated_at = NOW()
         RETURNING *`,
        [restaurantId, supplierId, inventoryItemId, text(req.body.supplierSku || req.body.supplier_sku, 80),
          packQuantity, packUnit, Math.round(unitCost * 100) / 100, currencyCode, lead,
          req.body.isPreferred === true || req.body.is_preferred === true, req.user.id]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'supplier_catalog_upserted', 'supplier_catalog', catalog.id, req, {
        supplierId, inventoryItemId, unitCost: catalog.unit_cost, currencyCode: catalog.currency_code,
      }));
      return catalog;
    });
    res.status(201).json({ catalog: result });
  } catch (error) { next(error); }
};

exports.listTransfers = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const scope = transferScopeClause(await getTransferScope(restaurant, req.user.id), 2);
    const { rows } = await pool.query(
      `SELECT t.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS transferred_by_name
         FROM restaurant_inventory_transfers t
         LEFT JOIN users u ON u.id = t.transferred_by
        WHERE t.restaurant_id = $1${scope.sql} ORDER BY t.created_at DESC LIMIT 200`,
      [restaurantId, ...scope.values]
    );
    res.json({ transfers: rows });
  } catch (error) { next(error); }
};

exports.createTransfer = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, UPDATE_INVENTORY);
    const scope = await getTransferScope(restaurant, req.user.id);
    const itemId = positiveInt(req.body.itemId);
    const amount = quantity(req.body.quantity);
    if (!itemId || amount <= 0) throw new AppError('Validation failed', 400, 'validation_failed', { itemId: 'Item is required', quantity: 'Must be greater than zero' });
    const clientOperationId = operationId(req.body.clientOperationId);
    const result = await withTransaction(pool, async (client) => {
      if (clientOperationId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`inventory-transfer:${restaurantId}:${clientOperationId}`]);
        const { rows: [existing] } = await client.query(
          `SELECT * FROM restaurant_inventory_transfers WHERE restaurant_id = $1 AND client_operation_id = $2`,
          [restaurantId, clientOperationId]
        );
        if (existing) {
          if (scope?.mode === 'assigned' && existing.location_id != null
            && !scope.location_ids.includes(Number(existing.location_id))) {
            throw new AppError('Transfer not found', 404, 'inventory_transfer_not_found');
          }
          return { transfer: existing, replayed: true };
        }
      }
      const { rows: [item] } = await client.query(
        `SELECT id, name, unit, location_id FROM restaurant_inventory_items WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE`,
        [itemId, restaurantId]
      );
      if (!item) throw new AppError('Item not found', 404, 'inventory_item_not_found');
      if (restaurant.effective_role !== 'owner' && restaurant.effective_membership_id && item.location_id != null) {
        await assertLocationAccess(restaurant, req.user.id, item.location_id, client);
      }
      const fromAreaId = positiveInt(req.body.fromAreaId);
      const toAreaId = positiveInt(req.body.toAreaId);
      const { rows: areas } = await client.query(
        `SELECT id, name FROM restaurant_inventory_storage_areas
          WHERE restaurant_id = $1 AND id = ANY($2::bigint[]) AND is_active = TRUE`,
        [restaurantId, [fromAreaId, toAreaId].filter(Boolean)]
      );
      const fromName = areas.find((area) => Number(area.id) === fromAreaId)?.name || text(req.body.fromAreaName, 160);
      const toName = areas.find((area) => Number(area.id) === toAreaId)?.name || text(req.body.toAreaName, 160);
      if (!fromName || !toName || fromName === toName) {
        throw new AppError('Validation failed', 400, 'validation_failed', { areas: 'Different source and destination areas are required' });
      }
      const status = TRANSFER_STATUSES.has(req.body.status) ? req.body.status : 'completed';
      const { rows: [transfer] } = await client.query(
        `INSERT INTO restaurant_inventory_transfers
           (restaurant_id, location_id, item_id, item_name, quantity, unit, from_area_id, to_area_id,
            from_area_name, to_area_name, status, note, transferred_by, client_operation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [restaurantId, item.location_id || null, item.id, item.name, amount, item.unit, fromAreaId, toAreaId,
          fromName, toName, status, text(req.body.note, 1000), req.user.id, clientOperationId]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'transfer_created', 'transfer', transfer.id, req, {
        itemId: transfer.item_id,
        itemName: transfer.item_name,
        quantity: transfer.quantity,
        unit: transfer.unit,
        fromAreaName: transfer.from_area_name,
        toAreaName: transfer.to_area_name,
        status: transfer.status,
      }, clientOperationId));
      return { transfer, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
};

exports.updateTransfer = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const transferId = positiveInt(req.params.transferId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);
    const scope = await getTransferScope(restaurant, req.user.id);
    if (!transferId) throw new AppError('Transfer not found', 404, 'inventory_transfer_not_found');
    if (!TRANSFER_STATUSES.has(req.body.status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        status: 'Status must be pending, completed, or cancelled',
      });
    }
    const scopeClause = scope?.mode === 'assigned'
      ? ' AND (location_id IS NULL OR location_id = ANY($4::bigint[]))' : '';
    const transfer = await withTransaction(pool, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_inventory_transfers
            SET status = $1, updated_at = NOW()
          WHERE id = $2 AND restaurant_id = $3${scopeClause}
          RETURNING *`,
        [req.body.status, transferId, restaurantId, ...(scope?.mode === 'assigned' ? [scope.location_ids] : [])]
      );
      if (!updated) throw new AppError('Transfer not found', 404, 'inventory_transfer_not_found');
      await logInventoryAudit(client, auditEntry(restaurant, 'transfer_updated', 'transfer', updated.id, req, {
        status: updated.status,
      }));
      return updated;
    });
    res.json({ transfer });
  } catch (error) { next(error); }
};

exports.listReceipts = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const scope = transferScopeClause(await getTransferScope(restaurant, req.user.id), 2);
    const { rows } = await pool.query(
      `SELECT r.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS received_by_name,
              COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb) AS lines
         FROM restaurant_inventory_receipts r
         LEFT JOIN restaurant_inventory_receipt_lines l
           ON l.receipt_id = r.id
          AND l.restaurant_id = r.restaurant_id
         LEFT JOIN users u ON u.id = r.received_by
        WHERE r.restaurant_id = $1${scope.sql.replaceAll('t.location_id', 'r.location_id')}
        GROUP BY r.id, u.first_name, u.last_name
        ORDER BY r.created_at DESC LIMIT 100`,
      [restaurantId, ...scope.values]
    );
    res.json({ receipts: rows });
  } catch (error) { next(error); }
};

exports.exportReceiptsCsv = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const scope = transferScopeClause(await getTransferScope(restaurant, req.user.id), 2);
    const { rows } = await pool.query(
      `SELECT r.id, r.received_at, r.location_id, l.name AS location_name,
              r.supplier_id, r.supplier_name, r.invoice_number, r.status,
              r.purchase_request_id, r.invoice_match_status,
              r.invoice_total_cents, r.invoice_currency_code,
              r.general_note, r.received_by,
              TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS received_by_name
         FROM restaurant_inventory_receipts r
         LEFT JOIN restaurant_locations l ON l.id = r.location_id
         LEFT JOIN users u ON u.id = r.received_by
        WHERE r.restaurant_id = $1${scope.sql.replaceAll('t.location_id', 'r.location_id')}
        ORDER BY r.received_at DESC LIMIT 10000`,
      [restaurantId, ...scope.values]
    );
    const columns = [
      'receipt_id', 'received_at', 'location_id', 'location_name', 'supplier_id',
      'supplier_name', 'invoice_number', 'status', 'purchase_request_id',
      'invoice_match_status', 'invoice_total_cents', 'invoice_currency_code',
      'general_note', 'received_by', 'received_by_name',
    ];
    const lines = [columns.join(',')];
    for (const row of rows) {
      lines.push([
        row.id, row.received_at, row.location_id, row.location_name, row.supplier_id,
        row.supplier_name, row.invoice_number, row.status, row.purchase_request_id,
        row.invoice_match_status, row.invoice_total_cents, row.invoice_currency_code,
        row.general_note, row.received_by, row.received_by_name,
      ].map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-receipts.csv"');
    res.send(`${lines.join('\n')}\n`);
  } catch (error) { next(error); }
};

// External invoice systems often deliver their document after the stock
// receipt. Keep that reconciliation inside the same restaurant/store scope as
// receipt creation, and record every state change for later accounting export.
exports.updateReceiptInvoiceMatch = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const receiptId = positiveInt(req.params.receiptId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, UPDATE_INVENTORY);
    const status = text(req.body.invoiceMatchStatus || req.body.invoice_match_status, 24) || 'unmatched';
    if (!INVOICE_MATCH_STATUSES.has(status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        invoiceMatchStatus: 'Unsupported invoice match status',
      });
    }
    const hasTotal = Object.prototype.hasOwnProperty.call(req.body, 'invoiceTotalCents')
      || Object.prototype.hasOwnProperty.call(req.body, 'invoice_total_cents');
    const parsedInvoiceTotal = invoiceTotalCents(
      req.body.invoiceTotalCents ?? req.body.invoice_total_cents,
    );
    const hasCurrency = Object.prototype.hasOwnProperty.call(req.body, 'invoiceCurrencyCode')
      || Object.prototype.hasOwnProperty.call(req.body, 'invoice_currency_code');
    const invoiceCurrency = hasCurrency
      ? String(req.body.invoiceCurrencyCode || req.body.invoice_currency_code || '').trim().toUpperCase()
      : null;
    if (hasCurrency && !/^[A-Z]{3}$/.test(invoiceCurrency)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        invoiceCurrencyCode: 'Currency must be a 3-letter code',
      });
    }
    const purchaseRequestId = positiveInt(req.body.purchaseRequestId || req.body.purchase_request_id);
    if (status === 'matched' && !purchaseRequestId && !hasTotal && !hasCurrency) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        invoiceMatchStatus: 'A matched invoice needs a purchase request or invoice metadata',
      });
    }
    const receipt = await withTransaction(pool, async (client) => {
      const { rows: [current] } = await client.query(
        `SELECT * FROM restaurant_inventory_receipts
          WHERE id = $1 AND restaurant_id = $2
          FOR UPDATE`,
        [receiptId, restaurantId]
      );
      if (!current) throw new AppError('Receipt not found', 404, 'inventory_receipt_not_found');
      await assertLocationAccess(restaurant, req.user.id, current.location_id, client);

      let request = null;
      if (purchaseRequestId) {
        const { rows: [found] } = await client.query(
          `SELECT id, location_id, status
             FROM restaurant_inventory_purchase_requests
            WHERE id = $1 AND restaurant_id = $2
            FOR UPDATE`,
          [purchaseRequestId, restaurantId]
        );
        if (!found || found.status === 'cancelled') {
          throw new AppError('Purchase request not found or cancelled', 404, 'purchase_request_not_found');
        }
        await assertLocationAccess(restaurant, req.user.id, found.location_id, client);
        if (current.location_id != null && found.location_id != null
          && Number(current.location_id) !== Number(found.location_id)) {
          throw new AppError('Invoice purchase request must belong to the receipt store', 400, 'location_mismatch');
        }
        request = found;
      }
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_inventory_receipts
            SET purchase_request_id = COALESCE($1, purchase_request_id),
                invoice_match_status = $2,
                invoice_total_cents = CASE WHEN $3::boolean THEN $4 ELSE invoice_total_cents END,
                invoice_currency_code = CASE WHEN $5::boolean THEN $6 ELSE invoice_currency_code END,
                matched_at = CASE WHEN $2 = 'unmatched' THEN NULL ELSE NOW() END,
                matched_by = CASE WHEN $2 = 'unmatched' THEN NULL ELSE $7 END
          WHERE id = $8 AND restaurant_id = $9
          RETURNING *`,
        [request?.id || null, status, hasTotal, parsedInvoiceTotal, hasCurrency, invoiceCurrency,
          status === 'unmatched' ? null : req.user.id, receiptId, restaurantId]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'receipt_invoice_match_updated', 'receipt', receiptId, req, {
        previousStatus: current.invoice_match_status,
        invoiceMatchStatus: updated.invoice_match_status,
        previousPurchaseRequestId: current.purchase_request_id,
        purchaseRequestId: updated.purchase_request_id,
        invoiceTotalCents: updated.invoice_total_cents,
        invoiceCurrencyCode: updated.invoice_currency_code,
      }));
      return receiptWithLines(client, restaurantId, updated.id);
    });
    res.json({ receipt });
  } catch (error) { next(error); }
};

exports.createReceipt = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, UPDATE_INVENTORY);
    const supplierName = text(req.body.supplierName, 160);
    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    if (!supplierName || !lines.length) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        supplierName: supplierName ? undefined : 'Supplier is required',
        lines: lines.length ? undefined : 'At least one line is required',
      });
    }
    const purchaseRequestId = positiveInt(req.body.purchaseRequestId || req.body.purchase_request_id);
    const invoiceTotalInput = req.body.invoiceTotalCents ?? req.body.invoice_total_cents;
    const parsedInvoiceTotal = invoiceTotalInput === undefined || invoiceTotalInput === null || invoiceTotalInput === ''
      ? null : invoiceTotalCents(invoiceTotalInput);
    const invoiceCurrency = String(req.body.invoiceCurrencyCode || req.body.invoice_currency_code || 'USD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(invoiceCurrency)) {
      throw new AppError('Validation failed', 400, 'validation_failed', { invoiceCurrencyCode: 'Currency must be a 3-letter code' });
    }
    const clientOperationId = operationId(req.body.clientOperationId);
    const result = await withTransaction(pool, async (client) => {
      if (clientOperationId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`inventory-receipt:${restaurantId}:${clientOperationId}`]);
        const { rows: [existing] } = await client.query(
          `SELECT id FROM restaurant_inventory_receipts WHERE restaurant_id = $1 AND client_operation_id = $2`,
          [restaurantId, clientOperationId]
        );
        if (existing) return { receipt: await receiptWithLines(client, restaurantId, existing.id), replayed: true };
      }
      const supplierId = positiveInt(req.body.supplierId);
      if (supplierId) {
        const { rows: [supplier] } = await client.query(
          `SELECT id FROM restaurant_inventory_suppliers WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE`,
          [supplierId, restaurantId]
        );
        if (!supplier) throw new AppError('Supplier not found', 404, 'supplier_not_found');
      }
      let purchaseRequest = null;
      if (purchaseRequestId) {
        const { rows: [request] } = await client.query(
          `SELECT id, location_id, supplier_name, status
             FROM restaurant_inventory_purchase_requests
            WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
          [purchaseRequestId, restaurantId]
        );
        if (!request || request.status === 'cancelled') {
          throw new AppError('Purchase request not found or cancelled', 404, 'purchase_request_not_found');
        }
        await assertLocationAccess(restaurant, req.user.id, request.location_id, client);
        purchaseRequest = request;
      }
      const receiptLocationId = await requireReceiptLocation(client, restaurant, req.user.id, {
        requestedLocationId: parsePositiveInt(req.body.locationId || req.body.location_id),
        requestLocationId: purchaseRequest?.location_id || null,
      });
      const { rows: [receipt] } = await client.query(
        `INSERT INTO restaurant_inventory_receipts
           (restaurant_id, location_id, supplier_id, supplier_name, invoice_number, status, general_note,
            purchase_request_id, invoice_match_status, invoice_total_cents, invoice_currency_code,
            matched_at, matched_by, received_by, received_at, client_operation_id)
         VALUES ($1,$2,$3,$4,$5,'received',$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14) RETURNING *`,
        [restaurantId, receiptLocationId, supplierId, supplierName, text(req.body.invoiceNumber, 120),
          text(req.body.generalNote, 2000), purchaseRequestId,
          purchaseRequestId ? 'matched' : 'unmatched', parsedInvoiceTotal, invoiceCurrency,
          purchaseRequestId ? new Date() : null, purchaseRequestId ? req.user.id : null,
          req.user.id, clientOperationId]
      );
      const auditLines = [];
      for (const [index, line] of lines.entries()) {
        const itemId = positiveInt(line.itemId);
        if (!itemId) throw new AppError('Validation failed', 400, 'validation_failed', { [`lines.${index}.itemId`]: 'Item is required' });
        const expected = quantity(line.expectedQuantity || 0, `lines.${index}.expectedQuantity`);
        const received = quantity(line.receivedQuantity || 0, `lines.${index}.receivedQuantity`);
        const accepted = quantity(line.acceptedQuantity ?? received, `lines.${index}.acceptedQuantity`);
        if (accepted > received) throw new AppError('Validation failed', 400, 'validation_failed', { [`lines.${index}.acceptedQuantity`]: 'Cannot exceed received quantity' });
        const { rows: [item] } = await client.query(
          `SELECT * FROM restaurant_inventory_items WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE FOR UPDATE`,
          [itemId, restaurantId]
        );
        if (!item) throw new AppError('Item not found', 404, 'inventory_item_not_found');
        if (item.location_id != null && receiptLocationId != null && Number(item.location_id) !== Number(receiptLocationId)) {
          throw new AppError('Receipt items must belong to the receipt store', 400, 'location_mismatch');
        }
        if (item.location_id != null) await assertLocationAccess(restaurant, req.user.id, item.location_id, client);
        auditLines.push({
          itemId: item.id,
          itemName: item.name,
          expectedQuantity: expected,
          receivedQuantity: received,
          acceptedQuantity: accepted,
          unit: item.unit,
          issueType: text(line.issueType, 32),
        });
        await client.query(
          `INSERT INTO restaurant_inventory_receipt_lines
             (receipt_id, restaurant_id, item_id, item_name, expected_quantity,
              received_quantity, accepted_quantity, unit, issue_type, issue_note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [receipt.id, restaurantId, item.id, item.name, expected, received, accepted, item.unit,
            text(line.issueType, 32), text(line.issueNote, 1000)]
        );
        if (accepted > 0) {
          const after = Math.round((Number(item.quantity) + accepted) * 1000) / 1000;
          await client.query(
            `UPDATE restaurant_inventory_items SET quantity = $1, updated_at = NOW() WHERE id = $2`,
            [after, item.id]
          );
          await client.query(
            `INSERT INTO restaurant_inventory_adjustments
               (restaurant_id, item_id, item_name, adjustment_type, quantity_delta,
                quantity_after, note, adjusted_by, source_type, source_id)
             VALUES ($1,$2,$3,'receive',$4,$5,$6,$7,'receipt',$8)`,
            [restaurantId, item.id, item.name, accepted, after, text(line.issueNote, 1000), req.user.id, receipt.id]
          );
          await syncMappedMenuAvailability(client, restaurantId, {
            inventoryItemId: item.id, locationId: item.location_id, apply: true, createdBy: req.user.id,
          });
        }
      }
      if (supplierId) {
        await client.query(
          `UPDATE restaurant_inventory_suppliers SET last_delivery_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND restaurant_id = $2`,
          [supplierId, restaurantId]
        );
      }
      if (purchaseRequestId) {
        await client.query(
          `UPDATE restaurant_inventory_purchase_requests
              SET status = 'received', updated_at = NOW()
            WHERE id = $1 AND restaurant_id = $2`,
          [purchaseRequestId, restaurantId]
        );
      }
      await logInventoryAudit(client, auditEntry(restaurant, 'receipt_created', 'receipt', receipt.id, req, {
        supplierId,
        supplierName: receipt.supplier_name,
        invoiceNumber: receipt.invoice_number,
        locationId: receipt.location_id,
        purchaseRequestId: receipt.purchase_request_id,
        invoiceMatchStatus: receipt.invoice_match_status,
        lineCount: auditLines.length,
        acceptedLineCount: auditLines.filter((line) => line.acceptedQuantity > 0).length,
        lines: auditLines.slice(0, 50),
      }, clientOperationId));
      return { receipt: await receiptWithLines(client, restaurantId, receipt.id), replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
};
