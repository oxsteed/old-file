-- Phase 2: Migration 003 - Create sessions table
-- OxSteed v2

BEGIN;

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  refresh_token VARCHAR(255) NOT NULL,
  is_valid BOOLEAN NOT NULL DEFAULT true,
  device_info TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token);

COMMIT;
