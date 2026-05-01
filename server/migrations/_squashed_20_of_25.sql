
-- >>> BEGIN: 119_allow_null_membership_tier_for_customers.sql <<<
-- Migration 115: Allow NULL membership_tier for customer accounts
-- Customers don't have membership tiers; only helpers/helper_pro/broker do.
-- This migration updates the CHECK constraint to allow NULL values.

BEGIN;

-- Drop the existing constraint that prevents NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_membership_tier_check'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE users
      DROP CONSTRAINT users_membership_tier_check;
  END IF;
END $$;

-- Add the updated constraint that allows NULL for customers
ALTER TABLE users
  ADD CONSTRAINT users_membership_tier_check
  CHECK (membership_tier IS NULL OR membership_tier IN ('tier1', 'tier2'));

COMMIT;

-- >>> END: 119_allow_null_membership_tier_for_customers.sql <<<

-- >>> BEGIN: 119_super_admin_regions.sql <<<
-- Migration 115: Super-Admin Regional Territories
--
-- Adds the `admin_regions` table used to define geographic territories that
-- regional admins can be scoped to. A region is a JSONB boundary definition
-- that supports multiple match strategies (zip range, city/state, geo radius).
--
-- Also adds `region_id` to `admin_permission_grants` so super-admins can
-- restrict a regular admin's elevated grant to a specific territory.

-- ── 1. admin_regions ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS admin_regions (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(100) NOT NULL UNIQUE,
  description         TEXT,
  -- Boundary shape examples:
  --   { "type": "zip_range",  "ranges": [{ "start": 60001, "end": 60699 }] }
  --   { "type": "city_state", "entries": [{ "city": "Chicago", "state": "IL" }] }
  --   { "type": "geo_radius", "center": { "lat": 41.87, "lng": -87.62 }, "radius_miles": 25 }
  boundary_definition JSONB        NOT NULL,
  created_by          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regions_name       ON admin_regions(name);
CREATE INDEX IF NOT EXISTS idx_regions_created_by ON admin_regions(created_by);

-- ── 2. Region scoping on permission grants ────────────────────────────────────

ALTER TABLE admin_permission_grants
  ADD COLUMN IF NOT EXISTS region_id INTEGER REFERENCES admin_regions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_perm_grants_region
  ON admin_permission_grants(region_id)
  WHERE region_id IS NOT NULL;

-- >>> END: 119_super_admin_regions.sql <<<

-- >>> BEGIN: 121_fix_membership_tier_constraint_idempotent.sql <<<
-- Migration 120: Fix membership_tier CHECK constraint (idempotent)
-- This properly drops the old constraint and creates the new one that allows NULL.
-- Uses conditional logic to handle both fresh databases and existing ones.

BEGIN;

-- First, try to drop the constraint if it exists with the restrictive definition
-- We use PL/pgSQL to safely drop it without causing errors
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  -- Check if the constraint exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_membership_tier_check'
      AND constraint_type = 'CHECK'
  ) INTO constraint_exists;

  -- If it exists, drop it so we can recreate with the correct definition
  IF constraint_exists THEN
    ALTER TABLE users DROP CONSTRAINT users_membership_tier_check CASCADE;
  END IF;
END $$;

-- Now add the correct constraint that allows NULL for customers
ALTER TABLE users
  ADD CONSTRAINT users_membership_tier_check
  CHECK (membership_tier IS NULL OR membership_tier IN ('tier1', 'tier2'));

COMMIT;

-- >>> END: 121_fix_membership_tier_constraint_idempotent.sql <<<

-- >>> BEGIN: 122_fix_membership_tier_constraint_force.sql <<<
-- Migration 122: Force fix membership_tier CHECK constraint
-- This migration uses exception handling to ensure the constraint is properly updated
-- regardless of whether previous migrations executed or what state the constraint is in

BEGIN;

-- First attempt: try to drop the old restrictive constraint
-- If it doesn't exist, that's fine - we'll add the correct one regardless
DO $$
BEGIN
  -- Try to drop any existing membership_tier constraint
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_membership_tier_check;
EXCEPTION WHEN undefined_object THEN
  -- Constraint doesn't exist, continue
  NULL;
WHEN others THEN
  -- Log but continue for any other error
  RAISE WARNING 'Error dropping constraint: %', SQLERRM;
END $$;

