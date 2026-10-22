-- Migration 976: store-scoped receipt-printer settings.
-- Existing rows are assigned to the restaurant's primary store when one
-- exists. Restaurants without a location retain one legacy row with a NULL
-- location_id until their first store is created.

ALTER TABLE restaurant_printer_settings
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE CASCADE;

UPDATE restaurant_printer_settings ps
   SET location_id = l.id
  FROM restaurant_locations l
 WHERE l.restaurant_id = ps.restaurant_id
   AND l.is_primary = TRUE
   AND ps.location_id IS NULL;

DROP INDEX IF EXISTS restaurant_printer_settings_restaurant_id_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_printer_settings_restaurant_location_uniq
  ON restaurant_printer_settings(restaurant_id, location_id)
 WHERE location_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_printer_settings_legacy_restaurant_uniq
  ON restaurant_printer_settings(restaurant_id)
 WHERE location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_printer_settings_location
  ON restaurant_printer_settings(restaurant_id, location_id);
