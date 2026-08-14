-- Migration 373: Expiring presence for platform live-support admins.
-- The boolean remains the explicit opt-in; the timestamp prevents a closed or
-- crashed browser from advertising an agent as available indefinitely.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS support_available_at TIMESTAMPTZ;

UPDATE users
SET support_available_at = NOW()
WHERE role IN ('admin', 'super_admin')
  AND is_available_for_support = TRUE
  AND support_available_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_live_support_presence
  ON users (support_available_at DESC)
  WHERE role IN ('admin', 'super_admin')
    AND is_available_for_support = TRUE;

COMMENT ON COLUMN users.support_available_at IS
  'Last admin live-support heartbeat. Availability expires when this becomes stale.';
