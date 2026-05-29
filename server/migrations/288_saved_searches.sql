-- Saved searches / job alerts for helpers
CREATE TABLE IF NOT EXISTS saved_searches (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT        NOT NULL,
  -- Filter fields (all nullable — only set fields are matched)
  keyword       TEXT,
  category      TEXT,
  city          TEXT,
  state         TEXT,
  radius_miles  INTEGER,
  min_budget    INTEGER,    -- cents
  max_budget    INTEGER,    -- cents
  notify        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user_id  ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_notify   ON saved_searches(notify) WHERE notify = true;
