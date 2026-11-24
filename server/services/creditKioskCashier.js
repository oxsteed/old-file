'use strict';

// Group 13 Slice 4g: the cashier surface on the OxSteed Credit kiosk.
// Read-only views over the existing kiosk redemption records, plus the
// device-bound cashier shift (682) and its closeout (685). No money moves
// here: every money path keeps its existing fail-closed gates (rail flags,
// checkRestrictions('checkout'), the kiosk per-device limiter).
//
// Scope rule (D-382..D-385, with D-386..D-389 per item): the device record
// is the authority. A kiosk device sees only its own authorized scope —
// its paired location — and a client-sent location outside that scope is
// refused server-side.

const { AppError } = require('../middleware/errorHandler');

function formatLocation(row, isPaired) {
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    isPrimary: Boolean(row.is_primary),
    isPaired: Boolean(isPaired),
  };
}

// Authorized locations for a device (681, D-383): the paired location
// alone. Every device is location-bound: pairing stores a location_id, and
// the operational-identity trigger (migration 989) backfills a missing one
// with the restaurant's primary location, so a bound device is the only
// case that occurs in practice. A device with no binding at all authorizes
// nothing — default scope is empty, never "every location" — so the
// fallback below is fail-closed by construction.
async function getAuthorizedLocations(client, device) {
  const restaurantId = Number(device.restaurant_id);
  if (!device.location_id) return [];
  const { rows } = await client.query(
    `SELECT id, name, status, is_primary FROM restaurant_locations
      WHERE restaurant_id = $1 AND id = $2`,
    [restaurantId, Number(device.location_id)],
  );
  if (!rows[0]) throw new AppError('Paired location not found', 404, 'location_not_found');
  return [formatLocation(rows[0], true)];
}

// Refuses a client-sent location outside the device's authorized scope
// (681, D-383). The device record — never the request — decides scope.
async function assertAuthorizedLocation(client, device, locationId) {
  const parsed = Number.parseInt(String(locationId), 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError('Invalid location', 400, 'invalid_locationId');
  }
  const locations = await getAuthorizedLocations(client, device);
  const found = locations.find((location) => location.id === parsed);
  if (!found) {
    throw new AppError("Location is outside this device's authorized scope", 403, 'location_scope_forbidden');
  }
  return found;
}

// The picker's default (681): the paired location when the device is bound,
// else null — there is no location to default to when nothing is authorized.
function defaultLocationId(device, locations) {
  if (device.location_id) return Number(device.location_id);
  return locations[0] ? locations[0].id : null;
}

module.exports = { getAuthorizedLocations, assertAuthorizedLocation, defaultLocationId };
