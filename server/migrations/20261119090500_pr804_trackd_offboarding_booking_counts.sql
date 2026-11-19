-- PR #804 ecosystem gap G-37 (no transfer path when a team member leaves).
-- The offboarding record captures how many business bookings and linked
-- appointments moved to the reassignment target, next to the crew-task
-- and corrective-action counts it already keeps.
ALTER TABLE staff_offboarding_records
  ADD COLUMN IF NOT EXISTS bookings_reassigned INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS appointments_reassigned INTEGER NOT NULL DEFAULT 0;
