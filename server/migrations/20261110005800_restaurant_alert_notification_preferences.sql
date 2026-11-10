-- Migration 20261110005800: restaurant alert notification preference columns
--
-- Background-jobs audit #51: the new restaurant notification types
-- (staff_time_entry_system_closed, staff_time_entry_missing_punch,
-- restaurant_temperature_breach, restaurant_scheduled_report) ship with
-- per-type toggles in the settings UI (NotificationPreferences.jsx,
-- "Restaurant Alerts" section) and PREF_ALIASES entries in
-- notificationService.js, but no column existed to persist them, so the
-- read was always undefined and there was no way for a manager to turn
-- these alerts off.
--
-- After this migration:
-- - in_app_staff_time_entry_system_closed (default TRUE) is the canonical
--   toggle for the system-closed time-entry alert.
-- - in_app_staff_time_entry_missing_punch (default TRUE) is the canonical
--   toggle for the missing-punch alert.
-- - in_app_restaurant_temperature_breach (default TRUE) is the canonical
--   toggle for the temperature-breach alert.
-- - in_app_restaurant_scheduled_report (default TRUE) is the canonical
--   toggle for the scheduled-report alert.
-- The push and email PREF_ALIASES entries for these types point at the
-- same in_app_* keys, so these four columns gate every channel the
-- alerts actually use. All four are whitelisted in
-- notificationController.updatePreferences so the settings UI can
-- persist them.
BEGIN;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS in_app_staff_time_entry_system_closed BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_staff_time_entry_missing_punch BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_restaurant_temperature_breach BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS in_app_restaurant_scheduled_report BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
