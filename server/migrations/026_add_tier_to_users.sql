-- Migration 026: Add tier column to users table
-- The auth controller references users.tier in login, register,
-- refresh, and profile queries, but the column only exists on
-- helper_profiles. This adds it to users with a safe default.
-- OxSteed v2

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'free';

COMMIT;
