-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 114: Restore notification_preferences boolean columns
--
-- Migration 112 dropped the notification_preferences table (originally created
-- in migration 025) and recreated it as a calendar-specific table containing
-- only appointment/reminder channel arrays and quiet-hours settings. This
-- destroyed the per-event boolean preference columns (push_*, email_*, in_app_*)
-- that notificationController.js and notificationService.js rely on.
--
-- This migration re-adds all original columns as ADD COLUMN IF NOT EXISTS so
-- it is safe to apply against both a fresh database (112 just ran) and any
-- partially-migrated or previously-repaired state.
--
-- After this migration the table holds BOTH sets of columns:
--   • Calendar channel arrays from migration 112
--   • Per-event boolean flags restored here
--   • web_push_enabled master toggle added by migration 113
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notification_preferences
  -- ── In-app notification flags ────────────────────────────────
  ADD COLUMN IF NOT EXISTS in_app_new_bid          BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_bid_accepted     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_job_started      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_job_completed    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_payment_released BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_new_review       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_dispute_update   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_subscription     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_new_message      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_message_mention  BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── Push notification flags (Expo native + Web Push) ─────────
  ADD COLUMN IF NOT EXISTS push_new_job_nearby     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_new_bid            BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_bid_accepted       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_payment_released   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_dispute_update     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_new_message        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_message_mention    BOOLEAN NOT NULL DEFAULT TRUE,

  -- ── Email notification flags ──────────────────────────────────
  ADD COLUMN IF NOT EXISTS email_bid_accepted      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_payment_released  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_subscription      BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_dispute_update    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_weekly_summary    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS email_new_message       BOOLEAN NOT NULL DEFAULT TRUE;
