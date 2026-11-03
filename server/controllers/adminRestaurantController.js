'use strict';

// Track D (findings 20, 53): admin restaurant management for the
// food_restaurants entity, which previously had no list, detail, verify, or
// suspend surface, plus an admin reader over business_audit_log (the trail
// pay-run actions, wallet operator actions, and restaurant status changes
// already write to via logBusinessAction).
//
// Suspension reuses the tombstone semantics: status to 'suspended' and both
// ordering flags off, never a delete, so ledger rows that reference the
// restaurant stay intact. Restore deliberately lands on 'paused', not
// 'active': a suspended restaurant never silently re-lists; the owner must
// explicitly re-activate it.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { logAdminAction } = require('../services/auditService');
const { logBusinessAction } = require('../services/businessAuditLog');
const { suspendRestaurantsForBusiness } = require('../services/restaurantTombstoneService');
const { listBusinessAudit } = require('../services/businessAuditLog');
const { parseBoundedPagination } = require('../utils/pagination');

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadRestaurant(client, id) {
  const { rows } = await client.query(
    `SELECT fr.*, b.business_name, b.user_id AS business_owner_id, b.is_active AS business_is_active
       FROM food_restaurants fr
       JOIN businesses b ON b.id = fr.business_id
      WHERE fr.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function auditRestaurantStatus(req, restaurant, action, before, after) {
  await logAdminAction({
    adminId: req.user.id,
    action,
    targetType: 'food_restaurant',
    targetKey: `restaurant:${restaurant.id}`,
    targetBigint: String(restaurant.id),
    description: `${action} for restaurant ${restaurant.display_name || restaurant.id}`,
    before,
    after,
    req,
    throwOnError: true,
  });
  await logBusinessAction(req, {
    business_id: restaurant.business_id,
    actor_role: 'admin',
    action: `restaurant.${action.replace('restaurant_', '')}`,
    target_type: 'food_restaurant',
    target_id: restaurant.id,
    before_state: before,
    after_state: after,
    metadata: { adminId: req.user.id },
    throwOnError: true,
  });
}

exports.listRestaurants = async (req, res, next) => {
  try {
    const { limit, offset } = parseBoundedPagination(req.query, { defaultLimit: 25, maxLimit: 100 });
    const params = [];
    const conds = [];
    const search = String(req.query.search || '').trim();
    if (search) {
      params.push(`%${search}%`);
      conds.push(`(fr.display_name ILIKE $${params.length} OR b.business_name ILIKE $${params.length})`);
    }
    const status = String(req.query.status || '').trim();
    if (status) {
      params.push(status);
      conds.push(`fr.status = $${params.length}`);
    }
    const businessId = parseId(req.query.businessId || req.query.business_id);
    if (businessId) {
      params.push(businessId);
      conds.push(`fr.business_id = $${params.length}`);
    }
    if (req.query.verified === 'true' || req.query.verified === 'false') {
      params.push(req.query.verified === 'true');
      conds.push(`fr.is_verified = $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const [{ rows: countRows }, { rows }] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM food_restaurants fr JOIN businesses b ON b.id = fr.business_id ${where}`,
        params
      ),
      pool.query(
        `SELECT fr.id, fr.display_name, fr.status, fr.is_verified, fr.accepts_online_orders,
                fr.address_city, fr.address_state, fr.currency_code, fr.business_id,
                b.business_name, fr.created_at, fr.updated_at,
                (SELECT COUNT(*)::int FROM restaurant_support_cases rsc
                  WHERE rsc.restaurant_id = fr.id AND rsc.archived_at IS NULL
                    AND rsc.status NOT IN ('resolved', 'closed', 'canceled')) AS open_support_cases
           FROM food_restaurants fr
           JOIN businesses b ON b.id = fr.business_id
          ${where}
          ORDER BY fr.created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
    ]);
    res.json({ restaurants: rows, total: countRows[0]?.total || 0, limit, offset });
  } catch (err) {
    next(err);
  }
};

