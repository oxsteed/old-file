-- Migration 20261113183500: closeout-failure alert notification preference column
--
-- Domain 8 #25: the staff_time_entry_closeout_failed alert shipped with
-- no per-type toggle (migration 20261110005800 added only the other four
-- restaurant-alert toggles), so managers could not silence an alert that
-- re-fired every failed hourly run. This adds the canonical toggle
-- in_app_staff_time_entry_closeout_failed (default TRUE), wired to the
-- same PREF_ALIASES entries in notificationService.js, the same
-- notificationController.updatePreferences whitelist, and the same
-- "Restaurant Alerts" section of NotificationPreferences.jsx as the
-- other four toggles.
BEGIN;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS in_app_staff_time_entry_closeout_failed BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
