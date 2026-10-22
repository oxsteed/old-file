'use strict';

const AppError = require('../utils/appError');
const {
  getLocationScope
} = require('./restaurantLocationAccessService');
async function attachScope(restaurant, userId) {
  return {
    ...restaurant,
    locationScope: await getLocationScope(restaurant, userId)
  };
}
function requireBrand(restaurant) {
  if (restaurant.locationScope?.mode === 'assigned') throw new AppError('All-store access is required for this operation', 403, 'location_scope_forbidden');
}
function assertStore(restaurant, locationId) {
  if (restaurant.locationScope?.mode === 'assigned' && !restaurant.locationScope.location_ids.includes(Number(locationId))) throw new AppError('Store access denied', 403, 'location_scope_forbidden');
}
function staffPredicate(restaurant, userColumn, params) {
  if (restaurant.locationScope?.mode !== 'assigned') return '';
  params.push(restaurant.id, restaurant.business_id, restaurant.locationScope.location_ids);
  return ` AND EXISTS (SELECT 1 FROM restaurant_location_memberships scope_lm
    JOIN business_members scope_bm ON scope_bm.id=scope_lm.membership_id
    WHERE scope_lm.restaurant_id=$${params.length - 2} AND scope_bm.business_id=$${params.length - 1}
      AND scope_bm.member_id=${userColumn} AND scope_bm.status='active' AND scope_lm.status='active'
      AND scope_lm.location_id=ANY($${params.length}::bigint[]))`;
}
async function assertStaff(restaurant, userId, db) {
  const params = [restaurant.business_id, userId];
  const filter = staffPredicate(restaurant, 'bm.member_id', params);
  const {
    rows
  } = await db.query(`SELECT 1 FROM business_members bm
    WHERE bm.business_id=$1 AND bm.member_id=$2 AND bm.status='active'${filter}
    ${restaurant.locationScope?.mode === 'assigned' ? '' : 'UNION SELECT 1 FROM businesses WHERE id=$1 AND user_id=$2'}`, params);
  if (!rows.length) throw new AppError('Staff member not found in the permitted stores', 404, 'staff_not_found');
}
async function resolveStore(restaurant, requested, db) {
  const v = require('../utils/restaurantReviewValidation');
  let id = requested == null ? null : v.integer(requested, 'locationId');
  if (id == null && restaurant.locationScope.mode === 'assigned') {
    if (restaurant.locationScope.location_ids.length !== 1) v.invalid('locationId');
    id = restaurant.locationScope.location_ids[0];
  }
  if (id != null) assertStore(restaurant, id);
  const {
    rows: [location]
  } = await db.query(`SELECT id FROM restaurant_locations WHERE restaurant_id=$1 AND status <> 'archived'
    AND (($2::bigint IS NULL AND is_primary=TRUE) OR id=$2) ORDER BY id LIMIT 1`, [restaurant.id, id]);
  if (!location) throw new AppError('Location not found', 404, 'location_not_found');
  return location.id;
}
module.exports = {
  resolveStore,
  attachScope,
  requireBrand,
  assertStore,
  staffPredicate,
  assertStaff
};
