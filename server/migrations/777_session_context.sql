-- Review W4 (P3-1125): the session list selected columns that did not exist.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
UPDATE sessions SET last_used_at = created_at WHERE last_used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions (user_id, last_used_at DESC) WHERE is_valid = TRUE AND is_revoked = FALSE;
