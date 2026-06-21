-- Migration 325: Restaurant app device remote configuration.
-- Extends paired app devices with a restaurant location assignment so Manager
-- can remotely configure Display/Kiosk/POS/Kitchen devices per physical store.

ALTER TABLE restaurant_app_devices
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES restaurant_locations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_app_devices_location
  ON restaurant_app_devices(restaurant_id, location_id, app_key, status);
