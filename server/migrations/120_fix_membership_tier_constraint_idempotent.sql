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
