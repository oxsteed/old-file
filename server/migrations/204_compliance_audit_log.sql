-- COMPLIANCE_AUDIT_LOG: Enterprise audit trail for SOC 2, ISO 27001, GDPR compliance
-- Tracks all sensitive operations with immutable records

CREATE TABLE IF NOT EXISTS compliance_audit_log (
  id BIGSERIAL PRIMARY KEY,
  action VARCHAR(100) NOT NULL,           -- 'payment_capture', 'user_deletion', 'privilege_escalation', etc.
  resource_type VARCHAR(50) NOT NULL,     -- 'payment', 'user', 'job', 'dispute', etc.
  resource_id VARCHAR(500),                -- UUID or identifier of affected resource
  user_id UUID,                            -- User performing action (NULL for system actions)
  result VARCHAR(20) NOT NULL,             -- 'success' or 'failure'
  severity VARCHAR(20) NOT NULL,           -- 'critical', 'high', 'medium', 'low'
  details JSONB,                           -- Additional context (amounts, reasons, etc.)
  correlation_id VARCHAR(100),             -- Request trace ID for debugging
  ip_address VARCHAR(45),                  -- IPv4 or IPv6 address
  user_agent TEXT,                         -- Browser/client info
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast audit queries
CREATE INDEX IF NOT EXISTS idx_compliance_audit_user_id
  ON compliance_audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_action
  ON compliance_audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_severity
  ON compliance_audit_log(severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_resource
  ON compliance_audit_log(resource_type, resource_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_result
  ON compliance_audit_log(result, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_audit_timestamp
  ON compliance_audit_log(created_at DESC);

-- Immutability: audit log entries cannot be updated or deleted (except by superuser after retention period)
REVOKE UPDATE, DELETE ON compliance_audit_log FROM public;
REVOKE UPDATE, DELETE ON compliance_audit_log FROM authenticated_user;
