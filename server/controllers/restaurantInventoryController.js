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
