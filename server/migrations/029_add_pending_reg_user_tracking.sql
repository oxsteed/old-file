-- Migration 029: Add user_id and account_created to pending_registrations
-- Supports creating the user row at OTP-verify time and tracking
-- whether the account has already been provisioned.

ALTER TABLE pending_registrations
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_created BOOLEAN NOT NULL DEFAULT FALSE;
