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
