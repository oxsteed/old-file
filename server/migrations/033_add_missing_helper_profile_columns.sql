-- Migration 033: Add columns to helper_profiles that migration 019 defines
-- in CREATE TABLE but silently skips on existing tables (IF NOT EXISTS).
-- Fixes "Profile failed to save" errors on existing deployments.
-- OxSteed v2

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS profile_headline VARCHAR(280),
  ADD COLUMN IF NOT EXISTS rate_preference VARCHAR(20) DEFAULT 'per_job';
