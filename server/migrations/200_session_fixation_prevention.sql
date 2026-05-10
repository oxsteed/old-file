-- VULN #25 FIX: Regenerate session ID on login

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS regenerated_from_session_id BIGSERIAL;

-- On successful login, previous session should be invalidated
-- Application logic:
-- 1. Check login credentials
-- 2. Create NEW session
-- 3. Invalidate OLD session
-- 4. Return new session token

CREATE OR REPLACE FUNCTION invalidate_previous_sessions()
RETURNS TRIGGER AS $$
BEGIN
  -- When new session created, mark previous ones as superseded
  UPDATE sessions SET is_revoked = TRUE
  WHERE user_id = NEW.user_id
    AND id != NEW.id
    AND created_at < NEW.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_invalidate_old_sessions ON sessions;
CREATE TRIGGER trigger_invalidate_old_sessions
  AFTER INSERT ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION invalidate_previous_sessions();

-- Ensure session ID is cryptographically random (not sequential)
-- Use: SELECT substring(encode(digest(random()::text, 'sha256'), 'hex'), 1, 32)
