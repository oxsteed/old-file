-- Migration 512: keep Credit audit review fast as event volume grows.
--
-- These indexes support the operator filters used for action history and
-- request-level investigation without changing the append-only audit data.

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_audit_action_created
  ON oxsteed_credit_audit_events(action_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_audit_resource_created
  ON oxsteed_credit_audit_events(resource_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_oxsteed_credit_audit_correlation
  ON oxsteed_credit_audit_events(correlation_id, created_at DESC, id DESC)
  WHERE correlation_id IS NOT NULL;
