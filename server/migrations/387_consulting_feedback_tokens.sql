-- Protect public consulting feedback links from session ID guessing and replay.
ALTER TABLE consulting_sessions_scheduled
  ADD COLUMN IF NOT EXISTS feedback_token_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS feedback_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feedback_token_used_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_consulting_feedback_token_hash
  ON consulting_sessions_scheduled (feedback_token_hash)
  WHERE feedback_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consulting_feedback_token_expiry
  ON consulting_sessions_scheduled (feedback_token_expires_at)
  WHERE feedback_token_expires_at IS NOT NULL;
