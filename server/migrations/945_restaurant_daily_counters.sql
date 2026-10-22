-- Migration 945: per-restaurant, per-business-day queue number counters
-- (franchise readiness findings F-18 and F-32).
--
-- Why: every order flow allocated queue numbers with
-- SELECT COALESCE(MAX(queue_number), 0) + 1 over food_orders. Keeping those
-- numbers unique forced order creation to hold the food_restaurants row
-- FOR UPDATE for the whole transaction, including Stripe and routing
-- network calls, which serialized all ordering for a restaurant behind
-- network latency. Allocation is now a single atomic upsert on one counter
-- row per (restaurant, business date): race-free without the row lock.
-- The business date is the restaurant-local calendar date, matching the
-- day boundary the MAX computation used.
--
-- The seed copies the highest queue number already issued per restaurant
-- and recent business date, so a counter created mid-day continues the
-- sequence instead of restarting at 1 and duplicating numbers already on
-- printed tickets. Only recent dates are seeded: a business date is always
-- within a day of the UTC date in every time zone, and older dates can
-- never be allocated again.

CREATE TABLE IF NOT EXISTS restaurant_daily_counters (
  restaurant_id BIGINT NOT NULL REFERENCES food_restaurants(id) ON DELETE CASCADE,
  business_date DATE NOT NULL,
  last_queue_number INTEGER NOT NULL DEFAULT 0 CHECK (last_queue_number >= 0),
  PRIMARY KEY (restaurant_id, business_date)
);

INSERT INTO restaurant_daily_counters (restaurant_id, business_date, last_queue_number)
SELECT fo.restaurant_id,
       (fo.created_at AT TIME ZONE COALESCE(fr.timezone, 'UTC'))::date AS business_date,
       MAX(fo.queue_number)
  FROM food_orders fo
  JOIN food_restaurants fr ON fr.id = fo.restaurant_id
 WHERE (fo.created_at AT TIME ZONE COALESCE(fr.timezone, 'UTC'))::date
       >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - 2
 GROUP BY fo.restaurant_id,
          (fo.created_at AT TIME ZONE COALESCE(fr.timezone, 'UTC'))::date
ON CONFLICT (restaurant_id, business_date)
  DO UPDATE SET last_queue_number = GREATEST(
    restaurant_daily_counters.last_queue_number,
    EXCLUDED.last_queue_number
  );
