-- 952: F-02 phase 1 — location_id plumbing for POS/finance/ops records.
-- Every operational record that belongs to a physical store now carries
-- the restaurant_locations row it belongs to. Nullable during rollout;
-- creation paths stamp it (device location, else requested, else the
-- restaurant's primary location) and existing rows are backfilled to the
-- primary location, the only store they could have belonged to.

ALTER TABLE restaurant_pos_payments
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;
ALTER TABLE restaurant_pos_shifts
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;
ALTER TABLE restaurant_printer_jobs
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;
ALTER TABLE restaurant_inventory_items
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_payments_location ON restaurant_pos_payments(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_shifts_location ON restaurant_pos_shifts(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_printer_jobs_location ON restaurant_printer_jobs(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_items_location ON restaurant_inventory_items(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_food_orders_location ON food_orders(location_id) WHERE location_id IS NOT NULL;

-- Backfill: orders first (payments and printer jobs inherit from them).
UPDATE food_orders o
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = o.restaurant_id AND l.is_primary = TRUE
   AND o.location_id IS NULL;

UPDATE restaurant_pos_payments p
   SET location_id = o.location_id
  FROM food_orders o
 WHERE o.id = p.food_order_id AND p.location_id IS NULL AND o.location_id IS NOT NULL;

UPDATE restaurant_pos_payments p
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = p.restaurant_id AND l.is_primary = TRUE
   AND p.location_id IS NULL;

UPDATE restaurant_printer_jobs j
   SET location_id = o.location_id
  FROM food_orders o
 WHERE o.id = j.food_order_id AND j.location_id IS NULL AND o.location_id IS NOT NULL;

UPDATE restaurant_printer_jobs j
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = j.restaurant_id AND l.is_primary = TRUE
   AND j.location_id IS NULL;

UPDATE restaurant_pos_shifts s
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = s.restaurant_id AND l.is_primary = TRUE
   AND s.location_id IS NULL;

UPDATE restaurant_inventory_items i
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = i.restaurant_id AND l.is_primary = TRUE
   AND i.location_id IS NULL;

-- F-32 follow-through: per-store queue counters. Migration 945 keyed
-- restaurant_daily_counters by PRIMARY KEY (restaurant_id, business_date),
-- which makes a second counter row for the same restaurant and day
-- impossible, so stores could never have independent queue sequences.
-- The key is restructured into two partial unique indexes with the same
-- semantics per scope: restaurant-wide rows (location_id NULL) stay
-- unique on (restaurant_id, business_date), and per-store rows are
-- unique on (restaurant_id, location_id, business_date). An identity
-- primary key replaces the dropped composite key as row identity.
ALTER TABLE restaurant_daily_counters
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

ALTER TABLE restaurant_daily_counters
  DROP CONSTRAINT IF EXISTS restaurant_daily_counters_pkey;
ALTER TABLE restaurant_daily_counters
  ADD COLUMN IF NOT EXISTS id BIGINT GENERATED ALWAYS AS IDENTITY;
ALTER TABLE restaurant_daily_counters ADD PRIMARY KEY (id);

-- Existing rows hold the counts accumulated so far, which belong to the
-- store orders actually resolve to (the resolver's winner: the primary
-- location, else the earliest), so that store's sequence continues
-- seamlessly while every other store starts its own. Restaurants with
-- no locations keep the restaurant-wide (NULL) row.
UPDATE restaurant_daily_counters c
   SET location_id = (
         SELECT l.id
           FROM restaurant_locations l
          WHERE l.restaurant_id = c.restaurant_id
          ORDER BY l.is_primary DESC, l.id ASC
          LIMIT 1
       )
 WHERE c.location_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_daily_counters_restaurant_date
  ON restaurant_daily_counters (restaurant_id, business_date)
  WHERE location_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_daily_counters_location_date
  ON restaurant_daily_counters (restaurant_id, location_id, business_date)
  WHERE location_id IS NOT NULL;
