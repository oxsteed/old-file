'use strict';

// OxSteed Restaurants — Inventory controller (Phase 3, App 7 backend).
//
// Additive surface under /api/restaurants. Mirrors restaurantOpsController:
// same requireRestaurantAccess model, every route nested under
// /restaurants/:restaurantId, every child row verified to belong to that
// restaurant (tenant isolation). The food_* ordering tables are untouched.
//
// Capabilities: item CRUD, stock adjustments (count/receive/waste/usage/
// correction) written to an append-only ledger, low-stock listing, and
// adjustment history. Access is governed by inventory.view, inventory.update,
// and inventory.manage team permissions after restaurant membership is proven.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');
const { syncMappedMenuAvailability } = require('../services/restaurantInventoryAvailabilityService');
const { getEffectivePermissions, hasAny } = require('../services/permissionsService');
const { logInventoryAudit } = require('../services/restaurantInventoryAuditService');

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

function parseQty(value, field = 'quantity') {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { [field]: 'Must be a number' });
  }
  // clamp to NUMERIC(12,3) range and 3 decimals
  return Math.round(Math.max(-1e9, Math.min(1e9, n)) * 1000) / 1000;
}

const CATEGORIES = ['general', 'produce', 'meat', 'dairy', 'dry_goods', 'frozen', 'beverage', 'packaging', 'cleaning'];
const ADJ_TYPES = ['count', 'receive', 'waste', 'usage', 'correction'];
const PURCHASE_STATUSES = ['pending', 'approved', 'ordered', 'received', 'delivered', 'rejected', 'cancelled'];
const ISSUE_STATUSES = ['open', 'monitoring', 'in_progress', 'resolved'];
const URGENCY_LEVELS = ['low', 'medium', 'high', 'urgent'];
const ISSUE_TYPES = ['short_delivery', 'wrong_item', 'poor_quality', 'late_delivery', 'damaged', 'billing', 'other'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseOperationId(value) {
  if (value === undefined || value === null || value === '') return null;
  const id = String(value).trim();
  if (!UUID_RE.test(id)) {
    throw new AppError('Validation failed', 400, 'validation_failed', { clientOperationId: 'Must be a UUID' });
  }
  return id;
}

async function requireRestaurantAccess(userId, restaurantId) {
  if (!restaurantId) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const { rows } = await pool.query(
    `SELECT fr.id, fr.business_id,
            CASE
              WHEN b.user_id = $2 OR fr.owner_user_id = $2 THEN 'owner'
              ELSE (
                SELECT bm.role FROM business_members bm
                 WHERE bm.business_id = fr.business_id AND bm.member_id = $2 AND bm.status = 'active'
                 LIMIT 1
              )
            END AS effective_role,
            (
              SELECT bm.id FROM business_members bm
               WHERE bm.business_id = fr.business_id AND bm.member_id = $2 AND bm.status = 'active'
               LIMIT 1
            ) AS membership_id
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

// ── Items ───────────────────────────────────────────────────────────────────
exports.listItems = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const lowOnly = req.query.lowStock === '1' || req.query.lowStock === 'true';

    const { rows } = await pool.query(
      `SELECT i.*,
              COALESCE(reserved.quantity, 0) AS reserved_quantity,
              GREATEST(0, i.quantity - COALESCE(reserved.quantity, 0)) AS available_quantity,
              a.name AS area_name,
              COALESCE(s.name, i.supplier_name) AS supplier_display_name,
              (GREATEST(0, i.quantity - COALESCE(reserved.quantity, 0)) <= i.reorder_point
                AND i.reorder_point > 0) AS is_low,
              COALESCE(
                jsonb_agg(DISTINCT jsonb_build_object('id', fmi.id, 'name', fmi.name))
                  FILTER (WHERE fmi.id IS NOT NULL), '[]'::jsonb
              ) AS affected_menu_items
         FROM restaurant_inventory_items i
         LEFT JOIN restaurant_inventory_storage_areas a
           ON a.id = i.storage_area_id
          AND a.restaurant_id = i.restaurant_id
         LEFT JOIN restaurant_inventory_suppliers s
           ON s.id = i.supplier_id
          AND s.restaurant_id = i.restaurant_id
         LEFT JOIN (
           SELECT restaurant_id, inventory_item_id, SUM(quantity) AS quantity
             FROM restaurant_inventory_order_reservations
            WHERE status = 'reserved'
            GROUP BY restaurant_id, inventory_item_id
         ) reserved
           ON reserved.inventory_item_id = i.id
          AND reserved.restaurant_id = i.restaurant_id
         LEFT JOIN restaurant_inventory_item_mappings m
           ON m.inventory_item_id = i.id
          AND m.restaurant_id = i.restaurant_id
         LEFT JOIN food_menu_items fmi
           ON fmi.id = m.menu_item_id
          AND fmi.restaurant_id = i.restaurant_id
        WHERE i.restaurant_id = $1 AND i.is_active = TRUE
          ${lowOnly ? 'AND GREATEST(0, i.quantity - COALESCE(reserved.quantity, 0)) <= i.reorder_point AND i.reorder_point > 0' : ''}
        GROUP BY i.id, a.name, s.name
        ORDER BY i.name ASC`,
      [restaurantId]
    );
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
};

exports.createItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);

    const name = normalizeString(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'general';
    const quantity = parseQty(req.body.quantity) ?? 0;
    const reorderPoint = parseQty(req.body.reorderPoint ?? req.body.lowStockThreshold, 'reorderPoint') ?? 0;
    const criticalLevel = parseQty(req.body.criticalLevel, 'criticalLevel') ?? 0;
    const parLevel = parseQty(req.body.parLevel, 'parLevel') ?? 0;
    const unitCost = parseQty(req.body.unitCost, 'unitCost') ?? 0;
    if ([quantity, reorderPoint, criticalLevel, parLevel, unitCost].some((value) => value < 0)) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        quantity: quantity < 0 ? 'Quantity cannot be negative' : undefined,
        reorderPoint: reorderPoint < 0 ? 'Threshold cannot be negative' : undefined,
        criticalLevel: criticalLevel < 0 ? 'Threshold cannot be negative' : undefined,
        parLevel: parLevel < 0 ? 'Par cannot be negative' : undefined,
        unitCost: unitCost < 0 ? 'Cost cannot be negative' : undefined,
      });
    }
    const supplierId = parsePositiveInt(req.body.supplierId);
    const storageAreaId = parsePositiveInt(req.body.storageAreaId);
    if (supplierId || storageAreaId) {
      const { rows: [ownership] } = await pool.query(
        `SELECT ($2::bigint IS NULL OR EXISTS(
                  SELECT 1 FROM restaurant_inventory_suppliers WHERE id = $2 AND restaurant_id = $1
                )) AS supplier_ok,
                ($3::bigint IS NULL OR EXISTS(
                  SELECT 1 FROM restaurant_inventory_storage_areas WHERE id = $3 AND restaurant_id = $1
                )) AS area_ok`,
        [restaurantId, supplierId, storageAreaId]
      );
      if (!ownership.supplier_ok || !ownership.area_ok) {
        throw new AppError('Inventory reference not found', 404, 'inventory_reference_not_found');
      }
    }

    const item = await withTransaction(pool, async (client) => {
      const { rows: [created] } = await client.query(
        `INSERT INTO restaurant_inventory_items
           (restaurant_id, name, category, unit, quantity, low_stock_threshold,
            reorder_point, critical_level, par_level, sku, supplier_name,
            supplier_id, storage_area_id, unit_cost, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          restaurantId, name, category,
          normalizeString(req.body.unit, 24) || 'ea',
          quantity,
          reorderPoint,
          criticalLevel,
          parLevel,
          normalizeString(req.body.sku, 60),
          normalizeString(req.body.supplierName, 160),
          supplierId,
          storageAreaId,
          unitCost,
          req.user.id,
        ]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'item_created', 'item', created.id, req, {
        name: created.name,
        category: created.category,
        quantity: created.quantity,
        unit: created.unit,
      }));
      return created;
    });
    res.status(201).json({ item });
  } catch (err) {
    next(err);
  }
};

