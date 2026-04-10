-- Migration 026: Fix auth schema - add sessions table and missing user columns
-- These columns/tables are required by authController.js

-- Sessions table for refresh token management
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  is_valid BOOLEAN DEFAULT true,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

-- Missing columns on users table referenced by authController.js
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
  ON users(referral_code) WHERE referral_code IS NOT NULL;
