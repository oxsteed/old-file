-- VULN #12 FIX: Refresh token reuse prevention
-- Invalidate old tokens when new ones are issued

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS parent_session_id BIGSERIAL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN DEFAULT FALSE;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP;

-- Create refresh token chain (each new token invalidates parent)
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);

-- Auto-invalidate old tokens in same chain
CREATE OR REPLACE FUNCTION invalidate_parent_refresh_token()
RETURNS TRIGGER AS $$
BEGIN
  -- When a new session is created, mark all parent sessions as revoked
  UPDATE sessions SET is_revoked = TRUE, revoked_at = NOW()
  WHERE user_id = NEW.user_id
    AND id != NEW.id
    AND created_at < NEW.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_invalidate_parent_token ON sessions;
CREATE TRIGGER trigger_invalidate_parent_token
  AFTER INSERT ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_parent_refresh_token();

COMMENT ON COLUMN sessions.is_revoked IS 'Token has been revoked and cannot be used for refresh';
