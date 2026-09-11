-- Prevent repeated monitoring passes or replicas from dispatching duplicate
-- notifications while keeping every occurrence visible in incident_log.
BEGIN;

ALTER TABLE incident_log
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_incident_log_notification_cooldown
  ON incident_log (last_notified_at, resolved_at)
  WHERE resolved_at IS NULL;

COMMIT;
