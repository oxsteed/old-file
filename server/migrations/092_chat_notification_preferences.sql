-- Add chat notification preference columns
-- Allows users to control when they receive notifications for chat messages

ALTER TABLE notification_preferences
ADD COLUMN IF NOT EXISTS in_app_new_message BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS in_app_message_mention BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS push_new_message BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS push_message_mention BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS email_new_message BOOLEAN DEFAULT FALSE;

-- Add index for faster lookups of notification preferences
CREATE INDEX IF NOT EXISTS idx_notification_prefs_chat
ON notification_preferences (user_id, in_app_new_message, push_new_message, email_new_message);
