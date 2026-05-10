-- FIX #6: Login alert enhancements
-- Ensure user_login_history table exists with proper indexes for efficient alert checks
CREATE TABLE IF NOT EXISTS user_login_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip_address VARCHAR(45),
  user_agent TEXT,
  success BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Idempotently add created_at in case the table already existed without it
ALTER TABLE user_login_history ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- Index for efficient "get recent logins for user" queries (used by login alert check)
CREATE INDEX IF NOT EXISTS idx_user_login_history_user_created
  ON user_login_history(user_id, created_at DESC);

-- Index for cleaning up old records (retention policy)
CREATE INDEX IF NOT EXISTS idx_user_login_history_created
  ON user_login_history(created_at DESC);

-- Index for security audits: failed login attempts per user
CREATE INDEX IF NOT EXISTS idx_user_login_history_user_success
  ON user_login_history(user_id, success, created_at DESC);

-- No data migration needed; indexes are additive
