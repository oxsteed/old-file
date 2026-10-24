'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { resolveRestaurantAccess } = require('../services/scopeModel');
const permissions = require('../services/permissionsService');
const { attachScope, requireBrand } = require('../services/restaurantReviewScope');
const { withTransaction } = require('../utils/transaction');
const { logBusinessAction } = require('../services/businessAuditLog');
const { normalizeLocationIds, normalizeId } = require('../services/restaurantLocationAccessService');

async function loadRestaurant(userId, restaurantId) {
  const id = normalizeId(restaurantId);
  if (!id) throw new AppError('Restaurant not found', 404, 'restaurant_not_found');
  const restaurant = await attachScope(await resolveRestaurantAccess(userId, id), userId);
  requireBrand(restaurant);
  return restaurant;
}

async function requirePermission(restaurant, userId, code) {
  if (!await permissions.hasRestaurantPermission(restaurant, userId, [code])) {
    throw new AppError('Permission denied', 403, 'forbidden');
  }
}

exports.list = async (req, res, next) => {
  try {
    const restaurant = await loadRestaurant(req.user.id, req.params.restaurantId);
    await requirePermission(restaurant, req.user.id, 'settings.view');
    const [{ rows: locations }, { rows: members }, { rows: assignments }] = await Promise.all([
      pool.query(
        `SELECT l.id, l.name, l.status, l.is_primary, l.timezone,
                l.region_id, rr.name AS region_name
           FROM restaurant_locations l
           LEFT JOIN restaurant_regions rr
             ON rr.restaurant_id = l.restaurant_id AND rr.id = l.region_id
          WHERE l.restaurant_id = $1
          ORDER BY l.is_primary DESC, l.name ASC, l.id ASC`,
        [restaurant.id]
      ),
      pool.query(
        `SELECT bm.id AS membership_id, bm.member_id, bm.role, bm.status,
                u.email, u.first_name, u.last_name
           FROM business_members bm
           LEFT JOIN users u ON u.id = bm.member_id
          WHERE bm.business_id = $1 AND bm.status = 'active'
            AND bm.member_id IS NOT NULL
          ORDER BY u.last_name NULLS LAST, u.first_name NULLS LAST, u.email ASC`,
        [restaurant.business_id]
      ),
      pool.query(
        `SELECT lm.id, lm.membership_id, lm.location_id, lm.role_override,
                lm.status
           FROM restaurant_location_memberships lm
           JOIN business_members bm ON bm.id = lm.membership_id
          WHERE lm.restaurant_id = $1 AND bm.business_id = $2
          ORDER BY lm.membership_id ASC, lm.location_id ASC`,
        [restaurant.id, restaurant.business_id]
      ),
    ]);
    res.json({ locations, members, assignments });
  } catch (error) {
    next(error);
  }
};

exports.replace = async (req, res, next) => {
  try {
    const restaurant = await loadRestaurant(req.user.id, req.params.restaurantId);
    await requirePermission(restaurant, req.user.id, 'settings.manage');
    const membershipId = normalizeId(req.params.membershipId);
    if (!membershipId) throw new AppError('A valid membership is required', 400, 'invalid_membership_id');
    const locationIds = normalizeLocationIds(req.body?.locationIds ?? req.body?.location_ids);
    if (!locationIds || locationIds.length === 0) {
      throw new AppError('At least one store is required; use scope=all to clear the boundary', 400, 'validation_failed');
    }
    const roleOverride = req.body?.roleOverride ?? req.body?.role_override ?? null;
    if (roleOverride !== null && !['manager', 'representative', 'employee', 'support_agent'].includes(String(roleOverride))) {
      throw new AppError('Unsupported store role', 400, 'validation_failed');
    }
    const result = await withTransaction(pool, async (client) => {
      const { rows: [member] } = await client.query(
        `SELECT id, member_id, role, status
           FROM business_members
          WHERE id = $1 AND business_id = $2 AND status = 'active'
          LIMIT 1`,
        [membershipId, restaurant.business_id]
      );
      if (!member || !member.member_id) throw new AppError('Staff member not found', 404, 'staff_not_found');
      const { rows: validLocations } = await client.query(
        `SELECT id FROM restaurant_locations
          WHERE restaurant_id = $1 AND id = ANY($2::bigint[])`,
        [restaurant.id, locationIds]
      );
      if (validLocations.length !== locationIds.length) {
        throw new AppError('Every store must belong to this restaurant', 400, 'invalid_location_id');
      }
      const { rows: [before] } = await client.query(
        `SELECT jsonb_agg(jsonb_build_object('location_id', location_id, 'role_override', role_override)
                         ORDER BY location_id) AS assignments
           FROM restaurant_location_memberships
          WHERE restaurant_id = $1 AND membership_id = $2 AND status = 'active'`,
        [restaurant.id, membershipId]
      );
      await client.query(
        `UPDATE restaurant_location_memberships
            SET status = 'revoked', updated_at = NOW()
          WHERE restaurant_id = $1 AND membership_id = $2 AND status = 'active'`,
        [restaurant.id, membershipId]
      );
      for (const locationId of locationIds) {
        await client.query(
          `INSERT INTO restaurant_location_memberships
             (restaurant_id, location_id, membership_id, role_override, status, created_by)
           VALUES ($1, $2, $3, $4, 'active', $5)`,
          [restaurant.id, locationId, membershipId, roleOverride, req.user.id]
        );
      }
      const { rows: assignments } = await client.query(
        `SELECT id, membership_id, location_id, role_override, status
           FROM restaurant_location_memberships
          WHERE restaurant_id = $1 AND membership_id = $2 AND status = 'active'
          ORDER BY location_id ASC`,
        [restaurant.id, membershipId]
      );
      await logBusinessAction(req, {
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.location_memberships.replaced',
        target_type: 'business_membership',
        target_id: membershipId,
        before_state: before || { assignments: [] },
        after_state: { assignments },
        metadata: { restaurant_id: restaurant.id, location_ids: locationIds },
        client,
        throwOnError: true,
      });
      return { member, assignments };
    }, 'restaurant_location_memberships_replace');
    res.json(result);
  } catch (error) {
    next(error);
  }
};

exports.clear = async (req, res, next) => {
  try {
    const restaurant = await loadRestaurant(req.user.id, req.params.restaurantId);
    await requirePermission(restaurant, req.user.id, 'settings.manage');
    const membershipId = normalizeId(req.params.membershipId);
    if (!membershipId) throw new AppError('A valid membership is required', 400, 'invalid_membership_id');
    const rows = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE restaurant_location_memberships lm
          SET status = 'revoked', updated_at = NOW()
        FROM business_members bm
       WHERE lm.restaurant_id = $1 AND lm.membership_id = $2
         AND lm.membership_id = bm.id AND bm.business_id = $3
         AND lm.status = 'active'
       RETURNING lm.id`,
        [restaurant.id, membershipId, restaurant.business_id]
      );
      await logBusinessAction(req, {
        client,
        business_id: restaurant.business_id,
        actor_role: restaurant.effective_role,
        action: 'restaurant.location_memberships.cleared',
        target_type: 'business_membership',
        target_id: membershipId,
        after_state: { scope: 'all' },
        throwOnError: true,
      });
      return rows;
    }, 'restaurant_location_memberships_clear');
    res.json({ cleared: rows.length, scope: 'all' });
  } catch (error) {
    next(error);
  }
};

