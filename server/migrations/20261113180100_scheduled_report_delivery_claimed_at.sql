-- Domain 8 #19: scheduled-report stale reclaim can double-deliver a
-- slow build. Staleness was keyed on created_at, which the reclaim
-- never updates, so a build+delivery taking over PENDING_STALE_MINUTES
-- (60) had its delivery row reclaimed mid-flight by the next run. Add
-- a claim heartbeat: the claim stamps claimed_at, the reclaim refreshes
-- it, and staleness is keyed on it. Pre-existing rows are backfilled
-- from created_at so they keep their original claim age.

ALTER TABLE restaurant_scheduled_report_deliveries
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

UPDATE restaurant_scheduled_report_deliveries
   SET claimed_at = created_at
 WHERE claimed_at IS NULL;