exports.getRestaurant = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const restaurant = id ? await loadRestaurant(pool, id) : null;
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const [{ rows: supportRows }, { rows: walletRows }] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed', 'canceled'))::int AS open_cases
           FROM restaurant_support_cases WHERE restaurant_id = $1 AND archived_at IS NULL`,
        [id]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS wallets, COALESCE(SUM(balance_cents), 0)::bigint AS total_balance_cents
           FROM food_customer_wallet_accounts WHERE restaurant_id = $1`,
        [id]
      ),
    ]);
    res.json({
      restaurant,
      support: supportRows[0] || { total: 0, open_cases: 0 },
      wallets: walletRows[0] || { wallets: 0, total_balance_cents: 0 },
    });
  } catch (err) {
    next(err);
  }
};

async function setRestaurantStatus(req, res, next, { from, to, action, acceptsOnline }) {
  try {
    const id = parseId(req.params.id);
    const restaurant = id ? await loadRestaurant(pool, id) : null;
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    if (!from.includes(restaurant.status)) {
      throw new AppError(`Restaurant status is '${restaurant.status}', expected one of: ${from.join(', ')}`, 409, 'restaurant_status_conflict', { status: restaurant.status });
    }
    const { rows: [updated] } = await pool.query(
      `UPDATE food_restaurants
          SET status = $2,
              accepts_online_orders = $3,
              accepts_in_store_orders = $3,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [id, to, acceptsOnline]
    );
    await auditRestaurantStatus(req, restaurant, action,
      { status: restaurant.status, accepts_online_orders: restaurant.accepts_online_orders },
      { status: to, accepts_online_orders: acceptsOnline });
    res.json({ restaurant: updated });
  } catch (err) {
    next(err);
  }
}

exports.suspendRestaurant = (req, res, next) => setRestaurantStatus(req, res, next, {
  from: ['active', 'paused'],
  to: 'suspended',
  action: 'restaurant_suspended',
  acceptsOnline: false,
});

exports.restoreRestaurant = (req, res, next) => setRestaurantStatus(req, res, next, {
  from: ['suspended'],
  to: 'paused',
  action: 'restaurant_restored',
  acceptsOnline: false,
});

exports.verifyRestaurant = async (req, res, next) => {
  try {
    const id = parseId(req.params.id);
    const restaurant = id ? await loadRestaurant(pool, id) : null;
    if (!restaurant) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
    const verified = req.body?.verified !== false && req.body?.verified !== 'false';
    const { rows: [updated] } = await pool.query(
      'UPDATE food_restaurants SET is_verified = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id, verified]
    );
    await auditRestaurantStatus(req, restaurant, verified ? 'restaurant_verified' : 'restaurant_unverified',
      { is_verified: restaurant.is_verified }, { is_verified: verified });
    res.json({ restaurant: updated });
  } catch (err) {
    next(err);
  }
};

// Finding 53: admin reader over business_audit_log. Accepts a business id
// directly, or a restaurant id resolved to its business. No mirroring into
// admin_audit_log: the business log is the history, this page reads it.
exports.listBusinessAudit = async (req, res, next) => {
  try {
    let businessId = parseId(req.query.businessId || req.query.business_id);
    const restaurantId = parseId(req.query.restaurantId || req.query.restaurant_id);
    if (!businessId && restaurantId) {
      const { rows } = await pool.query('SELECT business_id FROM food_restaurants WHERE id = $1', [restaurantId]);
      businessId = rows[0]?.business_id || null;
    }
    if (!businessId) {
      throw new AppError('businessId or restaurantId is required', 400, 'validation_failed', { businessId: 'businessId or restaurantId is required' });
    }
    const { limit, offset } = parseBoundedPagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const { rows, total } = await listBusinessAudit(businessId, {
      limit,
      offset,
      action: req.query.action || undefined,
      actionPrefix: req.query.actionPrefix || req.query.action_prefix || undefined,
      actorUserId: req.query.actorUserId || req.query.actor_user_id || undefined,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    });
    res.json({ rows, total, limit, offset, businessId });
  } catch (err) {
    next(err);
  }
};

// Finding 20, toggle half: deactivating a business must suspend its
// restaurants, the same way deleting it already does. Exported for the
// business moderation controller so the rule lives in one place.
exports.suspendRestaurantsForBusiness = suspendRestaurantsForBusiness;
