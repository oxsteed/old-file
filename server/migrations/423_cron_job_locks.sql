-- Migration 423: durable distributed cron locks.
--
-- Scheduled jobs run in more than one application process. The lock row must
-- survive a process restart, while an expired lease must be reclaimable by a
-- later worker without a manual cleanup step.

CREATE TABLE IF NOT EXISTS cron_job_locks (
  lock_id TEXT PRIMARY KEY,
  lock_value TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  CHECK (expires_at > acquired_at)
);

CREATE INDEX IF NOT EXISTS idx_cron_job_locks_expires_at
  ON cron_job_locks(expires_at);
