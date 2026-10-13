-- Migration 795: notification master toggles
--
-- Adds the user-facing master toggles `push_notifications` and
-- `sms_notifications` to notification_preferences.
--
-- Context (review P2-8-F05): the settings UI conceptually offers master
-- switches for push and SMS, and notificationService.js already reads
-- prefs.push_notifications on the Web Push path, but no column existed, so
-- the read was always undefined (a no-op) and there was no way for a user
-- to turn push or SMS off globally. The per-channel masters that DID exist
-- (web_push_enabled for Web Push, sms_enabled for the SMS page) were
-- honored only on their own paths.
--
-- After this migration:
-- - push_notifications (default TRUE) is honored on every push channel in
--   notificationService.js (Expo, Web Push, native APNs/FCM).
-- - sms_notifications (default TRUE) is honored in
--   smsNotificationService.js sendSMSIfOptedIn alongside sms_enabled.
-- Both are whitelisted in notificationController.updatePreferences so the
-- settings UI can persist them.
BEGIN;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS push_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sms_notifications  BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
