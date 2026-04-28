-- Migration 055: Security schema fixes
-- Addresses findings M-56, M-59 from the security audit

-- ── M-59: Add indexes on OTP expiry columns for fast cleanup queries ─────────
-- Without these, a cron job cleaning up expired OTPs does a full-table scan.
CREATE INDEX IF NOT EXISTS idx_pending_registrations_otp_expires
  ON pending_registrations (otp_expires_at)
  WHERE otp_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_expires
  ON users (reset_token_expires)
  WHERE reset_token_expires IS NOT NULL;

-- ── M-59: Add index on sessions.expires_at for fast token cleanup ─────────────
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions (expires_at)
  WHERE expires_at IS NOT NULL;

-- ── M-56: Add NOT NULL constraint on admin_audit_log.admin_id ─────────────────
-- Some legacy rows may have NULL admin_id from migration 005. Backfill with a
-- sentinel UUID before applying the constraint.
DO $$
BEGIN
  -- Only run if the column exists without a NOT NULL constraint
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'admin_audit_log'
      AND column_name  = 'admin_id'
      AND is_nullable  = 'YES'
  ) THEN
    -- Backfill NULLs with a zero UUID sentinel (indicates system/migration action)
    UPDATE admin_audit_log
    SET admin_id = '00000000-0000-0000-0000-000000000000'
    WHERE admin_id IS NULL;

    -- Now safe to add NOT NULL
    ALTER TABLE admin_audit_log
      ALTER COLUMN admin_id SET NOT NULL;
  END IF;
END $$;

-- ── Index on admin_audit_log for faster per-admin activity queries ────────────
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id
  ON admin_audit_log (admin_id, created_at DESC);
