-- Migration 291: Customer re-engagement send log
-- Prevents duplicate nudges within the 7-day cooldown window.

CREATE TABLE IF NOT EXISTS reengagement_log (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, trigger_job_id)
);

CREATE INDEX IF NOT EXISTS idx_reengagement_log_user_sent
  ON reengagement_log(user_id, sent_at DESC);
