'use strict';

// Per-restaurant, per-business-day queue number allocation (F-18/F-32).
//
// Replaces the MAX(queue_number) + 1 computation that order creation used
// to run over food_orders. That computation was only safe while the caller
// held the food_restaurants row FOR UPDATE, which serialized every order
// for a restaurant behind whatever else the transaction was doing (Stripe
// and routing network calls included). Allocation here is one atomic
// upsert on a counter row from migration 945: concurrent transactions
// serialize on the counter row alone for the duration of a single
// statement, never on the restaurant row.
//
// The business date is the calendar date in the restaurant's own time
// zone, which is the same day boundary the old MAX computation used
// ((created_at AT TIME ZONE tz)::date = (now() AT TIME ZONE tz)::date).
//
// F-02 phase 1 / migration 952: counters are per store when the order
// carries a location. The location-scoped upsert keys on
// (restaurant_id, location_id, business_date) and, the first time a
// store-day counter is created, seeds from the highest queue number
// already issued to that store for the date, so a store whose tickets
// were stamped before per-store counters existed (paired-device orders)
// continues its sequence instead of restarting at 1. When no location
// is given the original restaurant-wide counter is used with the same
// statement semantics as before 952 (now against the NULL-scope partial
// unique index).

function effectiveTimezone(timezone) {
  const candidate = timezone || 'UTC';
  try {
    // Throws on a non-IANA zone string (possible on rows written before
    // timezone validation existed); fall back to UTC, matching the
    // safe-read fallback the operating-hours logic uses.
    Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch (err) {
    return 'UTC';
  }
}

function businessDateFor(timezone, now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: effectiveTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

async function nextQueueNumber(client, restaurantId, timezone, now = new Date(), locationId = null) {
  const businessDate = businessDateFor(timezone, now);
  const scopedLocationId = Number(locationId);
  if (!Number.isSafeInteger(scopedLocationId) || scopedLocationId <= 0) {
    const { rows } = await client.query(
      `INSERT INTO restaurant_daily_counters (restaurant_id, business_date, last_queue_number)
       VALUES ($1, $2, 1)
       ON CONFLICT (restaurant_id, business_date) WHERE location_id IS NULL
       DO UPDATE SET last_queue_number = restaurant_daily_counters.last_queue_number + 1
       RETURNING last_queue_number`,
      [restaurantId, businessDate]
    );
    return Number(rows[0].last_queue_number);
  }
  const { rows } = await client.query(
    `INSERT INTO restaurant_daily_counters (restaurant_id, location_id, business_date, last_queue_number)
     SELECT $1, $3, $2, COALESCE(MAX(fo.queue_number), 0) + 1
       FROM food_orders fo
      WHERE fo.restaurant_id = $1
        AND fo.location_id = $3
        AND (fo.created_at AT TIME ZONE $4)::date = $2::date
     ON CONFLICT (restaurant_id, location_id, business_date) WHERE location_id IS NOT NULL
     DO UPDATE SET last_queue_number = restaurant_daily_counters.last_queue_number + 1
     RETURNING last_queue_number`,
    [restaurantId, businessDate, scopedLocationId, effectiveTimezone(timezone)]
  );
  return Number(rows[0].last_queue_number);
}

module.exports = { nextQueueNumber, businessDateFor };
