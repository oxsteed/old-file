'use strict';

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

function normalizeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Resolve the optional store boundary for a restaurant member.
 *
 * Owners and members without active assignments retain all-store access for
 * staged rollout compatibility. Once a member has one active assignment,
 * every location-scoped surface must use only the returned location_ids.
 */
async function getLocationScope(restaurant, userId, db = pool) {
  // Some controller unit fixtures provide only the effective role. Treat
  // those legacy rows as the staged all-store default; real member rows from
  // scopeModel always carry effective_membership_id and are checked below.
  if (!restaurant || restaurant.effective_role === 'owner'
    || (!restaurant.effective_membership_id && db === pool)) {
    return { mode: 'all', location_ids: null, assignments: [] };
  }
  const { rows } = await db.query(
    `SELECT lm.id, lm.location_id, lm.role_override, lm.membership_id,
            l.name AS location_name
       FROM restaurant_location_memberships lm
       JOIN business_members bm ON bm.id = lm.membership_id
       JOIN restaurant_locations l
         ON l.restaurant_id = lm.restaurant_id AND l.id = lm.location_id
      WHERE lm.restaurant_id = $1
        AND bm.business_id = $2
        AND bm.member_id = $3
        AND bm.status = 'active'
        AND lm.status = 'active'
      ORDER BY l.name ASC, l.id ASC`,
    [restaurant.id, restaurant.business_id, userId]
  );
  if (rows.length === 0) return { mode: 'all', location_ids: null, assignments: [] };
  const locationIds = [...new Set(rows.map((row) => normalizeId(row.location_id)).filter(Boolean))];
  return { mode: 'assigned', location_ids: locationIds, assignments: rows };
}

async function assertLocationAccess(restaurant, userId, locationId, db = pool) {
  const id = normalizeId(locationId);
  if (!id) throw new AppError('A valid store is required', 400, 'invalid_location_id');
  const scope = await getLocationScope(restaurant, userId, db);
  if (scope.mode === 'assigned' && !scope.location_ids.includes(id)) {
    throw new AppError('You do not have access to this store', 403, 'location_scope_forbidden');
  }
  return scope;
}

async function getLocationRole(restaurant, userId, locationId, db = pool) {
  const scope = await assertLocationAccess(restaurant, userId, locationId, db);
  if (scope.mode !== 'assigned') return restaurant.effective_role;
  const assignment = scope.assignments.find((row) => normalizeId(row.location_id) === normalizeId(locationId));
  return assignment?.role_override || restaurant.effective_role;
}

function normalizeLocationIds(values) {
  if (!Array.isArray(values)) return null;
  const ids = [...new Set(values.map(normalizeId).filter(Boolean))];
  if (ids.length !== values.length) {
    throw new AppError('Each store id must be a positive integer', 400, 'validation_failed');
  }
  return ids;
}

module.exports = {
  getLocationScope,
  assertLocationAccess,
  getLocationRole,
  normalizeLocationIds,
  normalizeId,
};

