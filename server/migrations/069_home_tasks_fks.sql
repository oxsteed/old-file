-- Migration 069: Add vehicle_id and home_id FKs to home_tasks
-- Connects car-care tasks to the user's saved vehicle and home-maintenance
-- tasks to the user's saved home, feeding structured context into Life Pulse
-- and Planned Needs.  Both columns are nullable — older rows are unaffected.

ALTER TABLE home_tasks
  ADD COLUMN IF NOT EXISTS vehicle_id BIGINT REFERENCES user_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS home_id    BIGINT REFERENCES user_homes(id)    ON DELETE SET NULL;

-- Partial indexes: only index non-NULL rows (small, fast)
CREATE INDEX IF NOT EXISTS idx_home_tasks_vehicle_id
  ON home_tasks (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_home_tasks_home_id
  ON home_tasks (home_id) WHERE home_id IS NOT NULL;
