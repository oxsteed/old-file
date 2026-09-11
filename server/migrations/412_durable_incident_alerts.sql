-- Persist incident-level security alerts so monitoring survives restarts and
-- remains consistent when more than one application replica is running.
BEGIN;

ALTER TABLE incident_log
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(128),
  ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL;

UPDATE incident_log
SET last_seen_at = COALESCE(last_seen_at, created_at)
WHERE last_seen_at IS NULL;

ALTER TABLE incident_log
  ALTER COLUMN last_seen_at SET DEFAULT NOW(),
  ALTER COLUMN last_seen_at SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_incident_log_open_dedupe
  ON incident_log (dedupe_key)
  WHERE resolved_at IS NULL AND dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_incident_log_last_seen
  ON incident_log (last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_log_acknowledged
  ON incident_log (acknowledged_at, last_seen_at DESC)
  WHERE resolved_at IS NULL;

COMMIT;
