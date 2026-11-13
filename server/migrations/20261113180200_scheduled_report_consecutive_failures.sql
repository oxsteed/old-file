-- Domain 8 #22: scheduled-reports head-of-line blocking by persistently
-- failing schedules. runDueScheduledReports caps a run at
-- MAX_SCHEDULES_PER_RUN (100) due schedules, and a schedule whose build
-- keeps failing stays due and occupies a slot, so 100 failing schedules
-- block all others. Track consecutive failures per schedule so the run
-- can skip schedules at/above the threshold (5) until one succeeds
-- again and resets the counter.

ALTER TABLE restaurant_scheduled_reports
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
