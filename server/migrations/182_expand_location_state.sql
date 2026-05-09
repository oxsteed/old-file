-- Migration 182: Fix schema mismatch - expand location_state from CHAR(2) to VARCHAR(100)
--
-- ISSUE: PostJobPage.jsx sends full state names like "Texas", "California"
-- but jobs.location_state was defined as CHAR(2) (only 2 characters allowed)
-- This caused SQLSTATE 22001 (string_data_right_truncation) on job creation
--
-- FIX: Expand location_state to VARCHAR(100) to match form behavior

ALTER TABLE jobs
  ALTER COLUMN location_state TYPE VARCHAR(100);

-- Update index if it exists
DROP INDEX IF EXISTS idx_jobs_location;
CREATE INDEX IF NOT EXISTS idx_jobs_location
  ON jobs(location_city, location_state)
  WHERE location_state IS NOT NULL;

COMMENT ON COLUMN jobs.location_state IS 'Full state/region name (e.g., "Texas", "California"), not 2-letter abbreviation';
