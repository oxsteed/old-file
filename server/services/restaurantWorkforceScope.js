'use strict';

const pool = require('../db');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('./scopeModel');
const { getLocationScope } = require('./restaurantLocationAccessService');
const { assertScopedLocation } = require('./restaurantStoreBoundary');

// Other business types retain their existing workforce behavior. Restaurant
// workforce routes share the restaurant's current, server-owned store grants.
async function context(req) {
  if (
    req.businessRole === 'owner' ||
    (req.business?.owner_id && req.business.owner_id === req.user?.id)
  )
    return null;
  if (!req.user?.id) return null;
  if (req.restaurantWorkforceScope) return req.restaurantWorkforceScope;
  const businessId = req.params.businessId || req.params.id || req.business?.id;
  // N-08: a business can own several restaurants. Resolve the member's
  // stores across all of them (ordered by id) instead of whichever row the
  // planner returned first. Location ids are global, so the union is exact.
  const { rows: restaurants } = await pool.query(
    'SELECT id AS restaurant_id FROM food_restaurants WHERE business_id=$1 ORDER BY id ASC',
    [businessId],
  );
  if (!restaurants.length) return null;
  const accessible = [];
  let firstError = null;
  for (const { restaurant_id: restaurantId } of restaurants) {
    try {
      const restaurant = await resolveRestaurantAccess(req.user.id, restaurantId);
      const scope = await getLocationScope(restaurant, req.user.id);
      accessible.push({ restaurant, scope });
    } catch (error) {
      if (restaurants.length === 1) throw error;
      firstError = firstError || error;
    }
  }
  if (!accessible.length) throw firstError;
  const ctx = combineScopes(accessible, restaurants.length, businessId, req.user.id);
  for (const restaurantId of ctx.pendingAll || []) {
    ctx.scope.location_ids = [...new Set([...ctx.scope.location_ids, ...(await allLocationIds(restaurantId))])];
  }
  delete ctx.pendingAll;
  req.restaurantWorkforceScope = ctx;
  return ctx;
}

// Full ("all") access to every restaurant keeps mode 'all'. Otherwise the
// member is limited to the union of assigned stores plus every store of the
// restaurants where they hold all-store access.
async function allLocationIds(restaurantId, db = pool) {
  const { rows } = await db.query(
    'SELECT id FROM restaurant_locations WHERE restaurant_id=$1 ORDER BY id ASC',
    [restaurantId],
  );
  return rows.map((r) => Number(r.id));
}
function combineScopes(accessible, totalRestaurants, businessId, userId) {
  const primary = accessible[0];
  const everyAll = accessible.length === totalRestaurants && accessible.every((a) => a.scope.mode !== 'assigned');
  if (accessible.length === 1 && totalRestaurants === 1) {
    return { restaurant: primary.restaurant, scope: primary.scope, businessId, userId, restaurantIds: [primary.restaurant.id] };
  }
  if (everyAll) {
    return { restaurant: primary.restaurant, scope: primary.scope, businessId, userId, restaurantIds: accessible.map((a) => a.restaurant.id) };
  }
  return {
    restaurant: primary.restaurant,
    businessId,
    userId,
    restaurantIds: accessible.map((a) => a.restaurant.id),
    pendingAll: accessible.filter((a) => a.scope.mode !== 'assigned').map((a) => a.restaurant.id),
    scope: {
      mode: 'assigned',
      location_ids: [...new Set(accessible.flatMap((a) => (a.scope.mode === 'assigned' ? a.scope.location_ids : [])).map(Number))],
      assignments: accessible.flatMap((a) => a.scope.assignments || []),
    },
  };
}
function clause(ctx, alias, params) {
  if (ctx?.scope.mode !== 'assigned') return '';
  params.push(ctx.scope.location_ids);
  return ` AND ${alias ? alias + '.' : ''}location_id=ANY($${params.length}::bigint[])`;
}
function staffClause(ctx, userColumn, params) {
  if (ctx?.scope.mode !== 'assigned') return '';
  params.push(ctx.restaurantIds || [ctx.restaurant.id], ctx.scope.location_ids);
  return ` AND EXISTS (SELECT 1 FROM restaurant_location_memberships workforce_lm
    JOIN business_members workforce_bm ON workforce_bm.id=workforce_lm.membership_id
    WHERE workforce_lm.restaurant_id=ANY($${params.length - 1}::bigint[]) AND workforce_bm.member_id=${userColumn}
      AND workforce_bm.status='active' AND workforce_lm.status='active'
      AND workforce_lm.location_id=ANY($${params.length}::bigint[]))`;
}
const TABLES = new Set(['business_staff_shifts', 'business_time_entries']);
async function assertRecord(ctx, table, id, db = pool) {
  if (ctx?.scope.mode !== 'assigned') return null;
  if (!TABLES.has(table)) throw new Error('Unsupported workforce resource');
  const {
    rows: [row],
  } = await db.query(
    `SELECT location_id,user_id FROM ${table} WHERE id=$1 AND business_id=$2`,
    [id, ctx.businessId],
  );
  if (!row)
    throw new AppError(
      'Workforce record not found',
      404,
      'workforce_record_not_found',
    );
  assertScopedLocation(ctx.scope, row.location_id);
  return row;
}
async function assertStaff(ctx, userId, db = pool, locationId = null) {
  if (ctx?.scope.mode !== 'assigned' || !userId) return;
  if (locationId != null) {
    assertScopedLocation(ctx.scope, locationId);
    ctx = {
      ...ctx,
      scope: { ...ctx.scope, location_ids: [Number(locationId)] },
    };
  }
  const params = [ctx.businessId, userId];
  const filter = staffClause(ctx, 'bm.member_id', params);
  const { rows } = await db.query(
    `SELECT 1 FROM business_members bm WHERE bm.business_id=$1 AND bm.member_id=$2 AND bm.status='active'${filter}`,
    params,
  );
  if (!rows.length)
    throw new AppError(
      'Staff member is outside the permitted stores',
      403,
      'location_scope_forbidden',
    );
}
module.exports = { context, clause, staffClause, assertRecord, assertStaff, combineScopes };
