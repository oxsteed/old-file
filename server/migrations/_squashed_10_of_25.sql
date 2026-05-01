
-- >>> BEGIN: 067_fix_otp_code_column_types.sql <<<
-- Migration 067: Fix otp_code column types to accommodate SHA-256 hashes
-- The security hardening in migration 037+ changed OTP storage to use SHA-256
-- hashes (64-char hex) instead of raw 6-digit codes. The original CHAR(6) /
-- VARCHAR(10) column definitions cause PostgreSQL 22001 errors when the hash
-- is written. Expand both columns to TEXT.

-- pending_registrations.otp_code: CHAR(6) → TEXT
-- (helper startRegistration and customer acceptTerms both write a 64-char hash)
ALTER TABLE pending_registrations
  ALTER COLUMN otp_code TYPE TEXT;

-- users.otp_code: VARCHAR(10) → TEXT
-- (requestOTP and resendVerification write a 64-char hash)
ALTER TABLE users
  ALTER COLUMN otp_code TYPE TEXT;

-- >>> END: 067_fix_otp_code_column_types.sql <<<

-- >>> BEGIN: 068_didit_status_skipped.sql <<<
-- Migration 068: add 'skipped' as a valid didit_status value
-- 'skipped' is set when DIDIT_API_KEY is absent (dev / staging) and the user
-- proceeds through the identity-verification step without completing Didit.
-- This prevents the ProtectedRoute from redirecting them indefinitely.
-- The column is VARCHAR(30) with no CHECK constraint, so this is a no-op DDL;
-- we just document the new accepted value and ensure existing rows are not
-- affected (DEFAULT 'pending' stays).

-- Mark any pre-existing null didit_status rows as 'pending' (belt-and-suspenders
-- in case older records were inserted before the DEFAULT was applied).
UPDATE users
SET didit_status = 'pending'
WHERE didit_status IS NULL;

-- >>> END: 068_didit_status_skipped.sql <<<

-- >>> BEGIN: 069_home_tasks_fks.sql <<<
-- Migration 069: Add vehicle_id and home_id FKs to home_tasks
-- Connects car-care tasks to the user's saved vehicle and home-maintenance
-- tasks to the user's saved home, feeding structured context into Life Pulse
-- and Planned Needs.  Both columns are nullable — older rows are unaffected.

ALTER TABLE home_tasks
  ADD COLUMN IF NOT EXISTS vehicle_id BIGINT REFERENCES user_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS home_id    BIGINT REFERENCES user_homes(id)    ON DELETE SET NULL;

-- Partial indexes: only index non-NULL rows (small, fast)
CREATE INDEX IF NOT EXISTS idx_home_tasks_vehicle_id
  ON home_tasks (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_home_tasks_home_id
  ON home_tasks (home_id) WHERE home_id IS NOT NULL;

-- >>> END: 069_home_tasks_fks.sql <<<

-- >>> BEGIN: 070_planned_needs_fks.sql <<<
-- Migration 070: Add vehicle_id and home_id FKs to planned_needs
-- Lets users link a car-care planned need to a specific vehicle and any
-- planned need to a specific property. Both columns are nullable.

ALTER TABLE planned_needs
  ADD COLUMN IF NOT EXISTS vehicle_id BIGINT REFERENCES user_vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS home_id    BIGINT REFERENCES user_homes(id)    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_planned_needs_vehicle_id
  ON planned_needs (vehicle_id) WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_planned_needs_home_id
  ON planned_needs (home_id) WHERE home_id IS NOT NULL;

-- >>> END: 070_planned_needs_fks.sql <<<

-- >>> BEGIN: 071_support_messages_language.sql <<<
-- Migration 071: Add sender_language and translation cache support
-- Enables multi-language support in support tickets with Redis caching

ALTER TABLE support_messages ADD COLUMN IF NOT EXISTS sender_language VARCHAR(5) DEFAULT 'en';

-- Partial index on messages with different sender languages (for translation queries)
CREATE INDEX IF NOT EXISTS idx_support_messages_language
  ON support_messages(ticket_id, sender_language)
  WHERE sender_language != 'en';

COMMENT ON COLUMN support_messages.sender_language IS
  'Language code of the sender (en, es, fr, ht, etc). Used to auto-translate messages when admin/customer speak different languages.';

-- >>> END: 071_support_messages_language.sql <<<

-- >>> BEGIN: 072_schema_divergence_reconciliation.sql <<<
-- Migration 072: Schema Divergence Reconciliation
--
-- PROBLEM: Multiple migrations create the same tables with different schemas.
-- The IF NOT EXISTS clause masks divergences, causing silent failures.
--
-- DIVERGENCES FIXED:
-- 1. sessions: migrations 025 and 026 conflict on columns and types
-- 2. feature_flags: migrations 001, 005, 023 have conflicting schemas
-- 3. dispute_messages: migrations 015, 025, 050 have major differences
-- 4. dispute_evidence: migrations 025 and 050 have minor differences
--
-- RESOLUTION STRATEGY:
-- - Keep the most recent version as authoritative
-- - Remove duplicate tables and consolidate to one version
-- - Add missing columns from earlier migrations if they're still useful
-- - Fix constraints to be consistent
--
-- AUDITING NOTES:
-- In production: Before running this migration, verify the actual running
-- schema via psql:
--   \d sessions
--   \d feature_flags
--   \d dispute_messages
--   \d dispute_evidence
--
-- If the production schema differs from what these statements expect,
-- create an additional migration to fix it before proceeding.

BEGIN;

-- ============================================================================
-- FIX 1: sessions table (conflicts in 025 vs 026)
-- ============================================================================
-- Migration 026 is more recent and defines the minimal schema.
-- But migration 025 adds device_info, ip_address, revoked_at which might be useful.
--
-- DECISION: Keep migration 026 as base, add useful columns from 025 if they don't exist

ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS device_info TEXT NULL,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45) NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ NULL;

