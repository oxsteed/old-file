-- Migration 049: Admin search audit log + scoped time-limited permission grants

-- ── 1. Search audit log ────────────────────────────────────────────────────
-- Every admin search is logged: who searched, what query, which entity types,
-- how many results came back, and from which IP. Super-admins can review this.

CREATE TABLE IF NOT EXISTS admin_search_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query       TEXT        NOT NULL,
  entity_types TEXT[]     NOT NULL DEFAULT '{}',  -- e.g. {'users','jobs','messages'}
  result_count INTEGER    NOT NULL DEFAULT 0,
  ip_address  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_adm_search_admin   ON admin_search_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_adm_search_created ON admin_search_log(created_at DESC);
-- Full-text index on the query column so super-admin can search the searches
CREATE INDEX IF NOT EXISTS idx_adm_search_query_ft
  ON admin_search_log USING gin(to_tsvector('english', query));

-- ── 2. Scoped time-limited permission grants ───────────────────────────────
-- Super-admins can grant individual admins elevated access to specific
-- capabilities for a bounded time window. Grants auto-expire; super-admins
-- can also explicitly revoke them early.
--
-- Available permission scopes (stored as a JSONB array of strings):
--   'view_financials'       — revenue, payouts, financials pages
--   'export_data'           — data export endpoints
--   'manage_settings'       — platform settings + feature flags
--   'view_audit_log'        — full admin audit log
--   'issue_refunds'         — manual job refunds
--   'verify_users'          — identity verification actions
--   'delete_users'          — hard-delete users
--   'delete_jobs'           — hard-delete jobs
--   'view_search_logs'      — admin search audit log
--   'manage_admin_accounts' — create / toggle admin accounts
--   'message_users'         — send admin→user direct messages
--   'manage_permissions'    — (super only) grant/revoke permissions

CREATE TABLE IF NOT EXISTS admin_permission_grants (
  id          BIGSERIAL   PRIMARY KEY,
  grantor_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grantee_id  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions JSONB       NOT NULL DEFAULT '[]',
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  revoked_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_perm_grants_grantee ON admin_permission_grants(grantee_id);
CREATE INDEX IF NOT EXISTS idx_perm_grants_active
  ON admin_permission_grants(grantee_id, expires_at)
  WHERE revoked_at IS NULL;
