-- Migration 116: Admin User-Action Audit Log
--
-- Per-field audit trail for super-admin and regional-admin user account
-- modifications. Complements `admin_audit_log` (general admin actions)
-- with a structured before/after row per field changed.
--
-- A single user edit may write multiple rows (one per modified field),
-- which makes filtering and export straightforward.

CREATE TABLE IF NOT EXISTS admin_user_action_log (
  id              BIGSERIAL    PRIMARY KEY,
  admin_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id  UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type     VARCHAR(64)  NOT NULL,   -- create_user, edit_email, change_tier, etc.
  field_name      VARCHAR(100),            -- nullable for create_user
  old_value       TEXT,                    -- redacted for sensitive fields (e.g. password)
  new_value       TEXT,                    -- redacted for sensitive fields
  notes           TEXT,
  ip_address      INET,
  region_id       INTEGER REFERENCES admin_regions(id) ON DELETE SET NULL,
  user_notified   BOOLEAN      NOT NULL DEFAULT FALSE,
  notification_id BIGINT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_user_action_log_admin       ON admin_user_action_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_user_action_log_target      ON admin_user_action_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_user_action_log_action_type ON admin_user_action_log(action_type);
CREATE INDEX IF NOT EXISTS idx_user_action_log_created     ON admin_user_action_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_action_log_region      ON admin_user_action_log(region_id);

-- Composite for the most common filter: time + admin
CREATE INDEX IF NOT EXISTS idx_user_action_log_time_admin
  ON admin_user_action_log(created_at DESC, admin_id);

-- Forbid deletes on the audit log (matches admin_audit_log pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_rules
    WHERE tablename = 'admin_user_action_log'
      AND rulename  = 'user_action_log_no_delete'
  ) THEN
    EXECUTE 'CREATE RULE user_action_log_no_delete AS ON DELETE TO admin_user_action_log DO INSTEAD NOTHING';
  END IF;
END$$;
