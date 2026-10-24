'use strict';
const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');
const { getLocationScope } = require('./restaurantLocationAccessService');

// An unassigned historical row is not an assigned store. Never expose it to
// store-restricted staff merely because its store could not be backfilled.
function assertScopedLocation(scope, locationId) {
  if (
    scope?.mode === 'assigned' &&
    !scope.location_ids.includes(Number(locationId))
  ) {
    throw new AppError('Store access denied', 403, 'location_scope_forbidden');
  }
}
const SCOPED_RESOURCES = new Set([
  'food_orders',
  'restaurant_app_devices',
  'restaurant_devices',
  'restaurant_pos_shifts',
  'restaurant_printer_jobs',
  'restaurant_staff_pins',
]);
async function assertScopedResource(restaurant, userId, table, id, db = pool) {
  if (!SCOPED_RESOURCES.has(table))
    throw new Error('Unsupported store resource');
  const scope =
    restaurant.locationScope ||
    (await getLocationScope(restaurant, userId, db));
  if (scope.mode !== 'assigned') return scope;
  const {
    rows: [row],
  } = await db.query(
    `SELECT location_id FROM ${table} WHERE restaurant_id=$1 AND id=$2`,
    [restaurant.id, id],
  );
  if (!row) throw new AppError('Resource not found', 404, 'resource_not_found');
  assertScopedLocation(scope, row.location_id);
  return scope;
}
module.exports = { assertScopedLocation, assertScopedResource };
