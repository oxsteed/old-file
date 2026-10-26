'use strict';
const pool = require('../db');
const { strictInteger } = require('../utils/strictInteger');
const AppError = require('../utils/appError');
const { resolveRestaurantAccess } = require('./scopeModel');
const { assertLocationAccess } = require('./restaurantLocationAccessService');

async function payrollLocation(businessId, userId, requested) {
  if (requested == null) {
    if (!userId) return null;
    // N-08: use the member's store scope across every restaurant the
    // business owns (deterministic, ordered by id), not an arbitrary one.
    const ctx = await require('./restaurantWorkforceScope').context({
      params: { businessId },
      user: { id: userId },
    });
    if (!ctx || ctx.scope.mode !== 'assigned') return null;
    if (ctx.scope.location_ids.length !== 1)
      throw new AppError(
        'Select an authorized store',
        400,
        'location_required',
      );
    return ctx.scope.location_ids[0];
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
