-- Migration 070: Add vehicle_id and home_id FKs to planned_needs
-- Lets users link a car-care planned need to a specific vehicle and any
-- planned need to a specific property. Both columns are nullable.

ALTER TABLE planned_needs
  ADD COLUMN IF NOT EXISTS vehicle_id BIGINT REFERENCES user_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS home_id    BIGINT REFERENCES user_homes(id)    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_planned_needs_vehicle_id
  ON planned_needs (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planned_needs_home_id
  ON planned_needs (home_id) WHERE home_id IS NOT NULL;
