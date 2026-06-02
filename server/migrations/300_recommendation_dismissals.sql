-- Migration 300: per-user dismissal state for recommendation cards.

CREATE TABLE IF NOT EXISTS recommendation_dismissals (
  id                BIGSERIAL PRIMARY KEY,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recommendation_id VARCHAR(160) NOT NULL,
  dismissed_until   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, recommendation_id)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_dismissals_user_active
  ON recommendation_dismissals(user_id, dismissed_until);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_recommendation_dismissals_updated_at') THEN
    CREATE TRIGGER trg_recommendation_dismissals_updated_at
      BEFORE UPDATE ON recommendation_dismissals
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
