-- Migration 022: Add Two-Factor Authentication (TOTP)
-- OxSteed v2

BEGIN;

-- Add 2FA columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_verified_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_codes TEXT[] NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery_email VARCHAR(255) NULL;

-- Track 2FA setup attempts and failed verifications
CREATE TABLE IF NOT EXISTS two_factor_audit_log (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_2fa_audit_user_id ON two_factor_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_2fa_audit_action ON two_factor_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_2fa_audit_created ON two_factor_audit_log(created_at);

COMMIT;