exports.updateItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.name !== undefined) {
      const name = normalizeString(req.body.name, 160);
      if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
      sets.push(`name = $${i++}`); vals.push(name);
    }
    if (req.body.category !== undefined && CATEGORIES.includes(req.body.category)) { sets.push(`category = $${i++}`); vals.push(req.body.category); }
    if (req.body.unit !== undefined) { sets.push(`unit = $${i++}`); vals.push(normalizeString(req.body.unit, 24) || 'ea'); }
    if (req.body.lowStockThreshold !== undefined) {
      const threshold = parseQty(req.body.lowStockThreshold, 'lowStockThreshold') ?? 0;
      if (threshold < 0) {
        throw new AppError('Validation failed', 400, 'validation_failed', { lowStockThreshold: 'Threshold cannot be negative' });
      }
      sets.push(`low_stock_threshold = $${i++}`); vals.push(threshold);
      if (req.body.reorderPoint === undefined) {
        sets.push(`reorder_point = $${i++}`); vals.push(threshold);
      }
    }
    if (req.body.reorderPoint !== undefined) {
      const threshold = parseQty(req.body.reorderPoint, 'reorderPoint') ?? 0;
      if (threshold < 0) throw new AppError('Validation failed', 400, 'validation_failed', { reorderPoint: 'Threshold cannot be negative' });
      sets.push(`reorder_point = $${i++}`); vals.push(threshold);
      sets.push(`low_stock_threshold = $${i++}`); vals.push(threshold);
    }
    if (req.body.criticalLevel !== undefined) {
      const threshold = parseQty(req.body.criticalLevel, 'criticalLevel') ?? 0;
      if (threshold < 0) throw new AppError('Validation failed', 400, 'validation_failed', { criticalLevel: 'Threshold cannot be negative' });
      sets.push(`critical_level = $${i++}`); vals.push(threshold);
    }
    if (req.body.parLevel !== undefined) {
      const par = parseQty(req.body.parLevel, 'parLevel') ?? 0;
      if (par < 0) throw new AppError('Validation failed', 400, 'validation_failed', { parLevel: 'Par cannot be negative' });
      sets.push(`par_level = $${i++}`); vals.push(par);
    }
    if (req.body.unitCost !== undefined) {
      const unitCost = parseQty(req.body.unitCost, 'unitCost') ?? 0;
      if (unitCost < 0) throw new AppError('Validation failed', 400, 'validation_failed', { unitCost: 'Cost cannot be negative' });
      sets.push(`unit_cost = $${i++}`); vals.push(unitCost);
    }
    if (req.body.sku !== undefined) { sets.push(`sku = $${i++}`); vals.push(normalizeString(req.body.sku, 60)); }
    if (req.body.supplierName !== undefined) { sets.push(`supplier_name = $${i++}`); vals.push(normalizeString(req.body.supplierName, 160)); }
    if (req.body.supplierId !== undefined) {
      const supplierId = parsePositiveInt(req.body.supplierId);
      if (supplierId) {
        const { rows: [supplier] } = await pool.query(
          `SELECT id FROM restaurant_inventory_suppliers WHERE id = $1 AND restaurant_id = $2`,
          [supplierId, restaurantId]
        );
        if (!supplier) throw new AppError('Supplier not found', 404, 'supplier_not_found');
      }
      sets.push(`supplier_id = $${i++}`); vals.push(supplierId);
    }
    if (req.body.storageAreaId !== undefined) {
      const storageAreaId = parsePositiveInt(req.body.storageAreaId);
      if (storageAreaId) {
        const { rows: [area] } = await pool.query(
          `SELECT id FROM restaurant_inventory_storage_areas WHERE id = $1 AND restaurant_id = $2`,
          [storageAreaId, restaurantId]
        );
        if (!area) throw new AppError('Storage area not found', 404, 'storage_area_not_found');
      }
      sets.push(`storage_area_id = $${i++}`); vals.push(storageAreaId);
    }
    if (req.body.isActive !== undefined) { sets.push(`is_active = $${i++}`); vals.push(req.body.isActive !== false); }
    // NOTE: quantity is intentionally NOT editable here — it only changes via
    // /adjust so every change is ledgered. This keeps stock auditable.
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');

    const result = await withTransaction(pool, async (client) => {
      const { rows: [item] } = await client.query(
        `UPDATE restaurant_inventory_items SET ${sets.join(', ')}
          WHERE id = $${i++} AND restaurant_id = $${i}
          RETURNING *`,
        [...vals, itemId, restaurantId]
      );
      if (!item) throw new AppError('Item not found', 404, 'inventory_item_not_found');
      const affectsAvailability = req.body.lowStockThreshold !== undefined
        || req.body.reorderPoint !== undefined
        || req.body.criticalLevel !== undefined
        || req.body.isActive !== undefined;
      const availability = affectsAvailability
        ? await syncMappedMenuAvailability(client, restaurantId, {
          inventoryItemId: itemId, apply: true, createdBy: req.user.id,
        })
        : { changes: [], applied: false };
      await logInventoryAudit(client, auditEntry(restaurant, 'item_updated', 'item', item.id, req, {
        changedFields: sets.filter((set) => !set.startsWith('updated_at')).map((set) => set.split(' = ')[0]),
      }));
      return { item, availability };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.deleteItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);
    const availability = await withTransaction(pool, async (client) => {
      const { rows: [item] } = await client.query(
        `DELETE FROM restaurant_inventory_items WHERE id = $1 AND restaurant_id = $2 RETURNING id, name, category`,
        [itemId, restaurantId]
      );
      if (!item) throw new AppError('Item not found', 404, 'inventory_item_not_found');
      const syncResult = await syncMappedMenuAvailability(client, restaurantId, { apply: true, createdBy: req.user.id });
      await logInventoryAudit(client, auditEntry(restaurant, 'item_deleted', 'item', item.id, req, {
        name: item.name,
        category: item.category,
      }));
      return syncResult;
    });
    res.json({ ok: true, availability });
  } catch (err) {
    next(err);
  }
};

