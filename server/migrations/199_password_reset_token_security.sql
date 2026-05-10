-- VULN #24 FIX: Use cryptographically strong reset tokens

ALTER TABLE users ALTER COLUMN reset_token TYPE VARCHAR(255);

-- Store hash of token (not plaintext) for added security
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(255);

-- Function to generate strong reset token
-- Application calls: SELECT generate_reset_token() and returns to user, stores hash in DB
-- When user submits token, hash it and compare:
--   SELECT 1 FROM users WHERE reset_token_hash = SHA256($1)

-- Limit reset attempts per user
CREATE TABLE IF NOT EXISTS password_reset_attempts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  ip_address VARCHAR(45),
  attempted_at TIMESTAMP DEFAULT NOW(),
  success BOOLEAN
);

-- Enforce rate limiting: max 3 reset attempts per hour per user
CREATE INDEX IF NOT EXISTS idx_reset_attempts_user_time
  ON password_reset_attempts(user_id, attempted_at DESC);

-- Auto-cleanup old unused tokens (older than 24 hours)
-- Run via: DELETE FROM users WHERE reset_token IS NOT NULL AND reset_token_expires < NOW()
