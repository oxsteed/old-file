-- Migration 20261113231000: erasure notification preference columns
--
-- Money-flows audit W3 added three erasure lifecycle notification types
-- (restaurant_erasure_requested, restaurant_erasure_decided,
-- restaurant_erasure_completed) that send through sendNotification, but
-- with no column to persist a per-type toggle the read was always
-- undefined and there was no way for a manager to turn these alerts off
-- (the same class as background-jobs audit #51 / W6, which this batch
-- just closed for the restaurant alert types).
--
-- After this migration:
-- - in_app_restaurant_erasure_requested (default TRUE) is the canonical
--   toggle for the erasure-requested alert.
-- - in_app_restaurant_erasure_decided (default TRUE) is the canonical
--   toggle for the erasure-decided alert.
-- - in_app_restaurant_erasure_completed (default TRUE) is the canonical
--   toggle for the erasure-completed alert.
-- All three are whitelisted in notificationController.updatePreferences
-- and offered in the NotificationPreferences "Restaurant Alerts"
-- section, so the settings UI can persist them.
BEGIN;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS in_app_restaurant_erasure_requested BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_restaurant_erasure_decided BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_restaurant_erasure_completed BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
