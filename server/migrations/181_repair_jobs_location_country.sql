-- Migration 181: Repair jobs location_country column and index
-- Ensures location_country column exists and has proper index.
-- Migration 180 may have failed due to referencing non-existent deleted_at column.

-- Ensure the column exists
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS location_country VARCHAR(100);

-- Drop the old index if it exists (with wrong WHERE clause)
DROP INDEX IF EXISTS idx_jobs_location_country;

-- Create the corrected index
CREATE INDEX IF NOT EXISTS idx_jobs_location_country
  ON jobs (location_country)
  WHERE location_country IS NOT NULL;
