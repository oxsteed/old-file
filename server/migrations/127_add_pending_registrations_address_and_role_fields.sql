-- ===============================================================
-- Migration 127: Add missing address and role fields to pending_registrations
-- Adds columns that authController.startRegistration() expects but were missing
-- ===============================================================

BEGIN;

-- Add missing address fields to pending_registrations
ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS address_line1 VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS state VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS country VARCHAR(2) NULL,
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS referral_ref VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL DEFAULT now();

-- Create index on updated_at for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_pending_reg_updated ON pending_registrations(updated_at);

COMMIT;

-- ===============================================================
-- END OF MIGRATION 127
-- ===============================================================
