-- Migration 99916: F-21 staff PIN uniqueness per store.
--
-- restaurant_staff_pins gains a location scope. New PINs are issued
-- per store; a PIN value may be reused across stores but never twice
-- within the same store. Rows with location_id NULL are legacy
-- restaurant-wide PINs (pre-F-21): they keep working everywhere.
--
-- Backfill: restaurants with exactly one location get their existing
-- PINs scoped to that store. Multi-store restaurants keep NULL so no
-- existing PIN stops working.
--
-- Uniqueness then moves from the restaurant to the store: the PIN digest
-- lookup stays restaurant-scoped (existing digests remain valid), but a
-- digest may repeat across stores, never twice within the same store.
-- NULLS NOT DISTINCT keeps legacy restaurant-wide PINs (location_id NULL)
-- unique restaurant-wide: two NULL-location rows with the same digest
-- still conflict.

ALTER TABLE restaurant_staff_pins
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_staff_pins_location
  ON restaurant_staff_pins(restaurant_id, location_id)
  WHERE is_active = TRUE;

UPDATE restaurant_staff_pins p
   SET location_id = single.loc_id
  FROM (
    SELECT restaurant_id, MIN(id) AS loc_id
      FROM restaurant_locations
     GROUP BY restaurant_id
    HAVING COUNT(*) = 1
  ) single
 WHERE p.restaurant_id = single.restaurant_id
   AND p.location_id IS NULL;

-- Per-store uniqueness (applied after the location scope exists above).

DROP INDEX IF EXISTS uq_restaurant_staff_pins_restaurant_digest;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_staff_pins_store_digest
  ON restaurant_staff_pins (restaurant_id, pin_digest, location_id) NULLS NOT DISTINCT
  WHERE is_active = TRUE AND pin_digest IS NOT NULL;

-- The per-owner upsert key gains the store scope as well: one staff member
-- may hold a PIN at several stores. Label-only PINs (staff_user_id NULL)
-- are excluded from this index; their rotation lookup is scoped by
-- location_id in application code.
ALTER TABLE restaurant_staff_pins
  DROP CONSTRAINT IF EXISTS restaurant_staff_pins_restaurant_id_staff_user_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_restaurant_staff_pins_owner_store
  ON restaurant_staff_pins (restaurant_id, staff_user_id, location_id) NULLS NOT DISTINCT
  WHERE staff_user_id IS NOT NULL;