// ── Adjustments (the only way stock quantity changes) ───────────────────────
// type 'count' sets the on-hand to an absolute value (delta computed from
// current). All other types apply a signed delta (receive +, waste/usage -).
exports.adjustItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, UPDATE_INVENTORY);

    const type = ADJ_TYPES.includes(req.body.type) ? req.body.type : null;
    if (!type) throw new AppError('Validation failed', 400, 'validation_failed', { type: 'Unsupported adjustment type' });
    const clientOperationId = parseOperationId(req.body.clientOperationId);

    const result = await withTransaction(pool, async (client) => {
      if (clientOperationId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`inventory-adjustment:${restaurantId}:${clientOperationId}`]);
        const { rows: [existing] } = await client.query(
          `SELECT a.*, i.*
             FROM restaurant_inventory_adjustments a
             JOIN restaurant_inventory_items i
               ON i.id = a.item_id
              AND i.restaurant_id = a.restaurant_id
            WHERE a.restaurant_id = $1 AND a.client_operation_id = $2`,
          [restaurantId, clientOperationId]
        );
        if (existing) return { item: existing, availability: { changes: [], applied: false }, replayed: true };
      }
      const { rows: [item] } = await client.query(
        `SELECT * FROM restaurant_inventory_items
          WHERE id = $1 AND restaurant_id = $2 FOR UPDATE`,
        [itemId, restaurantId]
      );
      if (!item) throw new AppError('Item not found', 404, 'inventory_item_not_found');

      const current = Number(item.quantity);
      let delta;
      let after;
      if (type === 'count') {
        const counted = parseQty(req.body.quantity, 'quantity');
        if (counted === null) throw new AppError('Validation failed', 400, 'validation_failed', { quantity: 'Counted quantity is required' });
        after = Math.max(0, counted);
        delta = Math.round((after - current) * 1000) / 1000;
      } else {
        const d = parseQty(req.body.delta, 'delta');
        if (d === null) throw new AppError('Validation failed', 400, 'validation_failed', { delta: 'Delta is required' });
        if (d === 0 || (type !== 'correction' && d < 0)) {
          throw new AppError('Validation failed', 400, 'validation_failed', {
            delta: type === 'correction' ? 'Correction delta cannot be zero' : 'Delta must be greater than zero',
          });
        }
        // Receive adds; waste/usage subtract; only correction may be signed.
        const signed = (type === 'waste' || type === 'usage') ? -d : d;
        after = Math.max(0, Math.round((current + signed) * 1000) / 1000);
        delta = Math.round((after - current) * 1000) / 1000;
      }

      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_inventory_items
            SET quantity = $1,
                last_counted_at = CASE WHEN $3 = 'count' THEN NOW() ELSE last_counted_at END,
                updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [after, itemId, type]
      );
      await client.query(
        `INSERT INTO restaurant_inventory_adjustments
           (restaurant_id, item_id, item_name, adjustment_type, quantity_delta,
            quantity_after, note, reason, adjusted_by, client_operation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [restaurantId, itemId, item.name, type, delta, after,
          normalizeString(req.body.note, 1000), normalizeString(req.body.reason, 120),
          req.user.id, clientOperationId]
      );
      const availability = await syncMappedMenuAvailability(client, restaurantId, {
        inventoryItemId: itemId,
        apply: true,
        createdBy: req.user.id,
      });
      await logInventoryAudit(client, auditEntry(restaurant, 'stock_adjusted', 'item', itemId, req, {
        itemName: item.name,
        adjustmentType: type,
        quantityBefore: current,
        quantityDelta: delta,
        quantityAfter: after,
        reason: normalizeString(req.body.reason, 120),
        note: normalizeString(req.body.note, 1000),
      }, clientOperationId));
      return { item: updated, availability, replayed: false };
    });
    res.json({
      item: {
        ...result.item,
        is_low: Number(result.item.quantity) <= Number(result.item.low_stock_threshold) && Number(result.item.low_stock_threshold) > 0,
      },
      availability: result.availability,
      replayed: result.replayed,
    });
  } catch (err) {
    next(err);
  }
};

exports.listAdjustments = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const itemId = parsePositiveInt(req.query.itemId);

    const params = [restaurantId];
    let where = 'restaurant_id = $1';
    if (itemId) { params.push(itemId); where += ` AND item_id = $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT a.*, COALESCE(i.unit, 'unit') AS unit,
              COALESCE(i.category, 'general') AS category,
              NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS adjusted_by_name
         FROM restaurant_inventory_adjustments a
         LEFT JOIN restaurant_inventory_items i ON i.id = a.item_id AND i.restaurant_id = a.restaurant_id
         LEFT JOIN users u ON u.id = a.adjusted_by
        WHERE ${where.replaceAll('restaurant_id', 'a.restaurant_id').replaceAll('item_id', 'a.item_id')}
        ORDER BY a.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ adjustments: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

// ── Purchase requests ────────────────────────────────────────────────────────
exports.listPurchaseRequests = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT r.*, NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS requested_by_name
         FROM restaurant_inventory_purchase_requests r
         LEFT JOIN users u ON u.id = r.requested_by
        WHERE r.restaurant_id = $1
        ORDER BY r.created_at DESC
        LIMIT $2 OFFSET $3`,
      [restaurantId, limit, offset]
    );
    res.json({ requests: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

exports.createPurchaseRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, UPDATE_INVENTORY);

    const itemName = normalizeString(req.body.itemName, 160);
    if (!itemName) throw new AppError('Validation failed', 400, 'validation_failed', { itemName: 'Item name is required' });
    const requestedQuantity = parseQty(req.body.requestedQuantity, 'requestedQuantity');
    if (requestedQuantity === null || requestedQuantity <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { requestedQuantity: 'Quantity must be greater than zero' });
    }

    const status = PURCHASE_STATUSES.includes(req.body.status) ? req.body.status : 'pending';
    const urgency = URGENCY_LEVELS.includes(req.body.urgency) ? req.body.urgency : 'medium';
    const estimatedCost = req.body.estimatedCost == null ? null : parseQty(req.body.estimatedCost, 'estimatedCost');
    const clientOperationId = parseOperationId(req.body.clientOperationId);
    const result = await withTransaction(pool, async (client) => {
      if (clientOperationId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`inventory-request:${restaurantId}:${clientOperationId}`]);
        const { rows: [existing] } = await client.query(
          `SELECT * FROM restaurant_inventory_purchase_requests WHERE restaurant_id = $1 AND client_operation_id = $2`,
          [restaurantId, clientOperationId]
        );
        if (existing) return { request: existing, replayed: true };
      }
      const { rows: [request] } = await client.query(
        `INSERT INTO restaurant_inventory_purchase_requests
           (restaurant_id, item_name, requested_quantity, unit, supplier_name, status,
            eta_window, note, requested_by, estimated_cost, urgency, client_operation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [restaurantId, itemName, requestedQuantity, normalizeString(req.body.unit, 24) || 'units',
          normalizeString(req.body.supplierName, 160), status, normalizeString(req.body.etaWindow, 80),
          normalizeString(req.body.note, 1000), req.user.id, estimatedCost, urgency, clientOperationId]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'purchase_request_created', 'purchase_request', request.id, req, {
        itemName: request.item_name,
        requestedQuantity: request.requested_quantity,
        unit: request.unit,
        status: request.status,
        urgency: request.urgency,
      }, clientOperationId));
      return { request, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.updatePurchaseRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const requestId = parsePositiveInt(req.params.requestId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.itemName !== undefined) {
      const itemName = normalizeString(req.body.itemName, 160);
      if (!itemName) throw new AppError('Validation failed', 400, 'validation_failed', { itemName: 'Item name is required' });
      sets.push(`item_name = $${i++}`); vals.push(itemName);
    }
    if (req.body.requestedQuantity !== undefined) {
      const requestedQuantity = parseQty(req.body.requestedQuantity, 'requestedQuantity');
      if (requestedQuantity === null || requestedQuantity <= 0) {
        throw new AppError('Validation failed', 400, 'validation_failed', { requestedQuantity: 'Quantity must be greater than zero' });
      }
      sets.push(`requested_quantity = $${i++}`); vals.push(requestedQuantity);
    }
    if (req.body.unit !== undefined) { sets.push(`unit = $${i++}`); vals.push(normalizeString(req.body.unit, 24) || 'units'); }
    if (req.body.supplierName !== undefined) { sets.push(`supplier_name = $${i++}`); vals.push(normalizeString(req.body.supplierName, 160)); }
    if (req.body.status !== undefined && PURCHASE_STATUSES.includes(req.body.status)) { sets.push(`status = $${i++}`); vals.push(req.body.status); }
    if (req.body.etaWindow !== undefined) { sets.push(`eta_window = $${i++}`); vals.push(normalizeString(req.body.etaWindow, 80)); }
    if (req.body.note !== undefined) { sets.push(`note = $${i++}`); vals.push(normalizeString(req.body.note, 1000)); }
    if (req.body.estimatedCost !== undefined) { sets.push(`estimated_cost = $${i++}`); vals.push(req.body.estimatedCost == null ? null : parseQty(req.body.estimatedCost, 'estimatedCost')); }
    if (req.body.urgency !== undefined && URGENCY_LEVELS.includes(req.body.urgency)) { sets.push(`urgency = $${i++}`); vals.push(req.body.urgency); }
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');

    const request = await withTransaction(pool, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_inventory_purchase_requests SET ${sets.join(', ')}
          WHERE id = $${i++} AND restaurant_id = $${i}
          RETURNING *`,
        [...vals, requestId, restaurantId]
      );
      if (!updated) throw new AppError('Purchase request not found', 404, 'purchase_request_not_found');
      await logInventoryAudit(client, auditEntry(restaurant, 'purchase_request_updated', 'purchase_request', updated.id, req, {
        status: updated.status,
        urgency: updated.urgency,
        changedFields: sets.filter((set) => !set.startsWith('updated_at')).map((set) => set.split(' = ')[0]),
      }));
      return updated;
    });
    res.json({ request });
  } catch (err) {
    next(err);
  }
};

// ── Supplier issues ─────────────────────────────────────────────────────────
exports.listSupplierIssues = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT i.*, NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS reported_by_name
         FROM restaurant_inventory_supplier_issues i
         LEFT JOIN users u ON u.id = i.reported_by
        WHERE i.restaurant_id = $1
        ORDER BY i.created_at DESC
        LIMIT $2 OFFSET $3`,
      [restaurantId, limit, offset]
    );
    res.json({ issues: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

exports.createSupplierIssue = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, UPDATE_INVENTORY);

    const supplierName = normalizeString(req.body.supplierName, 160);
    const issue = normalizeString(req.body.issue, 2000);
    if (!supplierName) throw new AppError('Validation failed', 400, 'validation_failed', { supplierName: 'Supplier name is required' });
    if (!issue) throw new AppError('Validation failed', 400, 'validation_failed', { issue: 'Issue details are required' });

    const relatedPurchaseRequestId = parsePositiveInt(req.body.relatedPurchaseRequestId);
    if (relatedPurchaseRequestId) {
      const { rows } = await pool.query(
        `SELECT id FROM restaurant_inventory_purchase_requests
          WHERE id = $1 AND restaurant_id = $2`,
        [relatedPurchaseRequestId, restaurantId]
      );
      if (!rows[0]) throw new AppError('Related purchase request not found', 404, 'purchase_request_not_found');
    }

    const status = ISSUE_STATUSES.includes(req.body.status) ? req.body.status : 'open';
    const issueType = ISSUE_TYPES.includes(req.body.issueType) ? req.body.issueType : 'other';
    const affectedItemNames = Array.isArray(req.body.affectedItemNames)
      ? req.body.affectedItemNames.map((name) => normalizeString(name, 160)).filter(Boolean).slice(0, 100)
      : [];
    const clientOperationId = parseOperationId(req.body.clientOperationId);
    const result = await withTransaction(pool, async (client) => {
      if (clientOperationId) {
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`inventory-issue:${restaurantId}:${clientOperationId}`]);
        const { rows: [existing] } = await client.query(
          `SELECT * FROM restaurant_inventory_supplier_issues WHERE restaurant_id = $1 AND client_operation_id = $2`,
          [restaurantId, clientOperationId]
        );
        if (existing) return { issue: existing, replayed: true };
      }
      const { rows: [issueRow] } = await client.query(
        `INSERT INTO restaurant_inventory_supplier_issues
           (restaurant_id, supplier_name, issue, status, related_purchase_request_id,
            reported_by, issue_type, delivery_reference, affected_item_names, client_operation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         RETURNING *`,
        [restaurantId, supplierName, issue, status, relatedPurchaseRequestId, req.user.id,
          issueType, normalizeString(req.body.deliveryReference, 120), JSON.stringify(affectedItemNames), clientOperationId]
      );
      await logInventoryAudit(client, auditEntry(restaurant, 'supplier_issue_created', 'supplier_issue', issueRow.id, req, {
        supplierName: issueRow.supplier_name,
        issueType: issueRow.issue_type,
        status: issueRow.status,
        affectedItemNames,
      }, clientOperationId));
      return { issue: issueRow, replayed: false };
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.updateSupplierIssue = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const issueId = parsePositiveInt(req.params.issueId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);

    const sets = [];
    const vals = [];
    let i = 1;
    if (req.body.supplierName !== undefined) {
      const supplierName = normalizeString(req.body.supplierName, 160);
      if (!supplierName) throw new AppError('Validation failed', 400, 'validation_failed', { supplierName: 'Supplier name is required' });
      sets.push(`supplier_name = $${i++}`); vals.push(supplierName);
    }
    if (req.body.issue !== undefined) {
      const issue = normalizeString(req.body.issue, 2000);
      if (!issue) throw new AppError('Validation failed', 400, 'validation_failed', { issue: 'Issue details are required' });
      sets.push(`issue = $${i++}`); vals.push(issue);
    }
    if (req.body.status !== undefined && ISSUE_STATUSES.includes(req.body.status)) { sets.push(`status = $${i++}`); vals.push(req.body.status); }
    if (req.body.issueType !== undefined && ISSUE_TYPES.includes(req.body.issueType)) { sets.push(`issue_type = $${i++}`); vals.push(req.body.issueType); }
    if (req.body.deliveryReference !== undefined) { sets.push(`delivery_reference = $${i++}`); vals.push(normalizeString(req.body.deliveryReference, 120)); }
    if (req.body.affectedItemNames !== undefined) {
      const names = Array.isArray(req.body.affectedItemNames)
        ? req.body.affectedItemNames.map((name) => normalizeString(name, 160)).filter(Boolean).slice(0, 100)
        : [];
      sets.push(`affected_item_names = $${i++}::jsonb`); vals.push(JSON.stringify(names));
    }
    if (req.body.relatedPurchaseRequestId !== undefined) {
      const relatedPurchaseRequestId = parsePositiveInt(req.body.relatedPurchaseRequestId);
      if (relatedPurchaseRequestId) {
        const { rows } = await pool.query(
          `SELECT id FROM restaurant_inventory_purchase_requests
            WHERE id = $1 AND restaurant_id = $2`,
          [relatedPurchaseRequestId, restaurantId]
        );
        if (!rows[0]) throw new AppError('Related purchase request not found', 404, 'purchase_request_not_found');
      }
      sets.push(`related_purchase_request_id = $${i++}`); vals.push(relatedPurchaseRequestId);
    }
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');

    const issueRow = await withTransaction(pool, async (client) => {
      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_inventory_supplier_issues SET ${sets.join(', ')}
          WHERE id = $${i++} AND restaurant_id = $${i}
          RETURNING *`,
        [...vals, issueId, restaurantId]
      );
      if (!updated) throw new AppError('Supplier issue not found', 404, 'supplier_issue_not_found');
      await logInventoryAudit(client, auditEntry(restaurant, 'supplier_issue_updated', 'supplier_issue', updated.id, req, {
        supplierName: updated.supplier_name,
        issueType: updated.issue_type,
        status: updated.status,
        changedFields: sets.filter((set) => !set.startsWith('updated_at')).map((set) => set.split(' = ')[0]),
      }));
      return updated;
    });
    res.json({ issue: issueRow });
  } catch (err) {
    next(err);
  }
};

// ── Ingredient to menu mappings ─────────────────────────────────────────────
exports.listMappings = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, VIEW_INVENTORY);
    const { rows } = await pool.query(
      `SELECT rim.id,
              rim.inventory_item_id,
              rii.name AS inventory_item_name,
              rim.menu_item_id,
              fmi.name AS menu_item_name,
              rim.usage_label,
              rim.required_quantity,
              rim.auto_manage
         FROM restaurant_inventory_item_mappings rim
         JOIN restaurant_inventory_items rii
           ON rii.id = rim.inventory_item_id
          AND rii.restaurant_id = rim.restaurant_id
         JOIN food_menu_items fmi
           ON fmi.id = rim.menu_item_id
          AND fmi.restaurant_id = rim.restaurant_id
        WHERE rim.restaurant_id = $1
        ORDER BY rii.name ASC, fmi.name ASC`,
      [restaurantId]
    );
    res.json({ mappings: rows });
  } catch (err) {
    next(err);
  }
};

exports.upsertMapping = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);
    const inventoryItemId = parsePositiveInt(req.body.inventoryItemId || req.body.inventory_item_id);
    const menuItemId = parsePositiveInt(req.body.menuItemId || req.body.menu_item_id);
    const usageLabel = normalizeString(req.body.usageLabel || req.body.usage_label, 120);
    const requiredQuantity = parseQty(req.body.requiredQuantity ?? req.body.required_quantity ?? 0.001, 'requiredQuantity');
    if (!inventoryItemId || !menuItemId || !usageLabel) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        inventoryItemId: 'Inventory item is required',
        menuItemId: 'Menu item is required',
        usageLabel: 'Usage label is required',
      });
    }
    if (requiredQuantity === null || requiredQuantity <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        requiredQuantity: 'Required quantity must be greater than zero',
      });
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [ownership] } = await client.query(
        `SELECT EXISTS(
                  SELECT 1 FROM restaurant_inventory_items
                   WHERE id = $2 AND restaurant_id = $1 AND is_active = TRUE
                ) AS inventory_exists,
                EXISTS(
                  SELECT 1 FROM food_menu_items WHERE id = $3 AND restaurant_id = $1
                ) AS menu_exists`,
        [restaurantId, inventoryItemId, menuItemId]
      );
      if (!ownership.inventory_exists) throw new AppError('Inventory item not found', 404, 'inventory_item_not_found');
      if (!ownership.menu_exists) throw new AppError('Menu item not found', 404, 'menu_item_not_found');
      const { rows: [mapping] } = await client.query(
        `INSERT INTO restaurant_inventory_item_mappings
           (restaurant_id, inventory_item_id, menu_item_id, usage_label,
            required_quantity, auto_manage, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (restaurant_id, inventory_item_id, menu_item_id)
         DO UPDATE SET usage_label = EXCLUDED.usage_label,
                       required_quantity = EXCLUDED.required_quantity,
                       auto_manage = EXCLUDED.auto_manage,
                       updated_at = NOW()
         RETURNING *`,
        [restaurantId, inventoryItemId, menuItemId, usageLabel, requiredQuantity,
          req.body.autoManage !== false && req.body.auto_manage !== false, req.user.id]
      );
      const availability = await syncMappedMenuAvailability(client, restaurantId, {
        menuItemId, apply: true, createdBy: req.user.id,
      });
      await logInventoryAudit(client, auditEntry(restaurant, 'mapping_upserted', 'mapping', mapping.id, req, {
        inventoryItemId: mapping.inventory_item_id,
        menuItemId: mapping.menu_item_id,
        usageLabel: mapping.usage_label,
        requiredQuantity: mapping.required_quantity,
        autoManage: mapping.auto_manage,
      }));
      return { mapping, availability };
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
};

exports.deleteMapping = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const mappingId = parsePositiveInt(req.params.mappingId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);
    const result = await withTransaction(pool, async (client) => {
      const { rows: [mapping] } = await client.query(
        `DELETE FROM restaurant_inventory_item_mappings
          WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
        [mappingId, restaurantId]
      );
      if (!mapping) throw new AppError('Inventory mapping not found', 404, 'inventory_mapping_not_found');
      const availability = await syncMappedMenuAvailability(client, restaurantId, {
        menuItemId: mapping.menu_item_id, apply: true, createdBy: req.user.id,
      });
      await logInventoryAudit(client, auditEntry(restaurant, 'mapping_deleted', 'mapping', mapping.id, req, {
        inventoryItemId: mapping.inventory_item_id,
        menuItemId: mapping.menu_item_id,
      }));
      return { mapping, availability };
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

exports.bootstrapMappings = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    await requireInventoryPermission(req.user.id, restaurant, MANAGE_INVENTORY);

    await withTransaction(pool, async (client) => {
      const { rows: [{ count }] } = await client.query(
        `SELECT COUNT(*)::int AS count
           FROM restaurant_inventory_item_mappings
          WHERE restaurant_id = $1`,
        [restaurantId]
      );
      if (count > 0) return;

      const { rows: inventoryRows } = await client.query(
        `SELECT id, name, unit
           FROM restaurant_inventory_items
          WHERE restaurant_id = $1 AND is_active = TRUE`,
        [restaurantId]
      );
      const { rows: menuRows } = await client.query(
        `SELECT id, name
           FROM food_menu_items
          WHERE restaurant_id = $1
          ORDER BY sort_order ASC, id ASC`,
        [restaurantId]
      );
      if (!inventoryRows.length || !menuRows.length) return;

      const inventoryByName = new Map(inventoryRows.map((row) => [String(row.name).toLowerCase(), row]));
      const menuByName = new Map(menuRows.map((row) => [String(row.name).toLowerCase(), row]));
      const seeds = [
        ['burger buns', 'classic ox burger', '1 bun', 1],
        ['ground beef', 'classic ox burger', '0.33 lb', 0.33],
        ['cold brew', 'cold brew', '12 oz', 12],
      ];

      for (const [inventoryName, menuName, usageLabel, requiredQuantity] of seeds) {
        const inventoryItem = inventoryByName.get(inventoryName);
        const menuItem = menuByName.get(menuName);
        if (!inventoryItem || !menuItem) continue;
        await client.query(
          `INSERT INTO restaurant_inventory_item_mappings
             (restaurant_id, inventory_item_id, menu_item_id, usage_label, required_quantity, created_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (restaurant_id, inventory_item_id, menu_item_id) DO NOTHING`,
          [restaurantId, inventoryItem.id, menuItem.id, usageLabel, requiredQuantity, req.user.id]
        );
      }
      await logInventoryAudit(client, auditEntry(restaurant, 'mappings_bootstrapped', 'mapping', null, req, {
        seedCount: seeds.length,
      }));
    });

    await withTransaction(pool, async (client) => {
      await syncMappedMenuAvailability(client, restaurantId, { apply: true, createdBy: req.user.id });
    });

    return exports.listMappings(req, res, next);
  } catch (err) {
    next(err);
  }
};
