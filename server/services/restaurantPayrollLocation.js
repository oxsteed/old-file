'use strict';
const pool = require('../db');
const { strictInteger } = require('../utils/strictInteger');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('./scopeModel');
const {
  assertLocationAccess,
  getLocationScope,
} = require('./restaurantLocationAccessService');

async function payrollLocation(businessId, userId, requested) {
  if (requested == null) {
    if (!userId) return null;
    const {
      rows: [row],
    } = await pool.query(
      'SELECT id AS restaurant_id FROM food_restaurants WHERE business_id=$1',
      [businessId],
    );
    if (!row?.restaurant_id) return null;
    const restaurant = await resolveRestaurantAccess(userId, row.restaurant_id);
    const scope = await getLocationScope(restaurant, userId);
    if (scope.mode !== 'assigned') return null;
    if (scope.location_ids.length !== 1)
      throw new AppError(
        'Select an authorized store',
        400,
        'location_required',
      );
    return scope.location_ids[0];
  }
  const locationId = strictInteger(requested);
  if (!locationId)
    throw new AppError('A valid store is required', 400, 'invalid_location_id');
  const {
    rows: [location],
  } = await pool.query(
    `SELECT l.restaurant_id FROM restaurant_locations l
    JOIN food_restaurants r ON r.id=l.restaurant_id
    WHERE l.id=$1 AND r.business_id=$2 AND l.status <> 'archived'`,
    [locationId, businessId],
  );
  if (!location)
    throw new AppError('Location not found', 404, 'location_not_found');
  const restaurant = await resolveRestaurantAccess(
    userId,
    location.restaurant_id,
  );
  await assertLocationAccess(restaurant, userId, locationId);
  return locationId;
}
module.exports = { payrollLocation };
