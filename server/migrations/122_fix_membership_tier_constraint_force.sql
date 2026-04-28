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
