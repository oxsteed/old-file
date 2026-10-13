-- Review P1-109: refresh-token rotation must not extend a session family
-- forever. absolute_expires_at is the family's hard deadline; every
-- rotation carries it forward and caps the new row's expires_at at it.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS absolute_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sessions_absolute_expires_at
  ON sessions (absolute_expires_at) WHERE absolute_expires_at IS NOT NULL;
