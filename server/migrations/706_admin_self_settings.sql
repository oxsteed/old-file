-- 706: Admin self-service settings tables
-- Supports the admin "My Settings" page: per-admin notification preferences
-- and API keys.

CREATE TABLE IF NOT EXISTS admin_notification_prefs (
  admin_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  notify_payout_failures BOOLEAN NOT NULL DEFAULT TRUE,
  notify_incidents BOOLEAN NOT NULL DEFAULT TRUE,
  notify_new_admins BOOLEAN NOT NULL DEFAULT FALSE,
  notify_disputes BOOLEAN NOT NULL DEFAULT TRUE,
  email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  sms_notifications BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_api_keys_admin ON admin_api_keys(admin_id);