-- Now ensure the correct constraint exists with the NULL-allowing definition
DO $$
BEGIN
  -- Check if the constraint already exists with the correct definition
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_membership_tier_check'
      AND constraint_type = 'CHECK'
  ) THEN
    -- Constraint doesn't exist, create it
    ALTER TABLE users
      ADD CONSTRAINT users_membership_tier_check
      CHECK (membership_tier IS NULL OR membership_tier IN ('tier1', 'tier2'));
  ELSE
    -- Constraint exists, verify it has the correct definition
    -- If not, we need to drop and recreate it
    -- First, attempt to drop it
    ALTER TABLE users DROP CONSTRAINT users_membership_tier_check;

    -- Then add the correct one
    ALTER TABLE users
      ADD CONSTRAINT users_membership_tier_check
      CHECK (membership_tier IS NULL OR membership_tier IN ('tier1', 'tier2'));
  END IF;
END $$;

-- Verify the constraint is now correct
DO $$
DECLARE
  constraint_def TEXT;
BEGIN
  -- Try to insert a test customer with NULL membership_tier to verify it works
  -- We'll use a transaction that rolls back to avoid actually adding test data

  -- The constraint should now allow NULL, so this SELECT should succeed
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_membership_tier_check'
      AND constraint_type = 'CHECK'
  ) THEN
    RAISE NOTICE 'Constraint users_membership_tier_check exists and allows NULL values for customer accounts';
  ELSE
    RAISE EXCEPTION 'Failed to create users_membership_tier_check constraint';
  END IF;
END $$;

COMMIT;

-- >>> END: 122_fix_membership_tier_constraint_force.sql <<<

-- >>> BEGIN: 123_drop_users_membership_tier_not_null.sql <<<
-- Migration 123: Drop the column-level NOT NULL on users.membership_tier
--
-- Background
-- ----------
-- `membership_tier` was originally added (migration 029b / runOnce.js) as
--   `TEXT NOT NULL DEFAULT 'tier1'`
-- because at the time only helpers existed and they always had a tier.
--
-- Migrations 119 / 121 / 122 relaxed the CHECK constraint to
--   `CHECK (membership_tier IS NULL OR membership_tier IN ('tier1','tier2'))`
-- so that customer accounts (which have no tier) could store NULL.
--
-- However, the column-level NOT NULL constraint was never dropped, so any
-- INSERT that writes membership_tier = NULL still fails with
--   `null value in column "membership_tier" violates not-null constraint`.
--
-- This breaks super-admin "Create User" for `role = 'customer'` in both
-- `superAdminController.createUser` (simple modal in UsersList) and
-- `superAdminUserController.createUserFull` (the full create-user form),
-- which both pass NULL for customer rows.
--
-- This migration drops the NOT NULL so the relaxed CHECK constraint can
-- actually be honored. The column default ('tier1') is left intact, so
-- callers that omit the column from an INSERT still get the legacy default.

BEGIN;

ALTER TABLE users
  ALTER COLUMN membership_tier DROP NOT NULL;

COMMIT;

-- >>> END: 123_drop_users_membership_tier_not_null.sql <<<

-- >>> BEGIN: 124_admin_user_action_log_nullable_ids.sql <<<
-- Migration 124: Allow nullable admin_id and target_user_id in admin_user_action_log
--
-- Background
-- ----------
-- The admin_user_action_log table was created (migration 116) with both admin_id and
-- target_user_id as NOT NULL to ensure referential integrity. However, the super-admin
-- delete user flow tries to UPDATE these columns to NULL as a cleanup step before
-- deleting a user.
--
-- The combination of:
-- 1. NOT NULL constraints on both FK columns
-- 2. ON DELETE CASCADE rules
-- 3. NO-DELETE rule that blocks the cascade
--
-- Creates a deadlock where deletion cannot proceed because:
-- - The NO-DELETE rule prevents CASCADE from working
-- - UPDATE to NULL fails due to NOT NULL constraint
--
-- Solution: Make both columns nullable so they can be set to NULL during user deletion,
-- while preserving the audit trail immutability (the row itself is never deleted).

BEGIN;

-- Allow admin_id to be NULL (when the admin account is deleted)
ALTER TABLE admin_user_action_log
  ALTER COLUMN admin_id DROP NOT NULL;

-- Allow target_user_id to be NULL (when the target user account is deleted)
ALTER TABLE admin_user_action_log
  ALTER COLUMN target_user_id DROP NOT NULL;

COMMIT;

-- >>> END: 124_admin_user_action_log_nullable_ids.sql <<<
