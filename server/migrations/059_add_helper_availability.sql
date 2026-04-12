-- Migration 059: Add helper availability timestamp for live chat
-- NOTE: helper_profiles already has is_available_now BOOLEAN (added in 019_helper_registration.sql)
-- This migration only adds the missing available_since timestamp column
-- and a partial index to speed up browse filtering.

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS available_since TIMESTAMPTZ;

-- Partial index for fast filtering of available helpers on browse/search page
-- Only indexes rows where is_available_now = true (small subset = lean index)
CREATE INDEX IF NOT EXISTS idx_helper_profiles_is_available_now
  ON helper_profiles (is_available_now)
  WHERE is_available_now = true;
