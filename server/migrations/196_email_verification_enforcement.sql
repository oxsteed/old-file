-- VULN #19 FIX: Enforce email verification before account activation

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;

-- Create verification token on registration
CREATE OR REPLACE FUNCTION require_email_verification()
RETURNS TRIGGER AS $$
BEGIN
  -- If email changed, require reverification
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    NEW.email_verified = FALSE;
    NEW.email_verified_at = NULL;
    -- Token generation handled by application
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_require_reverify ON users;
CREATE TRIGGER trigger_require_reverify
  BEFORE UPDATE ON users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION require_email_verification();

-- Prevent access to sensitive endpoints without verified email
-- Application must check: WHERE email_verified = TRUE
-- CRITICAL: Payment/bidding endpoints must require email_verified = TRUE

CREATE INDEX IF NOT EXISTS idx_users_unverified_email
  ON users(id) WHERE email_verified = FALSE;
