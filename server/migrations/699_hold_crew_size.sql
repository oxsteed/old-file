-- Audit fix (2026-10-06): holds reserved one assignee even when the service
-- required a crew of N. Add group tracking so a hold reserves the full crew.

ALTER TABLE direct_slot_holds
  ADD COLUMN IF NOT EXISTS hold_group_token VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS crew_index INT NULL DEFAULT 0;

-- Backfill: existing single-crew holds are their own group.
UPDATE direct_slot_holds
  SET hold_group_token = hold_token, crew_index = 0
  WHERE hold_group_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_direct_slot_holds_group
  ON direct_slot_holds (hold_group_token);
