'use strict';

// Per-restaurant, per-business-day queue number allocation (F-18/F-32).
//
// Replaces the MAX(queue_number) + 1 computation that order creation used
// to run over food_orders. That computation was only safe while the caller
// held the food_restaurants row FOR UPDATE, which serialized every order
// for a restaurant behind whatever else the transaction was doing (Stripe
// and routing network calls included). Allocation here is one atomic
// upsert on the (restaurant_id, business_date) counter row from migration
// 945: concurrent transactions serialize on the counter row alone for the
// duration of a single statement, never on the restaurant row.
//
// The business date is the calendar date in the restaurant's own time
// zone, which is the same day boundary the old MAX computation used
// ((created_at AT TIME ZONE tz)::date = (now() AT TIME ZONE tz)::date).

function businessDateFor(timezone, now = new Date()) {
  const instant = now instanceof Date ? now : new Date(now);
  const format = (timeZone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const value = (type) => parts.find((part) => part.type === type)?.value;
    return `${value('year')}-${value('month')}-${value('day')}`;
  };
  try {
    return format(timezone || 'UTC');
  } catch (err) {
    // A restaurant row can hold a non-IANA time zone string (written before
    // validation existed). Fall back to UTC instead of failing the order,
    // matching the safe-read fallback the hours logic uses.
    return format('UTC');
  }
}

async function nextQueueNumber(client, restaurantId, timezone, now = new Date()) {
  const businessDate = businessDateFor(timezone, now);
  const { rows } = await client.query(
    `INSERT INTO restaurant_daily_counters (restaurant_id, business_date, last_queue_number)
     VALUES ($1, $2, 1)
     ON CONFLICT (restaurant_id, business_date)
     DO UPDATE SET last_queue_number = restaurant_daily_counters.last_queue_number + 1
     RETURNING last_queue_number`,
    [restaurantId, businessDate]
  );
  return Number(rows[0].last_queue_number);
}

module.exports = { nextQueueNumber, businessDateFor };
