-- W10.5: reconcile audit writers and retain an access-token denylist key per session.
-- This migration is intentionally idempotent for rehearsals on partially upgraded databases.
ALTER TABLE IF EXISTS admin_audit_log
  ADD COLUMN IF NOT EXISTS details JSONB,
  ADD COLUMN IF NOT EXISTS admin_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS access_token_hash VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_sessions_access_token_hash
  ON sessions(access_token_hash)
  WHERE access_token_hash IS NOT NULL;
