-- Migration 056: Role switching support + helper listing visibility toggle
-- Adds is_listed column to helper_profiles so helpers can go "offline"
-- without deactivating their account.

ALTER TABLE helper_profiles
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT TRUE;

-- Partial index — only listed helpers need to be fast-scanned in directory queries
CREATE INDEX IF NOT EXISTS idx_helper_profiles_is_listed
  ON helper_profiles (user_id)
  WHERE is_listed = TRUE;
