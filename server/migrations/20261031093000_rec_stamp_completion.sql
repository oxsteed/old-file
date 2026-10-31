-- Migration 20261031093000: finish audit stamp coverage (auth audit finding 35 residuals).
-- Recommendation track 7: actions taken under an impersonated session were
-- attributed only to the acting account on three more tables. impersonated_by
-- records the admin actually driving the session; it is NULL for direct
-- sessions, system jobs, webhooks and workers, which keeps their behavior
-- byte-identical. Follows the migration 99904 precedent.
ALTER TABLE admin_user_action_log
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cancellation_audit_log
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE payment_refund_attempts
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_admin_user_action_log_impersonated_by
  ON admin_user_action_log (impersonated_by);
CREATE INDEX IF NOT EXISTS idx_cancellation_audit_log_impersonated_by
  ON cancellation_audit_log (impersonated_by);
CREATE INDEX IF NOT EXISTS idx_payment_refund_attempts_impersonated_by
  ON payment_refund_attempts (impersonated_by);
