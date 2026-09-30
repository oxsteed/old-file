-- Migration 606: settings change requests (change management workflow for
-- platform_settings and feature_flags).
--
-- Separates proposing a setting/flag change from approving and applying it,
-- so a second admin (separation of duties) can review before the change takes
-- effect. Approved requests with a future effective_at are picked up by the
-- scheduled settings worker; requests that are due apply immediately on
-- approval. The audit trail in admin_audit_log stays append-only.
CREATE TABLE IF NOT EXISTS settings_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('setting', 'flag')),
  key TEXT NOT NULL,
  proposed_value JSONB NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'rejected', 'scheduled', 'applied', 'cancelled')),
  proposed_by UUID NOT NULL,
  reviewed_by UUID,
  decided_at TIMESTAMPTZ,
  effective_at TIMESTAMPTZ,
  rollout_percent INT CHECK (rollout_percent BETWEEN 0 AND 100),
  rollout_segment JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS settings_change_requests_status_effective_at_idx
  ON settings_change_requests (status, effective_at);

-- Keep updated_at maintained via the shared helper used by the other
-- control-plane tables (defined in an earlier migration).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'settings_change_requests_updated_at'
  ) THEN
    CREATE TRIGGER settings_change_requests_updated_at
      BEFORE UPDATE ON settings_change_requests
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
