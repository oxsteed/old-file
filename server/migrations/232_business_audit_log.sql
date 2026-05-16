-- Migration 232: business_audit_log
-- ----------------------------------------------------------------------
-- Per-business audit trail. Records every state-changing action taken
-- within a business workspace by an owner, manager, or representative.
-- Powers incident investigation, compliance reporting, and the
-- per-business activity feed in the workspace UI.
--
-- Idempotent. Safe to re-run.

CREATE TABLE IF NOT EXISTS business_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  business_id     INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role      VARCHAR(40),
  action          VARCHAR(80) NOT NULL,
  target_type     VARCHAR(60),
  target_id       VARCHAR(120),
  before_state    JSONB,
  after_state     JSONB,
  metadata        JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_audit_log_business_created
  ON business_audit_log (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_audit_log_actor
  ON business_audit_log (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_audit_log_action
  ON business_audit_log (business_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_audit_log_target
  ON business_audit_log (target_type, target_id);
