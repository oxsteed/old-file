-- Migration 183: Native mobile push token registry
-- Stores APNs/FCM tokens for the Capacitor mobile apps.

CREATE TABLE IF NOT EXISTS mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('apns', 'fcm')),
  platform VARCHAR(20) CHECK (platform IN ('ios', 'android', 'web')),
  device_id TEXT,
  app_version VARCHAR(64),
  device JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_push_tokens_token
  ON mobile_push_tokens(token);

CREATE INDEX IF NOT EXISTS idx_mobile_push_tokens_user_enabled
  ON mobile_push_tokens(user_id, enabled)
  WHERE enabled = TRUE;
