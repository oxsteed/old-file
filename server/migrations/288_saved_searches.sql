-- Saved searches / job alerts for helpers
DO $$
DECLARE
  user_id_type TEXT;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
  INTO user_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'users'::regclass
    AND a.attname = 'id'
    AND NOT a.attisdropped;

  EXECUTE format($sql$
    CREATE TABLE IF NOT EXISTS saved_searches (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       %1$s        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name          TEXT        NOT NULL,
      keyword       TEXT,
      category      TEXT,
      city          TEXT,
      state         TEXT,
      radius_miles  INTEGER,
      min_budget    INTEGER,
      max_budget    INTEGER,
      notify        BOOLEAN     NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  $sql$, user_id_type);
END $$;

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id  ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_notify   ON saved_searches(notify) WHERE notify = true;
