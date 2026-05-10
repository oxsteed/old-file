-- FIX #10 & #11: Security Audit Logging
-- Track all security-critical operations for compliance and forensics

CREATE TABLE IF NOT EXISTS security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(100),
  details JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  status VARCHAR(20) DEFAULT 'success',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Index for user audit trails (who did what)
CREATE INDEX IF NOT EXISTS idx_audit_user_created
  ON security_audit_log(user_id, created_at DESC);

-- Index for timeline queries (when did security events occur)
CREATE INDEX IF NOT EXISTS idx_audit_created
  ON security_audit_log(created_at DESC);

-- Index for action type queries (count breaches by type)
CREATE INDEX IF NOT EXISTS idx_audit_action
  ON security_audit_log(action, created_at DESC);

-- Index for resource audit trails (who touched this resource)
CREATE INDEX IF NOT EXISTS idx_audit_resource
  ON security_audit_log(resource_type, resource_id, created_at DESC);

-- Data retention: keep audit logs for 2 years (complies with GDPR, CCPA)
-- Manual cleanup can be done with: DELETE FROM security_audit_log WHERE created_at < NOW() - INTERVAL '2 years'

COMMENT ON TABLE security_audit_log IS 'Security audit trail for compliance and forensics';
COMMENT ON COLUMN security_audit_log.action IS 'Action type: password_reset, email_change, payment_capture, job_cancel, account_suspend, etc.';
COMMENT ON COLUMN security_audit_log.resource_type IS 'Type of resource affected: job, payment, user_account, helper_profile, etc.';
COMMENT ON COLUMN security_audit_log.status IS 'Outcome: success, failure, denied';
