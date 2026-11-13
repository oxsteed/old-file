-- Driver availability flag (2026-11-13, item 12). delivery_driver_profiles
-- had no online/availability flag: `active` is ops-controlled, not a driver
-- toggle. `available` is driver-controlled, defaults to false, and is NOT
-- used to gate claiming (deliberate product boundary, not an oversight).
BEGIN;

ALTER TABLE delivery_driver_profiles
  ADD COLUMN IF NOT EXISTS available BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
