-- Migration 335: Expiring pairing codes, per-device credentials, and remote
-- configuration versioning.

ALTER TABLE restaurant_app_devices
  ADD COLUMN IF NOT EXISTS pairing_code_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS device_token_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  ADD COLUMN IF NOT EXISTS app_version VARCHAR(80),
  ADD COLUMN IF NOT EXISTS platform VARCHAR(80),
  ADD COLUMN IF NOT EXISTS telemetry JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_restaurant_device_pairing_expiry
  ON restaurant_app_devices (pairing_code, pairing_code_expires_at)
  WHERE status = 'pending' AND pairing_code IS NOT NULL;
