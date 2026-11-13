-- Domain 9 cost audit (2026-11-13) item 6: candidate-alert runs cap hits at
-- 1,000 per alert per run. Record on the alert row whether the latest run
-- hit the cap (truncated) and how many new hits it inserted, so a truncated
-- run is visible instead of silently dropping matches.
BEGIN;

ALTER TABLE career_candidate_alerts
  ADD COLUMN IF NOT EXISTS last_run_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_run_hits INTEGER NOT NULL DEFAULT 0;

COMMIT;
