'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');
const { getEffectivePermissions, hasAny } = require('../services/permissionsService');
const { logInventoryAudit } = require('../services/restaurantInventoryAuditService');

const AREA_TYPES = new Set(['dry_storage', 'walk_in_cooler', 'freezer', 'bar', 'packaging', 'receiving', 'prep', 'other']);
const SUPPLIER_STATUSES = new Set(['active', 'inactive', 'issue_reported']);
const TRANSFER_STATUSES = new Set(['pending', 'completed', 'cancelled']);
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

function quantity(value, field = 'quantity') {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be a non-negative number' });
  }
  return Math.round(number * 1000) / 1000;
}

function operationId(value) {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim();
  if (!UUID_RE.test(normalized)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { clientOperationId: 'Must be a UUID' });
  }
  return normalized;
}

async function restaurantAccess(userId, restaurantId, client = pool) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows: [restaurant] } = await client.query(
    `SELECT fr.id, fr.business_id, fr.display_name, fr.address_city, fr.address_state,
            fr.address_country, fr.timezone, fr.currency_code,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role FROM business_members bm
                 WHERE bm.business_id = fr.business_id
                   AND bm.member_id = $2 AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role,
            (
              SELECT bm.id FROM business_members bm
               WHERE bm.business_id = fr.business_id
                 AND bm.member_id = $2 AND bm.status = 'active'
               LIMIT 1
            ) AS membership_id
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [restaurantId, userId]
  );
  if (!restaurant || !restaurant.effective_role) {
    throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  }
  return restaurant;
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

exports.getDashboard = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const [locationResult, riskResult, activityResult, prioritiesResult, impactsResult] = await Promise.all([
      pool.query(
        `SELECT name, address_city, address_state
           FROM restaurant_locations
          WHERE restaurant_id = $1 AND status <> 'inactive'
          ORDER BY is_primary DESC, id ASC LIMIT 1`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE quantity > 0 AND reorder_point > 0 AND quantity <= reorder_point)::int AS low_stock,
                COUNT(*) FILTER (WHERE quantity <= 0)::int AS out_of_stock,
                COUNT(*) FILTER (WHERE last_counted_at IS NULL OR last_counted_at < NOW() - INTERVAL '7 days')::int AS needs_count,
                (SELECT COUNT(*)::int FROM restaurant_inventory_supplier_issues
                  WHERE restaurant_id = $1 AND status IN ('open','monitoring','in_progress')) AS supplier_issues,
                (SELECT COUNT(*)::int FROM restaurant_inventory_purchase_requests
                  WHERE restaurant_id = $1 AND status IN ('pending','approved')) AS pending_requests
           FROM restaurant_inventory_items
          WHERE restaurant_id = $1 AND is_active = TRUE`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE adjustment_type = 'count')::int AS counts_done,
                COUNT(DISTINCT source_id) FILTER (WHERE adjustment_type = 'receive' AND source_type = 'receipt')::int AS deliveries,
                COUNT(*) FILTER (WHERE adjustment_type = 'waste')::int AS waste_reports,
                (SELECT COUNT(*)::int FROM restaurant_inventory_purchase_requests
                  WHERE restaurant_id = $1 AND created_at >= CURRENT_DATE) AS requests
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND created_at >= CURRENT_DATE`,
        [restaurantId]
      ),
      pool.query(
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
          WHERE i.restaurant_id = $1 AND i.is_active = TRUE
            AND (i.quantity <= 0 OR (i.reorder_point > 0 AND i.quantity <= i.reorder_point)
                 OR i.last_counted_at IS NULL OR i.last_counted_at < NOW() - INTERVAL '7 days')
          GROUP BY i.id, a.name
          ORDER BY CASE WHEN i.quantity <= 0 THEN 0
                        WHEN i.critical_level > 0 AND i.quantity <= i.critical_level THEN 1
                        ELSE 2 END, i.quantity ASC
          LIMIT 10`,
        [restaurantId]
      ),
      pool.query(
        `SELECT fmi.id AS menu_item_id, fmi.name AS menu_item_name,
                i.id AS inventory_item_id, i.name AS inventory_item_name,
                i.quantity, i.reorder_point, i.critical_level
           FROM restaurant_inventory_item_mappings m
           JOIN restaurant_inventory_items i ON i.id = m.inventory_item_id AND i.restaurant_id = m.restaurant_id
           JOIN food_menu_items fmi ON fmi.id = m.menu_item_id AND fmi.restaurant_id = m.restaurant_id
          WHERE m.restaurant_id = $1 AND m.auto_manage = TRUE
            AND (i.quantity <= 0 OR (i.reorder_point > 0 AND i.quantity <= i.reorder_point))
          ORDER BY i.quantity ASC, fmi.name ASC
          LIMIT 20`,
        [restaurantId]
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
    const [wasteDaily, wasteSummary, countSummary, varianceDaily, topWasted, deliverySummary, deliverySuppliers] = await Promise.all([
      pool.query(
        `SELECT created_at::date AS day,
                COUNT(*)::int AS reports,
                COALESCE(SUM(ABS(quantity_delta)), 0) AS quantity
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND adjustment_type = 'waste'
            AND created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY created_at::date ORDER BY day`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS reports,
                COALESCE(SUM(ABS(a.quantity_delta)), 0) AS quantity,
                COALESCE(SUM(ABS(a.quantity_delta) * i.unit_cost), 0) AS estimated_cost
           FROM restaurant_inventory_adjustments a
           LEFT JOIN restaurant_inventory_items i ON i.id = a.item_id AND i.restaurant_id = a.restaurant_id
          WHERE a.restaurant_id = $1 AND a.adjustment_type = 'waste'
            AND a.created_at >= date_trunc('week', CURRENT_DATE)`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE ABS(quantity_delta) = 0)::int AS exact,
                COUNT(*) FILTER (WHERE ABS(quantity_delta) > 0 AND ABS(quantity_delta) <= 1)::int AS minor,
                COUNT(*) FILTER (WHERE ABS(quantity_delta) > 1)::int AS major
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND adjustment_type = 'count'
            AND created_at >= CURRENT_DATE`,
        [restaurantId]
      ),
      pool.query(
        `SELECT created_at::date AS day, COALESCE(SUM(ABS(quantity_delta)), 0) AS variance
           FROM restaurant_inventory_adjustments
          WHERE restaurant_id = $1 AND adjustment_type = 'count'
            AND created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY created_at::date ORDER BY day`,
        [restaurantId]
      ),
      pool.query(
        `SELECT a.item_name, COALESCE(i.unit, 'unit') AS unit,
                COALESCE(SUM(ABS(a.quantity_delta)), 0) AS quantity,
                COALESCE(SUM(ABS(a.quantity_delta) * i.unit_cost), 0) AS estimated_cost
           FROM restaurant_inventory_adjustments a
           LEFT JOIN restaurant_inventory_items i ON i.id = a.item_id AND i.restaurant_id = a.restaurant_id
          WHERE a.restaurant_id = $1 AND a.adjustment_type = 'waste'
            AND a.created_at >= date_trunc('week', CURRENT_DATE)
          GROUP BY a.item_name, i.unit ORDER BY quantity DESC LIMIT 5`,
        [restaurantId]
      ),
      pool.query(
        `SELECT COUNT(DISTINCT r.id)::int AS total,
                COUNT(DISTINCT r.id) FILTER (WHERE l.received_quantity > l.accepted_quantity)::int AS with_issues,
                CASE WHEN COALESCE(SUM(l.expected_quantity), 0) > 0
                     THEN ROUND(100 * SUM(l.accepted_quantity) / SUM(l.expected_quantity))
                     ELSE 100 END AS fill_rate
           FROM restaurant_inventory_receipts r
           LEFT JOIN restaurant_inventory_receipt_lines l
             ON l.receipt_id = r.id
            AND l.restaurant_id = r.restaurant_id
          WHERE r.restaurant_id = $1
            AND r.received_at >= date_trunc('week', CURRENT_DATE)`,
        [restaurantId]
      ),
      pool.query(
        `SELECT r.supplier_name, COUNT(l.id)::int AS lines,
                COUNT(l.id) FILTER (WHERE l.received_quantity > l.accepted_quantity)::int AS issue_lines
           FROM restaurant_inventory_receipts r
           LEFT JOIN restaurant_inventory_receipt_lines l
             ON l.receipt_id = r.id
            AND l.restaurant_id = r.restaurant_id
          WHERE r.restaurant_id = $1
            AND r.received_at >= date_trunc('week', CURRENT_DATE)
          GROUP BY r.supplier_name ORDER BY lines DESC, r.supplier_name LIMIT 8`,
        [restaurantId]
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

exports.listTransfers = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const { rows } = await pool.query(
      `SELECT t.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS transferred_by_name
         FROM restaurant_inventory_transfers t
         LEFT JOIN users u ON u.id = t.transferred_by
        WHERE t.restaurant_id = $1 ORDER BY t.created_at DESC LIMIT 200`,
      [restaurantId]
    );
    res.json({ transfers: rows });
  } catch (error) { next(error); }
};

exports.createTransfer = async (req, res, next) => {
  try {
    const restaurantId = positiveInt(req.params.restaurantId);
    const restaurant = await restaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, UPDATE_INVENTORY);
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
        if (existing) return { transfer: existing, replayed: true };
      }
      const { rows: [item] } = await client.query(
        `SELECT id, name, unit FROM restaurant_inventory_items WHERE id = $1 AND restaurant_id = $2 AND is_active = TRUE`,
        [itemId, restaurantId]
      );
      if (!item) throw new AppError('Item not found', 404, 'inventory_item_not_found');
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
           (restaurant_id, item_id, item_name, quantity, unit, from_area_id, to_area_id,
            from_area_name, to_area_name, status, note, transferred_by, client_operation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [restaurantId, item.id, item.name, amount, item.unit, fromAreaId, toAreaId,
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
    if (!transferId) throw new AppError('Transfer not found', 404, 'inventory_transfer_not_found');
    if (!TRANSFER_STATUSES.has(req.body.status)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        status: 'Status must be pending, completed, or cancelled',
      });
    }
    const transfer = await withTransaction(pool, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_inventory_transfers
            SET status = $1, updated_at = NOW()
          WHERE id = $2 AND restaurant_id = $3
          RETURNING *`,
        [req.body.status, transferId, restaurantId]
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
    const { rows } = await pool.query(
      `SELECT r.*, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS received_by_name,
              COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]'::jsonb) AS lines
         FROM restaurant_inventory_receipts r
         LEFT JOIN restaurant_inventory_receipt_lines l
           ON l.receipt_id = r.id
          AND l.restaurant_id = r.restaurant_id
         LEFT JOIN users u ON u.id = r.received_by
        WHERE r.restaurant_id = $1
        GROUP BY r.id, u.first_name, u.last_name
        ORDER BY r.created_at DESC LIMIT 100`,
      [restaurantId]
    );
    res.json({ receipts: rows });
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
      const { rows: [receipt] } = await client.query(
        `INSERT INTO restaurant_inventory_receipts
           (restaurant_id, supplier_id, supplier_name, invoice_number, status, general_note,
            received_by, received_at, client_operation_id)
         VALUES ($1,$2,$3,$4,'received',$5,$6,NOW(),$7) RETURNING *`,
        [restaurantId, supplierId, supplierName, text(req.body.invoiceNumber, 120),
          text(req.body.generalNote, 2000), req.user.id, clientOperationId]
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
            inventoryItemId: item.id, apply: true, createdBy: req.user.id,
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
      await logInventoryAudit(client, auditEntry(restaurant, 'receipt_created', 'receipt', receipt.id, req, {
        supplierId,
        supplierName: receipt.supplier_name,
        invoiceNumber: receipt.invoice_number,
        lineCount: auditLines.length,
        acceptedLineCount: auditLines.filter((line) => line.acceptedQuantity > 0).length,
        lines: auditLines.slice(0, 50),
      }, clientOperationId));
      return { receipt: await receiptWithLines(client, restaurantId, receipt.id), replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
};