-- Ensure proper indexing (from 026)
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- ============================================================================
-- FIX 2: feature_flags table (conflicts in 001, 005, 023)
-- ============================================================================
-- Migration 023 is the most recent and uses standard SERIAL id + UNIQUE key.
-- Migration 005 uses key as PRIMARY KEY (problematic design).
-- Migration 001 is the original.
--
-- DECISION: Use migration 023 schema, add rollout_pct from 005 if it adds value

ALTER TABLE IF EXISTS feature_flags
  ADD COLUMN IF NOT EXISTS rollout_pct INT DEFAULT 100;

-- Drop the old primary key constraint if key was PRIMARY (from migration 005)
-- This must be done carefully to avoid errors
DO $$
BEGIN
  -- Check if key is the primary key (this would be unusual if id exists)
  -- If so, add id and make it primary
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='feature_flags' AND constraint_type='PRIMARY KEY'
    AND constraint_name != 'feature_flags_pkey'
  ) THEN
    -- key is not the primary key, we're good
    ALTER TABLE feature_flags
      ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY;
  END IF;
END $$;

-- Ensure proper indexing
CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON feature_flags(key);

-- ============================================================================
-- FIX 3: dispute_messages table (major conflicts in 015, 025, 050)
-- ============================================================================
-- Migration 050 is the most recent and uses:
-- - UUID id (better than SERIAL)
-- - sender_role column (useful for routing)
-- - is_admin_only (clearer than is_admin)
-- - NOT NULL constraints on key fields
--
-- Migration 015 uses SERIAL id and has attachments (deprecated, not used)
-- Migration 025 is intermediate
--
-- STRATEGY: Recreate table to match migration 050 schema, drop attachments column

-- BACKFILL: add sender_role to old table so the backup SELECT can read it
ALTER TABLE IF EXISTS dispute_messages
  ADD COLUMN IF NOT EXISTS sender_role VARCHAR(20);

-- Create a temporary table to preserve data if the table exists
CREATE TEMP TABLE dispute_messages_backup AS
SELECT
  id::text as id,
  dispute_id,
  sender_id,
  message,
  created_at,
  CASE WHEN is_admin IS NOT NULL THEN is_admin ELSE false END as is_admin_only,
  CASE WHEN sender_role IS NOT NULL THEN sender_role ELSE 'unknown' END as sender_role
FROM dispute_messages
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='dispute_messages');

-- Drop the old table if it exists (careful: this deletes data)
DROP TABLE IF EXISTS dispute_messages CASCADE;

-- Recreate with correct schema (matching migration 050)
CREATE TABLE dispute_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id      INTEGER NOT NULL REFERENCES disputes(id) ON DELETE CASCADE,
  sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role     VARCHAR(20) NOT NULL, -- 'client'|'helper'|'admin'
  message         TEXT NOT NULL,
  is_admin_only   BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Restore data from backup if available
INSERT INTO dispute_messages (id, dispute_id, sender_id, sender_role, message, is_admin_only, created_at)
SELECT
  CAST(id AS UUID),
  dispute_id,
  sender_id,
  sender_role,
  message,
  is_admin_only,
  created_at
FROM dispute_messages_backup
ON CONFLICT (id) DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_dispute_messages ON dispute_messages(dispute_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_dispute_messages_sender ON dispute_messages(sender_id);

-- ============================================================================
-- FIX 4: dispute_evidence table (minor conflicts in 025 vs 050)
-- ============================================================================
-- Ensure all NOT NULL constraints are properly set (from migration 050)

ALTER TABLE IF EXISTS dispute_evidence
  ALTER COLUMN dispute_id SET NOT NULL,
  ALTER COLUMN submitted_by SET NOT NULL;

-- Create indexes if missing
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_dispute_id ON dispute_evidence(dispute_id);
CREATE INDEX IF NOT EXISTS idx_dispute_evidence_submitted_by ON dispute_evidence(submitted_by);

-- ============================================================================
-- DOCUMENTATION & AUDIT
-- ============================================================================

-- Create a schema audit table to track what we fixed
CREATE TABLE IF NOT EXISTS schema_audit (
  id SERIAL PRIMARY KEY,
  migration_version INT NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  change_description TEXT NOT NULL,
  fixed_at TIMESTAMPTZ DEFAULT NOW(),
  verified BOOLEAN DEFAULT false
);

INSERT INTO schema_audit (migration_version, table_name, change_description) VALUES
  (72, 'sessions', 'Added device_info, ip_address, revoked_at columns from migration 025; ensured indexes from migration 026'),
  (72, 'feature_flags', 'Consolidated schemas from 001/005/023; added rollout_pct column; ensured SERIAL id + UNIQUE key pattern'),
  (72, 'dispute_messages', 'Consolidated schemas from 015/025/050; removed attachments; standardized on UUID id + sender_role'),
  (72, 'dispute_evidence', 'Ensured NOT NULL constraints; added indexes');

COMMIT;

-- >>> END: 072_schema_divergence_reconciliation.sql <<<
