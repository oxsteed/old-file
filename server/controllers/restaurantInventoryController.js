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
// adjustment history. Item authoring = owner/manager; recording adjustments
// (counts/receiving/waste) is open to any active member (e.g. inventory staff).

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { withTransaction } = require('../utils/transaction');

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
const PURCHASE_STATUSES = ['pending', 'ordered', 'received', 'cancelled'];
const ISSUE_STATUSES = ['open', 'monitoring', 'resolved'];
const MANAGE_ROLES = new Set(['owner', 'manager']);

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

// ── Items ───────────────────────────────────────────────────────────────────
exports.listItems = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const lowOnly = req.query.lowStock === '1' || req.query.lowStock === 'true';

    const { rows } = await pool.query(
      `SELECT *, (quantity <= low_stock_threshold AND low_stock_threshold > 0) AS is_low
         FROM restaurant_inventory_items
        WHERE restaurant_id = $1 AND is_active = TRUE
          ${lowOnly ? 'AND quantity <= low_stock_threshold AND low_stock_threshold > 0' : ''}
        ORDER BY name ASC`,
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
    assertManage(restaurant);

    const name = normalizeString(req.body.name, 160);
    if (!name) throw new AppError('Validation failed', 400, 'validation_failed', { name: 'Name is required' });
    const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'general';

    const { rows: [item] } = await pool.query(
      `INSERT INTO restaurant_inventory_items
         (restaurant_id, name, category, unit, quantity, low_stock_threshold, sku, supplier_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        restaurantId, name, category,
        normalizeString(req.body.unit, 24) || 'ea',
        parseQty(req.body.quantity) ?? 0,
        parseQty(req.body.lowStockThreshold, 'lowStockThreshold') ?? 0,
        normalizeString(req.body.sku, 60),
        normalizeString(req.body.supplierName, 160),
        req.user.id,
      ]
    );
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
    assertManage(restaurant);

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
    if (req.body.lowStockThreshold !== undefined) { sets.push(`low_stock_threshold = $${i++}`); vals.push(parseQty(req.body.lowStockThreshold, 'lowStockThreshold') ?? 0); }
    if (req.body.sku !== undefined) { sets.push(`sku = $${i++}`); vals.push(normalizeString(req.body.sku, 60)); }
    if (req.body.supplierName !== undefined) { sets.push(`supplier_name = $${i++}`); vals.push(normalizeString(req.body.supplierName, 160)); }
    if (req.body.isActive !== undefined) { sets.push(`is_active = $${i++}`); vals.push(req.body.isActive !== false); }
    // NOTE: quantity is intentionally NOT editable here — it only changes via
    // /adjust so every change is ledgered. This keeps stock auditable.
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');

    const { rows: [item] } = await pool.query(
      `UPDATE restaurant_inventory_items SET ${sets.join(', ')}
        WHERE id = $${i++} AND restaurant_id = $${i}
        RETURNING *`,
      [...vals, itemId, restaurantId]
    );
    if (!item) throw new AppError('Item not found', 404, 'inventory_item_not_found');
    res.json({ item });
  } catch (err) {
    next(err);
  }
};

exports.deleteItem = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const itemId = parsePositiveInt(req.params.itemId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);
    const { rowCount } = await pool.query(
      `DELETE FROM restaurant_inventory_items WHERE id = $1 AND restaurant_id = $2`,
      [itemId, restaurantId]
    );
    if (!rowCount) throw new AppError('Item not found', 404, 'inventory_item_not_found');
    res.json({ ok: true });
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
    await requireRestaurantAccess(req.user.id, restaurantId); // any active member may record

    const type = ADJ_TYPES.includes(req.body.type) ? req.body.type : null;
    if (!type) throw new AppError('Validation failed', 400, 'validation_failed', { type: 'Unsupported adjustment type' });

    const result = await withTransaction(async (client) => {
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
        // receive is positive; waste/usage subtract; correction can be either.
        const signed = (type === 'waste' || type === 'usage') ? -Math.abs(d) : d;
        after = Math.max(0, Math.round((current + signed) * 1000) / 1000);
        delta = Math.round((after - current) * 1000) / 1000;
      }

      const { rows: [updated] } = await client.query(
        `UPDATE restaurant_inventory_items SET quantity = $1, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [after, itemId]
      );
      await client.query(
        `INSERT INTO restaurant_inventory_adjustments
           (restaurant_id, item_id, item_name, adjustment_type, quantity_delta, quantity_after, note, adjusted_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [restaurantId, itemId, item.name, type, delta, after, normalizeString(req.body.note, 1000), req.user.id]
      );
      return updated;
    });
    res.json({ item: { ...result, is_low: Number(result.quantity) <= Number(result.low_stock_threshold) && Number(result.low_stock_threshold) > 0 } });
  } catch (err) {
    next(err);
  }
};

exports.listAdjustments = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const itemId = parsePositiveInt(req.query.itemId);

    const params = [restaurantId];
    let where = 'restaurant_id = $1';
    if (itemId) { params.push(itemId); where += ` AND item_id = $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT * FROM restaurant_inventory_adjustments
        WHERE ${where}
        ORDER BY created_at DESC
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
    await requireRestaurantAccess(req.user.id, restaurantId);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT * FROM restaurant_inventory_purchase_requests
        WHERE restaurant_id = $1
        ORDER BY created_at DESC
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
    await requireRestaurantAccess(req.user.id, restaurantId);

    const itemName = normalizeString(req.body.itemName, 160);
    if (!itemName) throw new AppError('Validation failed', 400, 'validation_failed', { itemName: 'Item name is required' });
    const requestedQuantity = parseQty(req.body.requestedQuantity, 'requestedQuantity');
    if (requestedQuantity === null || requestedQuantity <= 0) {
      throw new AppError('Validation failed', 400, 'validation_failed', { requestedQuantity: 'Quantity must be greater than zero' });
    }

    const status = PURCHASE_STATUSES.includes(req.body.status) ? req.body.status : 'pending';
    const { rows: [request] } = await pool.query(
      `INSERT INTO restaurant_inventory_purchase_requests
         (restaurant_id, item_name, requested_quantity, unit, supplier_name, status, eta_window, note, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        restaurantId,
        itemName,
        requestedQuantity,
        normalizeString(req.body.unit, 24) || 'units',
        normalizeString(req.body.supplierName, 160),
        status,
        normalizeString(req.body.etaWindow, 80),
        normalizeString(req.body.note, 1000),
        req.user.id,
      ]
    );
    res.status(201).json({ request });
  } catch (err) {
    next(err);
  }
};

exports.updatePurchaseRequest = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const requestId = parsePositiveInt(req.params.requestId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

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
    if (!sets.length) throw new AppError('No updatable fields provided', 400, 'validation_failed', { body: 'No updatable fields provided' });
    sets.push('updated_at = NOW()');

    const { rows: [request] } = await pool.query(
      `UPDATE restaurant_inventory_purchase_requests SET ${sets.join(', ')}
        WHERE id = $${i++} AND restaurant_id = $${i}
        RETURNING *`,
      [...vals, requestId, restaurantId]
    );
    if (!request) throw new AppError('Purchase request not found', 404, 'purchase_request_not_found');
    res.json({ request });
  } catch (err) {
    next(err);
  }
};

// ── Supplier issues ─────────────────────────────────────────────────────────
exports.listSupplierIssues = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);

    const { rows } = await pool.query(
      `SELECT * FROM restaurant_inventory_supplier_issues
        WHERE restaurant_id = $1
        ORDER BY created_at DESC
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
    await requireRestaurantAccess(req.user.id, restaurantId);

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
    const { rows: [issueRow] } = await pool.query(
      `INSERT INTO restaurant_inventory_supplier_issues
         (restaurant_id, supplier_name, issue, status, related_purchase_request_id, reported_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [restaurantId, supplierName, issue, status, relatedPurchaseRequestId, req.user.id]
    );
    res.status(201).json({ issue: issueRow });
  } catch (err) {
    next(err);
  }
};

exports.updateSupplierIssue = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const issueId = parsePositiveInt(req.params.issueId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

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

    const { rows: [issueRow] } = await pool.query(
      `UPDATE restaurant_inventory_supplier_issues SET ${sets.join(', ')}
        WHERE id = $${i++} AND restaurant_id = $${i}
        RETURNING *`,
      [...vals, issueId, restaurantId]
    );
    if (!issueRow) throw new AppError('Supplier issue not found', 404, 'supplier_issue_not_found');
    res.json({ issue: issueRow });
  } catch (err) {
    next(err);
  }
};

// ── Ingredient to menu mappings ─────────────────────────────────────────────
exports.listMappings = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    await requireRestaurantAccess(req.user.id, restaurantId);
    const { rows } = await pool.query(
      `SELECT rim.id,
              rim.inventory_item_id,
              rii.name AS inventory_item_name,
              rim.menu_item_id,
              fmi.name AS menu_item_name,
              rim.usage_label
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

exports.bootstrapMappings = async (req, res, next) => {
  try {
    const restaurantId = parsePositiveInt(req.params.restaurantId);
    const restaurant = await requireRestaurantAccess(req.user.id, restaurantId);
    assertManage(restaurant);

    await withTransaction(async (client) => {
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
        ['burger buns', 'classic ox burger', '1 bun'],
        ['ground beef', 'classic ox burger', '0.33 lb'],
        ['cold brew', 'cold brew', '12 oz'],
      ];

      for (const [inventoryName, menuName, usageLabel] of seeds) {
        const inventoryItem = inventoryByName.get(inventoryName);
        const menuItem = menuByName.get(menuName);
        if (!inventoryItem || !menuItem) continue;
        await client.query(
          `INSERT INTO restaurant_inventory_item_mappings
             (restaurant_id, inventory_item_id, menu_item_id, usage_label, created_by)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (restaurant_id, inventory_item_id, menu_item_id) DO NOTHING`,
          [restaurantId, inventoryItem.id, menuItem.id, usageLabel, req.user.id]
        );
      }
    });

    return exports.listMappings(req, res, next);
  } catch (err) {
    next(err);
  }
};
