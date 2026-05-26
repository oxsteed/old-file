-- Migration 279: User guide completions for Learn Mode
-- Tracks which guides each authenticated user has marked complete.
-- localStorage is the primary store for guests; this table persists completions
-- for logged-in users across devices and sessions.

CREATE TABLE IF NOT EXISTS user_guide_completions (
  id           SERIAL PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guide_id     VARCHAR(100) NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_user_guide_completion UNIQUE (user_id, guide_id)
);

CREATE INDEX IF NOT EXISTS idx_ugc_user_id   ON user_guide_completions (user_id);
CREATE INDEX IF NOT EXISTS idx_ugc_guide_id  ON user_guide_completions (guide_id);
CREATE INDEX IF NOT EXISTS idx_ugc_completed ON user_guide_completions (completed_at DESC);
