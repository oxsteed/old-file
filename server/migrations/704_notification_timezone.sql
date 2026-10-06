-- 704: Add timezone to notification preferences for quiet hours
-- Quiet hours were evaluated in UTC only. Store the user's IANA timezone
-- so quiet hours respect their local time.

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
