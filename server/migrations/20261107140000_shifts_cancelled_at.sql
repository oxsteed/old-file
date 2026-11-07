-- Migration 20261107140000: soft-delete for business_staff_shifts
-- (goal goal_a0fc7c0f0394, design-review item 61).
--
-- deleteShift hard-deleted the row: the Fair Workweek before_state
-- survived in business_staff_schedule_changes, but the shift itself
-- was gone and there was no cancelled state. cancelled_at records
-- the cancellation; NULL means the shift is active. Every reader
-- that means active shifts filters on it; audit/history/retention
-- readers keep seeing cancelled rows.
--
-- Additive only. Idempotent. No backfill: every existing row is
-- active (cancelled_at NULL), which matches the old hard-delete
-- behavior where a row either existed or did not.
ALTER TABLE business_staff_shifts
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Active-shift lookups (list, conflict validation, forecast,
-- copy-week source, borrow overlap, PTO scheduled hours) all filter
-- cancelled_at IS NULL; the partial index keeps those scans cheap
-- without indexing long-dead rows.
CREATE INDEX IF NOT EXISTS idx_business_staff_shifts_active
  ON business_staff_shifts (business_id, shift_date)
  WHERE cancelled_at IS NULL;
