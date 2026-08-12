-- Migration 372: Add admin/super_admin live-support availability toggle
-- Allows admins to manually mark themselves online/offline for live
-- support chat, independent of socket connection state.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_available_for_support BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN users.is_available_for_support IS
  'When true, this admin/super_admin is opted in to receive live support chat routing. Defaults to false so new admins must explicitly go online.';

-- Fast lookup of which admins are currently marked available
CREATE INDEX IF NOT EXISTS idx_users_available_for_support
  ON users (is_available_for_support)
  WHERE role IN ('admin', 'super_admin') AND is_available_for_support = true;
