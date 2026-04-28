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
