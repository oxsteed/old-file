-- Migration 1403: F-21 staff PIN uniqueness per store.
--
-- restaurant_staff_pins gains a location scope. New PINs are issued
-- per store; a PIN value may be reused across stores but never twice
-- within the same store. Rows with location_id NULL are legacy
-- restaurant-wide PINs (pre-F-21): they keep working everywhere.
--
-- Backfill: restaurants with exactly one location get their existing
-- PINs scoped to that store. Multi-store restaurants keep NULL so no
-- existing PIN stops working.

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
