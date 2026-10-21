-- Migration 975: bind legacy display pairings to a restaurant store.
--
-- The newer restaurant_app_devices flow already carries location_id. This
-- closes the older display_pairings path so a kitchen token cannot operate on
-- a sibling store in the same restaurant.

ALTER TABLE display_pairings
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

UPDATE display_pairings p
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = p.restaurant_id
   AND l.is_primary = TRUE
   AND p.location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_display_pairings_restaurant_location
  ON display_pairings(restaurant_id, location_id, paired_at DESC);
