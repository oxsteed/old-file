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
