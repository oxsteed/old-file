-- Migration 786: expire and rotate restaurant device credentials.
-- Pairing codes are short lived; device credentials receive a bounded lifetime
-- as well and can be rotated by an authorized restaurant manager.

ALTER TABLE restaurant_app_devices
  ADD COLUMN IF NOT EXISTS device_token_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_restaurant_device_token_expiry
  ON restaurant_app_devices (device_token_expires_at)
  WHERE status = 'paired' AND device_token_hash IS NOT NULL;
