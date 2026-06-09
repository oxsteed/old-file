-- Migration 303: pulse_score_events
-- Records XP-awarding events (e.g. Learn guide completions) used by the Life
-- pulse score / gamification. Referenced by learnController.recordCompletion,
-- which previously inserted into this table even though it was never created —
-- the failing insert aborted the completion transaction, so guide completions
-- silently did not persist. This migration creates the table; the controller
-- now also savepoint-guards the insert so a missing table can never block a
-- completion again.

CREATE TABLE IF NOT EXISTS pulse_score_events (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type  VARCHAR(64)  NOT NULL,
  source      VARCHAR(64),
  source_id   VARCHAR(128),
  xp_awarded  INTEGER      NOT NULL DEFAULT 0,
  metadata    JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Idempotency for `ON CONFLICT DO NOTHING`: one XP event per (user, type, source item).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pulse_score_events_user_event_source
  ON pulse_score_events (user_id, event_type, source_id)
  WHERE source_id IS NOT NULL;

-- Lookup pattern: a user's recent XP events / leaderboard rollups.
CREATE INDEX IF NOT EXISTS idx_pulse_score_events_user_created
  ON pulse_score_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pulse_score_events_type_created
  ON pulse_score_events (event_type, created_at DESC);
