-- Migration 20261114090000: notification preference toggles (notifications audit batch, Track C)
--
-- Closes audit items 4, 12 and 33 (Nov 6 notifications audit):
--   * Item 4:  quiet_hours_enabled did not exist on notification_preferences,
--     so the settings toggle could neither save (PUT /calendar/notification-
--     preferences failed on the unknown column) nor fire (the read leg in
--     notificationService.js gates on the flag). The write leg already
--     accepts the flag (availabilityController.js); only the column was
--     missing.
--   * Item 12: in_app_notifications master toggle for the in-app channel,
--     plus the per-type opt-out table notification_type_opt_outs. A row
--     means the user opted OUT of that type+channel; absence means ON
--     (new types default ON, never silently off).
--   * Item 33: in_app_media_creator_update was a phantom column gated on
--     by mediaCreatorNotificationService.js but created by no migration.
--
-- All statements are idempotent (information_schema guards / IF NOT EXISTS)
-- so the migration is safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'quiet_hours_enabled'
  ) THEN
    ALTER TABLE notification_preferences
      ADD COLUMN quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'in_app_notifications'
  ) THEN
    ALTER TABLE notification_preferences
      ADD COLUMN in_app_notifications BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notification_preferences'
      AND column_name = 'in_app_media_creator_update'
  ) THEN
    ALTER TABLE notification_preferences
      ADD COLUMN in_app_media_creator_update BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notification_type_opt_outs (
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  channel           TEXT NOT NULL CHECK (channel IN ('in_app', 'push', 'email')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notification_type, channel)
);

CREATE INDEX IF NOT EXISTS idx_notification_type_opt_outs_user_type
  ON notification_type_opt_outs (user_id, notification_type);
