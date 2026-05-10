-- FIX #12: 2FA Enforcement for Admin Accounts
-- Adds tracking to enforce TOTP on all admin/super_admin accounts

ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enforced_at TIMESTAMP;

-- Index for finding admins without 2FA (for enforcement check)
CREATE INDEX IF NOT EXISTS idx_admin_2fa_status
  ON users(role, totp_enabled, totp_enforced_at)
  WHERE role IN ('admin', 'super_admin');

-- Comment explaining the enforcement policy
COMMENT ON COLUMN users.totp_enforced_at IS 'Timestamp when 2FA was enforced for this admin. If NULL, admin must set up 2FA immediately.';

-- No data migration needed; column is additive with NULL default
