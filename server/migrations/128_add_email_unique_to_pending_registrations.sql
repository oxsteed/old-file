-- ===============================================================
-- Migration 128: Add UNIQUE constraint on email to pending_registrations
-- The INSERT ON CONFLICT (email) clause requires a unique index on email
-- ===============================================================

BEGIN;

-- Add unique constraint on email for pending registrations
-- This allows ON CONFLICT (email) DO UPDATE to work properly
-- when a user retries registration with the same email
ALTER TABLE pending_registrations
  ADD CONSTRAINT pending_registrations_email_unique UNIQUE (email);

COMMIT;

-- ===============================================================
-- END OF MIGRATION 128
-- ===============================================================
