-- ─────────────────────────────────────────────────────────────
-- Migration 113: Web Push extensions
--
-- Extends the existing push_subscriptions table (created in 001
-- and amended in 025) with W3C Push API fields, fixes the phantom
-- delivery-tracking columns referenced by notificationService.js,
-- and adds a master Web Push opt-in flag on notification_preferences.
--
-- Idempotent — every change uses IF NOT EXISTS / EXCEPTION blocks
-- so it can be re-applied against partially-migrated databases.
-- ─────────────────────────────────────────────────────────────

-- ─── push_subscriptions: VAPID-shape columns ──────────────────
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS expiration_time BIGINT,
  ADD COLUMN IF NOT EXISTS device_label    TEXT,
  ADD COLUMN IF NOT EXISTS failure_count   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at TIMESTAMPTZ;

-- ─── notifications: delivery flags (referenced by service) ───
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS is_push_sent  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS action_url    TEXT;

-- ─── notification_preferences: master Web Push opt-in ────────
ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS web_push_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint
  ON push_subscriptions(endpoint);

CREATE INDEX IF NOT EXISTS idx_push_subs_active_user
  ON push_subscriptions(user_id, active)
  WHERE active = TRUE;
