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
