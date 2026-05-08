-- Migration 180: Add location_country to jobs table
-- Supports international job postings so helpers can filter by country.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS location_country VARCHAR(100);

-- Index for country-based filtering on the browse page
CREATE INDEX IF NOT EXISTS idx_jobs_location_country
  ON jobs (location_country)
  WHERE deleted_at IS NULL;
