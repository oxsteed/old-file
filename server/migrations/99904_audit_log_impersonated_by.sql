-- Migration 99904: stamp the impersonating admin on audit rows.
-- Auth-audit finding 35: actions taken under an impersonated session
-- previously attributed only to the victim's account; impersonated_by
-- records which admin actually drove the action.
ALTER TABLE business_audit_log
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE admin_audit_log
  ADD COLUMN IF NOT EXISTS impersonated_by UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_business_audit_log_impersonated_by
  ON business_audit_log (impersonated_by);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_impersonated_by
  ON admin_audit_log (impersonated_by);
