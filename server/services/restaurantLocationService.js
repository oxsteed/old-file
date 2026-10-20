'use strict';

// F-02 phase 1: one resolver for "which physical store does this record
// belong to". A restaurant (food_restaurants) can have several stores in
// restaurant_locations; orders, POS payments, shifts, printer jobs and
// inventory rows now carry location_id so per-store reporting, hours and
// (later) tax/menu scoping have a column to key on.
//
// Resolution order:
//   1. An explicitly requested location. It MUST belong to the
//      restaurant: a mismatch is a client error (400), never a silent
//      fallback, because quietly stamping another tenant's store (or a
//      sibling store the customer did not choose) corrupts per-store
//      books.
//   2. The acting device's location (server-derived from the paired
//      device / staff session, therefore trusted; still verified
//      defensively and ignored when it does not belong).
//   3. The restaurant's primary location, else its earliest location,
//      else null (a restaurant with no location rows yet).
//
// Queries run on the caller's transaction client when one is passed so a
// resolution failure fails the surrounding write instead of stamping a
// guessed location onto a financial record.

const pool = require('../db');
const { AppError } = require('../middleware/errorHandler');

function toLocationId(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

async function locationBelongsToRestaurant(db, locationId, restaurantId) {
  const { rows: [row] } = await db.query(
    `SELECT id FROM restaurant_locations WHERE id = $1 AND restaurant_id = $2`,
    [locationId, restaurantId]
  );
  return Boolean(row);
}

async function primaryLocationId(client, restaurantId) {
  const db = client || pool;
  const { rows: [row] } = await db.query(
    `SELECT id
       FROM restaurant_locations
      WHERE restaurant_id = $1
      ORDER BY is_primary DESC, id ASC
      LIMIT 1`,
    [restaurantId]
  );
  return row ? Number(row.id) : null;
}

async function resolveLocationId(client, {
  restaurantId,
  requestedLocationId = null,
  deviceLocationId = null,
} = {}) {
  const db = client || pool;
  const requested = toLocationId(requestedLocationId);
  if (requested !== null) {
    if (!(await locationBelongsToRestaurant(db, requested, restaurantId))) {
      throw new AppError('Validation failed', 400, 'validation_failed', {
        locationId: 'location_restaurant_mismatch',
      });
    }
    return requested;
  }
  const device = toLocationId(deviceLocationId);
  if (device !== null
    && (await locationBelongsToRestaurant(db, device, restaurantId))) {
    return device;
  }
  return primaryLocationId(db, restaurantId);
}

// Full location row for the resolved store (hours/timezone evaluation),
// or null when the restaurant has no locations. Falls back through the
// same chain as resolveLocationId so the evaluated store is always the
// store the order is stamped with.
async function resolveLocationRow(client, {
  restaurantId,
  requestedLocationId = null,
  deviceLocationId = null,
} = {}) {
  const db = client || pool;
  const locationId = await resolveLocationId(db, {
    restaurantId,
    requestedLocationId,
    deviceLocationId,
  });
  if (locationId === null) return null;
  const { rows: [row] } = await db.query(
    `SELECT * FROM restaurant_locations WHERE id = $1 AND restaurant_id = $2`,
    [locationId, restaurantId]
  );
  return row || null;
}

// The location a paired restaurant device is pinned to, or null. Devices
// live in restaurant_app_devices and carry their own location_id.
async function deviceLocationId(client, { restaurantId, deviceId } = {}) {
  const db = client || pool;
  const id = toLocationId(deviceId);
  if (id === null) return null;
  const { rows: [row] } = await db.query(
    `SELECT location_id FROM restaurant_app_devices WHERE id = $1 AND restaurant_id = $2`,
    [id, restaurantId]
  );
  return row ? toLocationId(row.location_id) : null;
}

module.exports = {
  resolveLocationId,
  resolveLocationRow,
  primaryLocationId,
  deviceLocationId,
};
