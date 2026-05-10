-- VULN #13 FIX: Business invite token randomization and expiry

ALTER TABLE business_invite_tokens ADD COLUMN IF NOT EXISTS is_used BOOLEAN DEFAULT FALSE;
ALTER TABLE business_invite_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMP;
ALTER TABLE business_invite_tokens ADD COLUMN IF NOT EXISTS used_by_user_id UUID;

-- One-time use enforcement
CREATE OR REPLACE FUNCTION validate_invite_token_usage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_used = TRUE AND OLD.is_used = FALSE THEN
    -- First time marking as used - allowed
    RETURN NEW;
  ELSIF NEW.is_used = TRUE AND OLD.is_used = TRUE THEN
    -- Already used - prevent reuse
    RAISE EXCEPTION 'Invite token already used';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_validate_invite_reuse ON business_invite_tokens;
CREATE TRIGGER trigger_validate_invite_reuse
  BEFORE UPDATE ON business_invite_tokens
  FOR EACH ROW
  WHEN (NEW.is_used IS DISTINCT FROM OLD.is_used)
  EXECUTE FUNCTION validate_invite_token_usage();

-- Index for finding active tokens
CREATE INDEX IF NOT EXISTS idx_invite_tokens_active
  ON business_invite_tokens(token) WHERE is_used = FALSE AND expires_at > NOW();
