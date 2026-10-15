-- Migration 868: statement saved views (statements capabilities, Group B).
--
-- Lets a signed-in user name and persist a filter+sort combination ("view")
-- for the interactive statement table. Views are owner-scoped: the API
-- enforces user_id = req.user.id on list/create/delete, and unknown or
-- foreign view ids answer 404 so ownership cannot be probed.
--
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS, named unique index
-- guarded by a DO block, and an index with IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS statement_saved_views (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  product VARCHAR(32) NOT NULL
    CHECK (product IN ('oxsteed', 'restaurant', 'restaurant_settlement', 'helper_earnings', 'business')),
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_statement_saved_views_user
  ON statement_saved_views (user_id, product, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_statement_saved_views_user_name'
  ) THEN
    ALTER TABLE statement_saved_views
      ADD CONSTRAINT uq_statement_saved_views_user_name UNIQUE (user_id, name);
  END IF;
END $$;

COMMENT ON TABLE statement_saved_views IS
  'User-named filter+sort presets for statement tables. Owner-scoped; no cross-user reads.';
