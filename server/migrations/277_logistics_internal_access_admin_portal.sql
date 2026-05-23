ALTER TABLE logistics_internal_access_credentials
  ADD COLUMN IF NOT EXISTS admin_portal_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE logistics_internal_access_credentials liac
SET admin_portal_enabled = TRUE,
    updated_at = NOW()
FROM users u
WHERE u.id = liac.user_id
  AND u.role = 'super_admin'
  AND liac.is_active = TRUE
  AND liac.admin_portal_enabled = FALSE;

CREATE INDEX IF NOT EXISTS idx_logistics_internal_access_admin_portal
  ON logistics_internal_access_credentials (admin_portal_enabled);
