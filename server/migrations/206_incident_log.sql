-- INCIDENT_LOG: Track security incidents and alerts for ops/security team

CREATE TABLE IF NOT EXISTS incident_log (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(100) NOT NULL,       -- 'high_error_rate', 'backup_failure', 'payment_error', etc.
  severity VARCHAR(20) NOT NULL,    -- 'critical', 'warning'
  message TEXT NOT NULL,
  details JSONB,                    -- Additional context
  created_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolution_notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_incident_log_created_at
  ON incident_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_log_severity
  ON incident_log(severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_log_type
  ON incident_log(type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_incident_log_resolved
  ON incident_log(resolved_at) WHERE resolved_at IS NULL;
