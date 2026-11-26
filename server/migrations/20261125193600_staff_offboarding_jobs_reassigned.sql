-- Batch E (294, G5-3): the offboarding record captures how many
-- business-attributed OxSteed jobs moved to the reassignment target
-- when a member is removed, next to the booking/appointment counts
-- it already keeps.
ALTER TABLE staff_offboarding_records
  ADD COLUMN IF NOT EXISTS jobs_reassigned INTEGER NOT NULL DEFAULT 0;
